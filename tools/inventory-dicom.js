#!/usr/bin/env node
/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';

const ROOT = process.argv[2];
if (!ROOT) {
    console.error('Usage: node tools/inventory-dicom.js <folder>');
    process.exit(1);
}

const MAX_READ = 512 * 1024;

const TAGS = {
    TransferSyntaxUID: 0x00020010,
    Modality: 0x00080060,
    SOPClassUID: 0x00080016,
    SOPInstanceUID: 0x00080018,
    StudyInstanceUID: 0x0020000D,
    SeriesInstanceUID: 0x0020000E,
    SeriesDescription: 0x0008103E,
    InstanceNumber: 0x00200013,
    NumberOfFrames: 0x00280008,
    Rows: 0x00280010,
    Columns: 0x00280011,
    PhotometricInterpretation: 0x00280004,
    PixelSpacing: 0x00280030,
    ImagerPixelSpacing: 0x00181164,
    ImageType: 0x00080008,
    DerivationDescription: 0x00082111,
    UltrasoundRegionSequence: 0x00186011,
    PixelData: 0x7FE00010,
};

const MOSAIC_TAGS = {
    0x0019100A: 'Private0019,100A_NumberOfImagesInMosaic',
    0x0051100A: 'Private0051,100A_Mosaic',
    0x0051100B: 'Private0051,100B_Mosaic',
};

const TAG_NAMES = {
    [TAGS.TransferSyntaxUID]: 'TransferSyntaxUID',
    [TAGS.Modality]: 'Modality',
    [TAGS.SOPClassUID]: 'SOPClassUID',
    [TAGS.SOPInstanceUID]: 'SOPInstanceUID',
    [TAGS.StudyInstanceUID]: 'StudyInstanceUID',
    [TAGS.SeriesInstanceUID]: 'SeriesInstanceUID',
    [TAGS.SeriesDescription]: 'SeriesDescription',
    [TAGS.InstanceNumber]: 'InstanceNumber',
    [TAGS.NumberOfFrames]: 'NumberOfFrames',
    [TAGS.Rows]: 'Rows',
    [TAGS.Columns]: 'Columns',
    [TAGS.PhotometricInterpretation]: 'PhotometricInterpretation',
    [TAGS.PixelSpacing]: 'PixelSpacing',
    [TAGS.ImagerPixelSpacing]: 'ImagerPixelSpacing',
    [TAGS.ImageType]: 'ImageType',
    [TAGS.DerivationDescription]: 'DerivationDescription',
    [TAGS.UltrasoundRegionSequence]: 'UltrasoundRegionSequence',
    ...MOSAIC_TAGS,
};

const VR_32BIT = new Set(['OB', 'OD', 'OF', 'OL', 'OW', 'SQ', 'UC', 'UN', 'UR', 'UT']);

const DOCUMENT_SOP_PREFIX = '1.2.840.10008.5.1.4.1.1.104';
const SECONDARY_CAPTURE_PREFIX = '1.2.840.10008.5.1.4.1.1.7';

async function walk(dir) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await walk(full));
        } else if (entry.isFile()) {
            files.push(full);
        }
    }
    return files;
}

function readUInt16(buf, offset, littleEndian) {
    return littleEndian ? buf.readUInt16LE(offset) : buf.readUInt16BE(offset);
}

function readUInt32(buf, offset, littleEndian) {
    return littleEndian ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset);
}

function extractValue(buffer, offset, length, vr, littleEndian) {
    if (length === 0) return '';
    if (offset + length > buffer.length) return '';

    const slice = buffer.subarray(offset, offset + length);
    if (['AE', 'AS', 'CS', 'DA', 'DS', 'DT', 'IS', 'LO', 'LT', 'PN', 'SH', 'ST', 'TM', 'UC', 'UI', 'UR', 'UT'].includes(vr) || vr === '') {
        return slice.toString('ascii').replace(/\0/g, '').trim();
    }

    switch (vr) {
        case 'US':
            return length >= 2 ? (littleEndian ? slice.readUInt16LE(0) : slice.readUInt16BE(0)) : null;
        case 'SS':
            return length >= 2 ? (littleEndian ? slice.readInt16LE(0) : slice.readInt16BE(0)) : null;
        case 'UL':
            return length >= 4 ? (littleEndian ? slice.readUInt32LE(0) : slice.readUInt32BE(0)) : null;
        case 'SL':
            return length >= 4 ? (littleEndian ? slice.readInt32LE(0) : slice.readInt32BE(0)) : null;
        case 'FL':
            return length >= 4 ? (littleEndian ? slice.readFloatLE(0) : slice.readFloatBE(0)) : null;
        case 'FD':
            return length >= 8 ? (littleEndian ? slice.readDoubleLE(0) : slice.readDoubleBE(0)) : null;
        default:
            return slice.toString('ascii').replace(/\0/g, '').trim();
    }
}

function parseIntValue(value) {
    if (value === null || value === '') return undefined;
    if (typeof value === 'number') return Math.floor(value);
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
}

function skipSequence(buffer, offset, littleEndian) {
    while (offset + 8 <= buffer.length) {
        const group = readUInt16(buffer, offset, littleEndian);
        const element = readUInt16(buffer, offset + 2, littleEndian);
        offset += 4;
        const len = readUInt32(buffer, offset, littleEndian);
        offset += 4;

        if (group === 0xFFFE && element === 0xE0DD) {
            return offset;
        }
        if (len !== 0xFFFFFFFF) {
            offset += len;
        }
    }
    return offset;
}

function isDocumentSopClass(uid) {
    if (!uid) return false;
    const trimmed = uid.trim();
    return trimmed.startsWith(DOCUMENT_SOP_PREFIX) || trimmed.startsWith(SECONDARY_CAPTURE_PREFIX);
}

function normalizeTokens(value) {
    if (!value) return [];
    return value.split('\\').map(token => token.trim().toUpperCase()).filter(Boolean);
}

function hasMosaicTokens(value) {
    const tokens = normalizeTokens(value);
    return tokens.some(token => ['MOSAIC', 'MONTAGE', 'TILED', 'TILE'].includes(token));
}

function hasMosaicText(value) {
    if (!value) return false;
    return /mosaic|montage|tile/i.test(value);
}

function classifyDocLike(parsed) {
    if (isDocumentSopClass(parsed.sopClassUid)) {
        return { isDocLike: true, reason: 'SOPClassUID' };
    }
    const imageTypeTokens = normalizeTokens(parsed.imageType);
    if (imageTypeTokens.includes('DERIVED')) {
        return { isDocLike: true, reason: 'ImageType:DERIVED' };
    }
    if (imageTypeTokens.includes('SECONDARY')) {
        return { isDocLike: true, reason: 'ImageType:SECONDARY' };
    }
    if (parsed.derivationDescription && /secondary|derived|document|report/i.test(parsed.derivationDescription)) {
        return { isDocLike: true, reason: 'DerivationDescription' };
    }
    return { isDocLike: false, reason: null };
}

async function parseDicom(filePath) {
    const handle = await fs.promises.open(filePath, 'r');
    try {
        const stat = await handle.stat();
        if (stat.size < 132) return { isValid: false, error: 'File too small' };

        const readSize = Math.min(stat.size, MAX_READ);
        const buffer = Buffer.alloc(readSize);
        await handle.read(buffer, 0, readSize, 0);

        const magic = buffer.toString('ascii', 128, 132);
        if (magic !== 'DICM') {
            return { isValid: false, error: 'Missing DICM magic' };
        }

        const result = {
            isValid: true,
            mosaicIndicatorTags: new Set(),
        };

        let offset = 132;
        let isExplicitVR = true;
        let isLittleEndian = true;

        while (offset + 8 <= buffer.length) {
            const group = readUInt16(buffer, offset, isLittleEndian);
            const element = readUInt16(buffer, offset + 2, isLittleEndian);
            const tag = (group << 16) | element;
            offset += 4;

            const tagName = TAG_NAMES[tag];
            if (tagName && /mosaic|tile/i.test(tagName)) {
                result.mosaicIndicatorTags.add(tagName);
            }

            if (tag === TAGS.PixelData) {
                break;
            }

            if (group > 0x0002 && result.transferSyntaxUid) {
                const ts = result.transferSyntaxUid;
                isExplicitVR = !ts.startsWith('1.2.840.10008.1.2') ||
                    ts === '1.2.840.10008.1.2.1' ||
                    ts === '1.2.840.10008.1.2.2';
                isLittleEndian = ts !== '1.2.840.10008.1.2.2';
            }

            const useExplicitVR = group === 0x0002 || isExplicitVR;

            let vr = '';
            let valueLength;

            if (useExplicitVR) {
                if (offset + 2 > buffer.length) break;
                vr = buffer.toString('ascii', offset, offset + 2);
                offset += 2;

                if (VR_32BIT.has(vr)) {
                    if (offset + 6 > buffer.length) break;
                    offset += 2;
                    valueLength = readUInt32(buffer, offset, isLittleEndian);
                    offset += 4;
                } else {
                    if (offset + 2 > buffer.length) break;
                    valueLength = readUInt16(buffer, offset, isLittleEndian);
                    offset += 2;
                }
            } else {
                if (offset + 4 > buffer.length) break;
                valueLength = readUInt32(buffer, offset, isLittleEndian);
                offset += 4;
            }

            if (valueLength === 0xFFFFFFFF) {
                offset = skipSequence(buffer, offset, isLittleEndian);
                continue;
            }

            if (offset + valueLength > buffer.length) {
                break;
            }

            const value = extractValue(buffer, offset, valueLength, vr, isLittleEndian);
            offset += valueLength;

            switch (tag) {
                case TAGS.TransferSyntaxUID:
                    result.transferSyntaxUid = value;
                    break;
                case TAGS.Modality:
                    result.modality = value;
                    break;
                case TAGS.SOPClassUID:
                    result.sopClassUid = value;
                    break;
                case TAGS.SOPInstanceUID:
                    result.sopInstanceUid = value;
                    break;
                case TAGS.StudyInstanceUID:
                    result.studyInstanceUid = value;
                    break;
                case TAGS.SeriesInstanceUID:
                    result.seriesInstanceUid = value;
                    break;
                case TAGS.SeriesDescription:
                    result.seriesDescription = value;
                    break;
                case TAGS.InstanceNumber:
                    result.instanceNumber = parseIntValue(value);
                    break;
                case TAGS.NumberOfFrames:
                    result.numberOfFrames = parseIntValue(value);
                    break;
                case TAGS.Rows:
                    result.rows = parseIntValue(value);
                    break;
                case TAGS.Columns:
                    result.columns = parseIntValue(value);
                    break;
                case TAGS.PhotometricInterpretation:
                    result.photometricInterpretation = value;
                    break;
                case TAGS.PixelSpacing:
                    result.pixelSpacing = value;
                    break;
                case TAGS.ImagerPixelSpacing:
                    result.imagerPixelSpacing = value;
                    break;
                case TAGS.ImageType:
                    result.imageType = value;
                    break;
                case TAGS.DerivationDescription:
                    result.derivationDescription = value;
                    break;
                case TAGS.UltrasoundRegionSequence:
                    result.ultrasoundRegionSequence = true;
                    break;
                default:
                    break;
            }
        }

        if (!result.studyInstanceUid || !result.seriesInstanceUid || !result.sopInstanceUid) {
            result.isValid = false;
            result.error = 'Missing required UIDs';
        }

        if (hasMosaicTokens(result.imageType)) {
            result.mosaicIndicatorTags.add('ImageType');
        }
        if (hasMosaicText(result.derivationDescription)) {
            result.mosaicIndicatorTags.add('DerivationDescription');
        }

        result.mosaicIndicatorTags = Array.from(result.mosaicIndicatorTags);

        return result;
    } finally {
        await handle.close();
    }
}

function bumpCount(map, key) {
    map[key] = (map[key] || 0) + 1;
}

function updateMinMax(state, value) {
    if (typeof value !== 'number') return;
    if (state.min === null || value < state.min) state.min = value;
    if (state.max === null || value > state.max) state.max = value;
}

function decideSemanticKind(series) {
    const mosaicEvidence = series.mosaicIndicators.tags.length > 0;
    const multiFrame = series.numberOfFrames.max > 1;
    if (mosaicEvidence && series.instanceCount === 1 && !multiFrame) return 'MOSAIC';
    if (series.instanceCount > 1) return 'STACK';
    if (multiFrame) return 'MULTIFRAME_STACK';
    return 'SINGLE';
}

async function main() {
    const allFiles = await walk(ROOT);
    console.log(`Scanning ${allFiles.length} files...`);

    const studies = new Map();
    let processed = 0;
    let dicomFiles = 0;
    let skipped = 0;
    let errors = 0;

    for (const filePath of allFiles) {
        processed++;
        if (processed % 200 === 0) {
            console.log(`Processed ${processed}/${allFiles.length}...`);
        }

        let parsed;
        try {
            parsed = await parseDicom(filePath);
        } catch (err) {
            errors++;
            continue;
        }

        if (!parsed.isValid) {
            skipped++;
            continue;
        }

        dicomFiles++;

        const studyUid = parsed.studyInstanceUid;
        const seriesUid = parsed.seriesInstanceUid;

        if (!studies.has(studyUid)) {
            studies.set(studyUid, {
                studyInstanceUid: studyUid,
                series: new Map(),
            });
        }

        const study = studies.get(studyUid);
        if (!study.series.has(seriesUid)) {
            study.series.set(seriesUid, {
                studyInstanceUid: studyUid,
                seriesInstanceUid: seriesUid,
                modality: parsed.modality || 'OT',
                seriesDescription: parsed.seriesDescription || '',
                instanceCount: 0,
                representativeSOPClassUID: parsed.sopClassUid || '',
                numberOfFrames: { min: null, max: null, anyMultiframe: false },
                rows: { min: null, max: null },
                columns: { min: null, max: null },
                transferSyntaxUIDs: {},
                photometricInterpretation: {},
                pixelSpacing: { present: false, sourceTag: null },
                mosaicIndicators: { found: false, tags: [] },
                isDocLike: { value: false, reason: null },
            });
        }

        const series = study.series.get(seriesUid);
        series.instanceCount += 1;

        if (!series.modality && parsed.modality) series.modality = parsed.modality;
        if (!series.seriesDescription && parsed.seriesDescription) series.seriesDescription = parsed.seriesDescription;
        if (!series.representativeSOPClassUID && parsed.sopClassUid) series.representativeSOPClassUID = parsed.sopClassUid;

        const frames = parsed.numberOfFrames ?? 1;
        updateMinMax(series.numberOfFrames, frames);
        if (frames > 1) series.numberOfFrames.anyMultiframe = true;

        updateMinMax(series.rows, parsed.rows);
        updateMinMax(series.columns, parsed.columns);

        if (parsed.transferSyntaxUid) {
            bumpCount(series.transferSyntaxUIDs, parsed.transferSyntaxUid);
        }
        if (parsed.photometricInterpretation) {
            bumpCount(series.photometricInterpretation, parsed.photometricInterpretation);
        }

        if (parsed.pixelSpacing) {
            series.pixelSpacing.present = true;
            series.pixelSpacing.sourceTag = 'PixelSpacing';
        } else if (parsed.imagerPixelSpacing && !series.pixelSpacing.present) {
            series.pixelSpacing.present = true;
            series.pixelSpacing.sourceTag = 'ImagerPixelSpacing';
        }

        if (parsed.mosaicIndicatorTags && parsed.mosaicIndicatorTags.length) {
            for (const tag of parsed.mosaicIndicatorTags) {
                series.mosaicIndicators.tags.push(tag);
            }
        }

        if (!series.isDocLike.value) {
            const doc = classifyDocLike(parsed);
            if (doc.isDocLike) {
                series.isDocLike = { value: true, reason: doc.reason };
            }
        }
    }

    const report = {
        generatedAt: new Date().toISOString(),
        root: ROOT,
        stats: { totalFiles: allFiles.length, processed, dicomFiles, skipped, errors },
        studies: [],
    };

    for (const study of studies.values()) {
        const seriesList = [];
        for (const series of study.series.values()) {
            const uniqueTags = Array.from(new Set(series.mosaicIndicators.tags));
            series.mosaicIndicators = {
                found: uniqueTags.length > 0,
                tags: uniqueTags,
            };
            series.semanticKind = decideSemanticKind(series);
            seriesList.push(series);
        }
        report.studies.push({
            studyInstanceUid: study.studyInstanceUid,
            series: seriesList,
        });
    }

    const table = [];
    for (const study of report.studies) {
        for (const series of study.series) {
            table.push({
                studyInstanceUid: study.studyInstanceUid,
                seriesInstanceUid: series.seriesInstanceUid,
                modality: series.modality,
                seriesDescription: series.seriesDescription,
                instanceCount: series.instanceCount,
                frames: `${series.numberOfFrames.min ?? '?'}-${series.numberOfFrames.max ?? '?'}`,
                semanticKind: series.semanticKind,
                docLike: series.isDocLike.value ? series.isDocLike.reason : '',
                mosaicTags: series.mosaicIndicators.tags.join(', '),
            });
        }
    }

    console.log('');
    console.table(table);

    const outputPath = '/tmp/dicom-god-inventory.json';
    await fs.promises.writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\nWrote inventory JSON to ${outputPath}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
