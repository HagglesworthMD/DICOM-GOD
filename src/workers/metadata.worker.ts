/**
 * Metadata indexing worker
 * Runs DICOM parsing off the main thread
 * Produces Study -> Series -> Instance tree progressively
 */

import { parseDicomHeader, isDicomFile, type ParsedDicom } from '../core/dicomParser';
import type {
    WorkerRequest,
    WorkerResponse,
    FileEntry,
    Study,
    Series,
    Instance,
    IndexProgress
} from '../core/types';
import { classifySeriesSemantics } from '../core/seriesSemantics';

// Currently active job - cancel flag
let currentRequestId: string | null = null;
let cancelRequested = false;

// Accumulated data structures
let studies = new Map<string, Study>();

/**
 * Handle incoming messages
 */
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
    const msg = event.data;

    switch (msg.type) {
        case 'START_INDEX':
            await handleStartIndex(msg.requestId, msg.files);
            break;

        case 'CANCEL':
            if (msg.requestId === currentRequestId) {
                cancelRequested = true;
            }
            break;
    }
};

/**
 * Send a message to the main thread
 */
function postResponse(msg: WorkerResponse) {
    self.postMessage(msg);
}

/**
 * Handle indexing start
 */
async function handleStartIndex(requestId: string, files: FileEntry[]) {
    // Reset state
    currentRequestId = requestId;
    cancelRequested = false;
    studies.clear();

    const progress: IndexProgress = {
        phase: 'scanning',
        totalFiles: files.length,
        processedFiles: 0,
        dicomFiles: 0,
        skippedFiles: 0,
        errorFiles: 0,
    };

    postResponse({ type: 'PROGRESS', requestId, progress });

    // Phase 1: Quick scan to identify DICOM files
    const dicomFiles: FileEntry[] = [];

    for (let i = 0; i < files.length; i++) {
        if (cancelRequested) {
            postResponse({ type: 'CANCELLED', requestId });
            return;
        }

        const file = files[i];

        // Quick DICOM check
        try {
            const isDicom = await isDicomFile(file.file);
            if (isDicom) {
                dicomFiles.push(file);
            } else {
                progress.skippedFiles++;
            }
        } catch {
            progress.skippedFiles++;
        }

        // Update progress every 50 files or at the end
        if (i % 50 === 0 || i === files.length - 1) {
            progress.processedFiles = i + 1;
            progress.currentFile = file.name;
            postResponse({ type: 'PROGRESS', requestId, progress });
        }
    }

    // Phase 2: Parse DICOM headers
    progress.phase = 'parsing';
    progress.totalFiles = dicomFiles.length;
    progress.processedFiles = 0;
    postResponse({ type: 'PROGRESS', requestId, progress });

    // Track which studies have been sent for updates
    const sentStudyUpdates = new Set<string>();

    for (let i = 0; i < dicomFiles.length; i++) {
        if (cancelRequested) {
            postResponse({ type: 'CANCELLED', requestId });
            return;
        }

        const file = dicomFiles[i];
        progress.currentFile = file.path ?? file.name;

        try {
            const parsed = await parseDicomHeader(file.file);

            if (parsed.isValid && parsed.studyInstanceUid && parsed.seriesInstanceUid && parsed.sopInstanceUid) {
                progress.dicomFiles++;

                // Build tree structure
                const study = getOrCreateStudy(parsed);
                const series = getOrCreateSeries(study, parsed);
                addInstance(series, parsed, file);

                // Sort series and instances for deterministic order
                sortStudyContents(study);

                // Send study update periodically
                if (!sentStudyUpdates.has(study.studyInstanceUid) || i % 20 === 0) {
                    sentStudyUpdates.add(study.studyInstanceUid);
                    postResponse({ type: 'STUDY_UPDATE', requestId, study: { ...study } });
                }
            } else {
                progress.errorFiles++;
            }
        } catch {
            progress.errorFiles++;
        }

        progress.processedFiles = i + 1;

        // Send progress every 10 files
        if (i % 10 === 0 || i === dicomFiles.length - 1) {
            postResponse({ type: 'PROGRESS', requestId, progress });
        }

        // Yield to allow cancellation checks
        if (i % 100 === 0) {
            await yieldToEventLoop();
        }
    }

    // Final sort of all studies
    const finalStudies = Array.from(studies.values()).map(study => {
        sortStudyContents(study);
        return study;
    });

    // Sort studies by date (newest first) then by description
    // Sort studies by date (newest first) then by description then by UID
    finalStudies.sort((a, b) => {
        if (a.date && b.date) {
            const cmp = b.date.localeCompare(a.date);
            if (cmp !== 0) return cmp;
        } else if (a.date) {
            return -1;
        } else if (b.date) {
            return 1;
        }

        const descCmp = (a.description || '').localeCompare(b.description || '');
        if (descCmp !== 0) return descCmp;

        return a.studyInstanceUid.localeCompare(b.studyInstanceUid);
    });

    progress.phase = 'complete';
    progress.currentFile = undefined;

    postResponse({
        type: 'COMPLETE',
        requestId,
        studies: finalStudies,
        progress
    });

    currentRequestId = null;
}

/**
 * Get or create a Study from parsed DICOM
 */
function getOrCreateStudy(parsed: ParsedDicom): Study {
    const uid = parsed.studyInstanceUid!;

    let study = studies.get(uid);
    if (!study) {
        study = {
            studyInstanceUid: uid,
            description: parsed.studyDescription || 'Unknown Study',
            date: parsed.studyDate,
            time: parsed.studyTime,
            patientName: parsed.patientName,
            patientId: parsed.patientId,
            accessionNumber: parsed.accessionNumber,
            series: [],
        };
        studies.set(uid, study);
    }

    // Update with new info if better
    if (parsed.studyDescription && !study.description) {
        study.description = parsed.studyDescription;
    }
    if (parsed.patientName && !study.patientName) {
        study.patientName = parsed.patientName;
    }

    return study;
}

/**
 * Get or create a Series from parsed DICOM
 */
function getOrCreateSeries(study: Study, parsed: ParsedDicom): Series {
    const uid = parsed.seriesInstanceUid!;

    let series = study.series.find(s => s.seriesInstanceUid === uid);
    if (!series) {
        series = {
            seriesInstanceUid: uid,
            studyInstanceUid: study.studyInstanceUid,
            description: parsed.seriesDescription || `Series ${parsed.seriesNumber ?? 'Unknown'}`,
            seriesNumber: parsed.seriesNumber ?? null,
            modality: parsed.modality || 'OT',
            instances: [],
            geometryTrust: 'unknown',
            // Classification defaults (will be recomputed in sortStudyContents)
            kind: 'single',
            cineEligible: false,
            cineReason: 'Not yet classified',
        };
        study.series.push(series);
    }

    // Update with new info if better
    if (parsed.seriesDescription && series.description.startsWith('Series ')) {
        series.description = parsed.seriesDescription;
    }
    if (parsed.modality && series.modality === 'OT') {
        series.modality = parsed.modality;
    }

    return series;
}

/**
 * Add an Instance to a Series
 */
function addInstance(series: Series, parsed: ParsedDicom, file: FileEntry) {
    const uid = parsed.sopInstanceUid!;

    // Check for duplicates
    if (series.instances.find(i => i.sopInstanceUid === uid)) {
        return;
    }

    const instance: Instance = {
        sopInstanceUid: uid,
        seriesInstanceUid: series.seriesInstanceUid,
        instanceNumber: parsed.instanceNumber ?? null,

        // Use the fileKey from enumeration - this is the stable key for file lookup
        fileKey: file.fileKey,

        filePath: file.path ?? file.name,
        fileSize: file.size,
        sopClassUid: parsed.sopClassUid,
        imageType: parsed.imageType,
        derivationDescription: parsed.derivationDescription,
        imageOrientationPatient: parsed.imageOrientationPatient,
        imagePositionPatient: parsed.imagePositionPatient,
        pixelSpacing: parsed.pixelSpacing,
        imagerPixelSpacing: parsed.imagerPixelSpacing,
        rows: parsed.rows,
        columns: parsed.columns,
        bitsAllocated: parsed.bitsAllocated,
        bitsStored: parsed.bitsStored,
        highBit: parsed.highBit,
        pixelRepresentation: parsed.pixelRepresentation,
        transferSyntaxUid: parsed.transferSyntaxUid,
        photometricInterpretation: parsed.photometricInterpretation,
        samplesPerPixel: parsed.samplesPerPixel,
        numberOfFrames: parsed.numberOfFrames,
        ultrasoundRegionSequence: parsed.ultrasoundRegionSequence,
        mosaicEvidenceTags: parsed.mosaicEvidenceTags,
        windowCenter: parsed.windowCenter,
        windowWidth: parsed.windowWidth,
        rescaleSlope: parsed.rescaleSlope,
        rescaleIntercept: parsed.rescaleIntercept,
    };

    series.instances.push(instance);
}

/**
 * Sort series by SeriesNumber then description
 * Sort instances by InstanceNumber then SOPInstanceUID
 */
/**
 * Parse DICOM DS string (1.2\3.4) to number array
 */
function parseDS(val?: string): number[] | null {
    if (!val) return null;
    return val.split('\\').map(parseFloat);
}

/**
 * Sort series by SeriesNumber then description
 * Sort instances by IOP/IPP (Geometry), then InstanceNumber, then FileKey
 */
function sortStudyContents(study: Study) {
    // Sort series
    study.series.sort((a, b) => {
        // SeriesNumber comparison (null sorts last)
        if (a.seriesNumber !== null && b.seriesNumber !== null) {
            const numCmp = a.seriesNumber - b.seriesNumber;
            if (numCmp !== 0) return numCmp;
        } else if (a.seriesNumber !== null) {
            return -1;
        } else if (b.seriesNumber !== null) {
            return 1;
        }

        // Description as tiebreaker
        const descCmp = (a.description || '').localeCompare(b.description || '');
        if (descCmp !== 0) return descCmp;

        // UID as final tiebreaker
        return a.seriesInstanceUid.localeCompare(b.seriesInstanceUid);
    });

    // Sort instances in each series
    for (const series of study.series) {
        // Determine sorting method
        let useGeometry = false;

        // Check if we have enough geometry info for all instances
        const validGeometryCount = series.instances.filter(i =>
            i.imagePositionPatient && i.imageOrientationPatient
        ).length;

        // If >90% have geometry, uses it (allows for some missing headers in weird cases, 
        // but strict stack usually requires all. Let's require majority)
        if (validGeometryCount === series.instances.length && series.instances.length > 1) {
            useGeometry = true;
        }

        if (useGeometry) {
            // Check consistency of orientation
            const firstIOP = parseDS(series.instances[0].imageOrientationPatient!);
            if (firstIOP && firstIOP.length === 6) {
                const rx = firstIOP[0], ry = firstIOP[1], rz = firstIOP[2];
                const cx = firstIOP[3], cy = firstIOP[4], cz = firstIOP[5];

                // Normal vector = row x col
                const nx = ry * cz - rz * cy;
                const ny = rz * cx - rx * cz;
                const nz = rx * cy - ry * cx;

                // Sort by distance along normal (dot product of IPP * Normal)
                series.instances.sort((a, b) => {
                    const posA = parseDS(a.imagePositionPatient!)!;
                    const posB = parseDS(b.imagePositionPatient!)!;

                    // Dist = P dot N
                    // Dist = P dot N
                    const distA = posA[0] * nx + posA[1] * ny + posA[2] * nz;
                    const distB = posB[0] * nx + posB[1] * ny + posB[2] * nz;

                    const distDiff = distA - distB;
                    if (Math.abs(distDiff) > 0.001) return distDiff;

                    // Tie-breaker: Instance Number
                    if (a.instanceNumber !== null && b.instanceNumber !== null) {
                        const numDiff = a.instanceNumber - b.instanceNumber;
                        if (numDiff !== 0) return numDiff;
                    }

                    // Ultimate Tie-breaker: FileKey (stable string)
                    return a.fileKey.localeCompare(b.fileKey);
                });

                // Verify slice spacing consistency
                let isRegular = true;
                if (series.instances.length > 1) {
                    // Recalculate distances to check intervals
                    const dists = series.instances.map(i => {
                        const pos = parseDS(i.imagePositionPatient!)!;
                        return pos[0] * nx + pos[1] * ny + pos[2] * nz;
                    });

                    const intervals = [];
                    for (let i = 1; i < dists.length; i++) {
                        intervals.push(Math.abs(dists[i] - dists[i - 1]));
                    }

                    // Calculate average spacing
                    const total = intervals.reduce((sum, val) => sum + val, 0);
                    const avg = total / intervals.length;

                    // Check for deviations > 0.1mm (allowing for some floating point slush)
                    // CT/MR are usually precise, but 0.1mm is safe threshold for "Irregular"
                    const tolerance = 0.1;

                    for (const interval of intervals) {
                        if (Math.abs(interval - avg) > tolerance) {
                            isRegular = false;
                            break;
                        }
                    }
                }

                // Determine spacing source for this series
                let spacingSource: 'PixelSpacing' | 'ImagerPixelSpacing' | 'Unknown' = 'Unknown';
                for (const inst of series.instances) {
                    if (inst.pixelSpacing) {
                        spacingSource = 'PixelSpacing';
                        break;
                    } else if (inst.imagerPixelSpacing && spacingSource === 'Unknown') {
                        spacingSource = 'ImagerPixelSpacing';
                    }
                }

                const reasons = isRegular
                    ? ['Regular slice spacing verified', 'Sorted by spatial position']
                    : ['Sorted by spatial position', 'Irregular slice spacing detected'];

                if (spacingSource === 'ImagerPixelSpacing') {
                    reasons.push('Using ImagerPixelSpacing (less accurate)');
                } else if (spacingSource === 'Unknown') {
                    reasons.push('No pixel spacing information');
                }

                series.geometryTrust = isRegular ? 'verified' : 'trusted';
                series.geometryTrustInfo = {
                    level: series.geometryTrust,
                    reasons,
                    spacingSource
                };

                continue; // Done with this series
            }
        }

        // Fallback: Instance Number
        series.geometryTrust = 'untrusted';

        // Determine spacing source even for fallback
        let spacingSource: 'PixelSpacing' | 'ImagerPixelSpacing' | 'Unknown' = 'Unknown';
        for (const inst of series.instances) {
            if (inst.pixelSpacing) {
                spacingSource = 'PixelSpacing';
                break;
            } else if (inst.imagerPixelSpacing && spacingSource === 'Unknown') {
                spacingSource = 'ImagerPixelSpacing';
            }
        }

        series.geometryTrustInfo = {
            level: 'untrusted',
            reasons: ['Missing or inconsistent geometry', 'Sorted by instance number'],
            spacingSource
        };

        series.instances.sort((a, b) => {
            // InstanceNumber comparison (null sorts last)
            if (a.instanceNumber !== null && b.instanceNumber !== null) {
                const numCmp = a.instanceNumber - b.instanceNumber;
                if (numCmp !== 0) return numCmp;
            } else if (a.instanceNumber !== null) {
                return -1;
            } else if (b.instanceNumber !== null) {
                return 1;
            }

            // SOPInstanceUID as tiebreaker NO, FileKey is better for consistent order if UIDs generic
            if (a.fileKey && b.fileKey) {
                return a.fileKey.localeCompare(b.fileKey);
            }

            // SOPInstanceUID as final
            return a.sopInstanceUid.localeCompare(b.sopInstanceUid);
        });
    }

    // Classify each series (kind, cineEligible)
    const MIN_STACK_IMAGES = 2; // Allow scrolling for essentially anything > 1
    const MIN_CINE_FRAMES = 10; // Only cine if it looks good (arbitrary aesthetic threshold)

    for (const series of study.series) {
        const instanceCount = series.instances.length;

        const semantics = classifySeriesSemantics(series.instances, series.modality);
        series.hasMultiframe = semantics.hasMultiframe;
        series.stackLike = semantics.stackLike;
        series.documentLike = semantics.documentLike;
        series.documentReason = semantics.documentReason;

        // Determine kind and cine eligibility
        if (series.hasMultiframe) {
            series.kind = 'multiframe';
            series.cineEligible = true;
            series.cineReason = undefined;
        } else if (series.geometryTrust === 'untrusted') {
            series.kind = 'unsafe';
            series.cineEligible = false;
            series.cineReason = 'Geometry unsafe';
        } else if (instanceCount >= MIN_STACK_IMAGES) {
            series.kind = 'stack';
            // Gate cine behind higher frame count to avoid ugly looping
            if (instanceCount >= MIN_CINE_FRAMES) {
                series.cineEligible = true;
                series.cineReason = undefined;
            } else {
                series.cineEligible = false;
                series.cineReason = `Too few frames (${instanceCount} < ${MIN_CINE_FRAMES})`;
            }
        } else {
            series.kind = 'single';
            series.cineEligible = false;
            series.cineReason = `Only ${instanceCount} image${instanceCount === 1 ? '' : 's'}`;
        }
    }
}

/**
 * Yield to the event loop to allow message processing
 */
function yieldToEventLoop(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}
