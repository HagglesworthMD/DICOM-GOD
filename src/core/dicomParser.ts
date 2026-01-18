/**
 * Minimal DICOM parser for header-only metadata extraction
 * Does NOT decode pixel data - only reads tags needed for indexing
 * 
 * DICOM file structure:
 * - 128 bytes preamble (ignored)
 * - 4 bytes "DICM" magic
 * - Data elements (tag, VR, length, value)
 */

// Tags we care about for indexing (group, element)
const TAGS = {
    // Meta Information
    TransferSyntaxUID: 0x00020010,

    // Patient
    PatientName: 0x00100010,
    PatientID: 0x00100020,

    // Study
    StudyDate: 0x00080020,
    StudyTime: 0x00080030,
    AccessionNumber: 0x00080050,
    StudyDescription: 0x00081030,
    StudyInstanceUID: 0x0020000D,

    // Series
    Modality: 0x00080060,
    SeriesDescription: 0x0008103E,
    SeriesInstanceUID: 0x0020000E,
    SeriesNumber: 0x00200011,

    // Instance
    InstanceNumber: 0x00200013,
    SOPInstanceUID: 0x00080018,
    SOPClassUID: 0x00080016,
    NumberOfFrames: 0x00280008,
    ImageType: 0x00080008,
    DerivationDescription: 0x00082111,

    // Image Geometry
    ImageOrientationPatient: 0x00200037,
    ImagePositionPatient: 0x00200032,
    PixelSpacing: 0x00280030,
    ImagerPixelSpacing: 0x00181164,
    Rows: 0x00280010,
    Columns: 0x00280011,
    SamplesPerPixel: 0x00280002,
    BitsAllocated: 0x00280100,
    BitsStored: 0x00280101,
    HighBit: 0x00280102,
    PixelRepresentation: 0x00280103,
    PhotometricInterpretation: 0x00280004,
    UltrasoundRegionSequence: 0x00186011,

    // Windowing
    WindowCenter: 0x00281050,
    WindowWidth: 0x00281051,
    RescaleSlope: 0x00281053,
    RescaleIntercept: 0x00281052,

    // Stop scanning at PixelData
    PixelData: 0x7FE00010,
} as const;

// VRs that use 4-byte length field (explicit VR)
const VR_32BIT = new Set(['OB', 'OD', 'OF', 'OL', 'OW', 'SQ', 'UC', 'UN', 'UR', 'UT']);

const MOSAIC_TAGS: Record<number, string> = {
    0x0019100A: 'Private0019,100A_NumberOfImagesInMosaic',
    0x0051100A: 'Private0051,100A_Mosaic',
    0x0051100B: 'Private0051,100B_Mosaic',
};

export interface ParsedDicom {
    isValid: boolean;
    error?: string;

    // Meta
    transferSyntaxUid?: string;

    // Patient
    patientName?: string;
    patientId?: string;

    // Study
    studyDate?: string;
    studyTime?: string;
    accessionNumber?: string;
    studyDescription?: string;
    studyInstanceUid?: string;

    // Series
    modality?: string;
    seriesDescription?: string;
    seriesInstanceUid?: string;
    seriesNumber?: number;

    // Instance
    instanceNumber?: number;
    sopInstanceUid?: string;
    sopClassUid?: string;
    imageType?: string;
    derivationDescription?: string;

    // Geometry
    imageOrientationPatient?: string;
    imagePositionPatient?: string;
    pixelSpacing?: string;
    imagerPixelSpacing?: string;
    rows?: number;
    columns?: number;
    bitsAllocated?: number;
    bitsStored?: number;
    highBit?: number;
    pixelRepresentation?: number;
    photometricInterpretation?: string;
    samplesPerPixel?: number;
    numberOfFrames?: number;
    ultrasoundRegionSequence?: boolean;
    mosaicEvidenceTags?: string[];

    // Windowing
    windowCenter?: number;
    windowWidth?: number;
    rescaleSlope?: number;
    rescaleIntercept?: number;
}

/**
 * Parse DICOM file header - reads minimal bytes needed
 * Stops at PixelData tag to avoid reading image data
 */
export async function parseDicomHeader(file: File): Promise<ParsedDicom> {
    try {
        // Read first chunk - usually enough for all metadata
        // Most DICOM headers are < 64KB, but some can be larger
        const INITIAL_READ = 64 * 1024;
        const MAX_READ = 512 * 1024; // Don't read more than 512KB for headers

        let buffer = await readFileChunk(file, 0, Math.min(INITIAL_READ, file.size));
        let view = new DataView(buffer);

        // Check for DICM magic at offset 128
        if (buffer.byteLength < 132) {
            return { isValid: false, error: 'File too small' };
        }

        const magic = String.fromCharCode(
            view.getUint8(128),
            view.getUint8(129),
            view.getUint8(130),
            view.getUint8(131)
        );

        if (magic !== 'DICM') {
            // Try without preamble (rare but valid)
            return { isValid: false, error: 'Not a DICOM file (no DICM magic)' };
        }

        const result: ParsedDicom = { isValid: true };
        let offset = 132; // Start after preamble + magic
        let isExplicitVR = true; // Assume explicit VR initially
        let isLittleEndian = true; // Assume little endian initially

        // Parse meta information group (0002) - always explicit VR little endian
        while (offset < buffer.byteLength - 8) {
            // Check if we need more data
            if (offset > buffer.byteLength - 256 && buffer.byteLength < MAX_READ) {
                const newSize = Math.min(buffer.byteLength * 2, MAX_READ, file.size);
                if (newSize > buffer.byteLength) {
                    buffer = await readFileChunk(file, 0, newSize);
                    view = new DataView(buffer);
                }
            }

            if (offset >= buffer.byteLength - 8) break;

            // Read tag
            const group = view.getUint16(offset, isLittleEndian);
            const element = view.getUint16(offset + 2, isLittleEndian);
            const tag = (group << 16) | element;
            offset += 4;

            if (tag === TAGS.UltrasoundRegionSequence) {
                result.ultrasoundRegionSequence = true;
            }
            const mosaicTag = MOSAIC_TAGS[tag];
            if (mosaicTag) {
                if (!result.mosaicEvidenceTags) result.mosaicEvidenceTags = [];
                if (!result.mosaicEvidenceTags.includes(mosaicTag)) {
                    result.mosaicEvidenceTags.push(mosaicTag);
                }
            }

            // Stop at PixelData
            if (tag === TAGS.PixelData) {
                break;
            }

            // After group 0002, check transfer syntax to determine VR encoding
            if (group > 0x0002 && result.transferSyntaxUid) {
                // Determine encoding from transfer syntax
                const ts = result.transferSyntaxUid;
                isExplicitVR = !ts.startsWith('1.2.840.10008.1.2') ||
                    ts === '1.2.840.10008.1.2.1' || // Explicit VR Little Endian
                    ts === '1.2.840.10008.1.2.2';   // Explicit VR Big Endian
                isLittleEndian = ts !== '1.2.840.10008.1.2.2';
            }

            // Group 0002 is always explicit VR little endian
            const useExplicitVR = group === 0x0002 || isExplicitVR;

            let vr = '';
            let valueLength: number;

            if (useExplicitVR) {
                // Read VR (2 chars)
                if (offset + 2 > buffer.byteLength) break;
                vr = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1));
                offset += 2;

                if (VR_32BIT.has(vr)) {
                    // 2 bytes reserved + 4 byte length
                    if (offset + 6 > buffer.byteLength) break;
                    offset += 2; // Skip reserved
                    valueLength = view.getUint32(offset, isLittleEndian);
                    offset += 4;
                } else {
                    // 2 byte length
                    if (offset + 2 > buffer.byteLength) break;
                    valueLength = view.getUint16(offset, isLittleEndian);
                    offset += 2;
                }
            } else {
                // Implicit VR - 4 byte length
                if (offset + 4 > buffer.byteLength) break;
                valueLength = view.getUint32(offset, isLittleEndian);
                offset += 4;
            }

            // Undefined length (sequences) - skip for now
            if (valueLength === 0xFFFFFFFF) {
                // Skip sequences - not needed for basic indexing
                offset = skipSequence(buffer, view, offset, isLittleEndian);
                continue;
            }

            // Don't read beyond buffer
            if (offset + valueLength > buffer.byteLength) {
                // Need more data
                if (buffer.byteLength < MAX_READ && file.size > buffer.byteLength) {
                    const newSize = Math.min(offset + valueLength + 1024, MAX_READ, file.size);
                    buffer = await readFileChunk(file, 0, newSize);
                    view = new DataView(buffer);

                    if (offset + valueLength > buffer.byteLength) {
                        break; // Still not enough, give up on this tag
                    }
                } else {
                    break;
                }
            }

            // Extract value for tags we care about
            const value = extractValue(buffer, offset, valueLength, vr, isLittleEndian);
            offset += valueLength;

            // Map to result fields
            switch (tag) {
                case TAGS.TransferSyntaxUID:
                    result.transferSyntaxUid = value as string;
                    break;
                case TAGS.PatientName:
                    result.patientName = value as string;
                    break;
                case TAGS.PatientID:
                    result.patientId = value as string;
                    break;
                case TAGS.StudyDate:
                    result.studyDate = value as string;
                    break;
                case TAGS.StudyTime:
                    result.studyTime = value as string;
                    break;
                case TAGS.AccessionNumber:
                    result.accessionNumber = value as string;
                    break;
                case TAGS.StudyDescription:
                    result.studyDescription = value as string;
                    break;
                case TAGS.StudyInstanceUID:
                    result.studyInstanceUid = value as string;
                    break;
                case TAGS.Modality:
                    result.modality = value as string;
                    break;
                case TAGS.SeriesDescription:
                    result.seriesDescription = value as string;
                    break;
                case TAGS.SeriesInstanceUID:
                    result.seriesInstanceUid = value as string;
                    break;
                case TAGS.SeriesNumber:
                    result.seriesNumber = parseIntValue(value);
                    break;
                case TAGS.InstanceNumber:
                    result.instanceNumber = parseIntValue(value);
                    break;
                case TAGS.SOPInstanceUID:
                    result.sopInstanceUid = value as string;
                    break;
                case TAGS.SOPClassUID:
                    result.sopClassUid = value as string;
                    break;
                case TAGS.ImageType:
                    result.imageType = value as string;
                    break;
                case TAGS.DerivationDescription:
                    result.derivationDescription = value as string;
                    break;
                case TAGS.NumberOfFrames:
                    result.numberOfFrames = parseIntValue(value);
                    break;
                case TAGS.ImageOrientationPatient:
                    result.imageOrientationPatient = value as string;
                    break;
                case TAGS.ImagePositionPatient:
                    result.imagePositionPatient = value as string;
                    break;
                case TAGS.PixelSpacing:
                    result.pixelSpacing = value as string;
                    break;
                case TAGS.ImagerPixelSpacing:
                    result.imagerPixelSpacing = value as string;
                    break;
                case TAGS.Rows:
                    result.rows = parseIntValue(value);
                    break;
                case TAGS.Columns:
                    result.columns = parseIntValue(value);
                    break;
                case TAGS.SamplesPerPixel:
                    result.samplesPerPixel = parseIntValue(value);
                    break;
                case TAGS.BitsAllocated:
                    result.bitsAllocated = parseIntValue(value);
                    break;
                case TAGS.BitsStored:
                    result.bitsStored = parseIntValue(value);
                    break;
                case TAGS.HighBit:
                    result.highBit = parseIntValue(value);
                    break;
                case TAGS.PixelRepresentation:
                    result.pixelRepresentation = parseIntValue(value);
                    break;
                case TAGS.PhotometricInterpretation:
                    result.photometricInterpretation = value as string;
                    break;
                case TAGS.WindowCenter:
                    result.windowCenter = parseFloatValue(value);
                    break;
                case TAGS.WindowWidth:
                    result.windowWidth = parseFloatValue(value);
                    break;
                case TAGS.RescaleSlope:
                    result.rescaleSlope = parseFloatValue(value);
                    break;
                case TAGS.RescaleIntercept:
                    result.rescaleIntercept = parseFloatValue(value);
                    break;
            }
        }

        // Validate required fields
        if (!result.studyInstanceUid || !result.seriesInstanceUid || !result.sopInstanceUid) {
            result.isValid = false;
            result.error = 'Missing required DICOM UIDs';
            return result;
        }

        return result;
    } catch (err) {
        return {
            isValid: false,
            error: err instanceof Error ? err.message : 'Parse error',
        };
    }
}

/**
 * Read a chunk of a file
 */
async function readFileChunk(file: File, start: number, end: number): Promise<ArrayBuffer> {
    const blob = file.slice(start, end);
    return blob.arrayBuffer();
}

/**
 * Extract value from buffer based on VR type
 */
function extractValue(
    buffer: ArrayBuffer,
    offset: number,
    length: number,
    vr: string,
    littleEndian: boolean
): string | number | null {
    if (length === 0) return '';

    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer, offset, length);

    // String types
    if (['AE', 'AS', 'CS', 'DA', 'DS', 'DT', 'IS', 'LO', 'LT', 'PN', 'SH', 'ST', 'TM', 'UC', 'UI', 'UR', 'UT'].includes(vr) || vr === '') {
        // Decode as ASCII, trim padding
        let str = '';
        for (let i = 0; i < length; i++) {
            const c = bytes[i];
            if (c === 0) break; // Null terminator
            str += String.fromCharCode(c);
        }
        return str.trim().replace(/\0/g, '');
    }

    // Numeric types
    switch (vr) {
        case 'US': // Unsigned short
            return length >= 2 ? view.getUint16(offset, littleEndian) : null;
        case 'SS': // Signed short
            return length >= 2 ? view.getInt16(offset, littleEndian) : null;
        case 'UL': // Unsigned long
            return length >= 4 ? view.getUint32(offset, littleEndian) : null;
        case 'SL': // Signed long
            return length >= 4 ? view.getInt32(offset, littleEndian) : null;
        case 'FL': // Float
            return length >= 4 ? view.getFloat32(offset, littleEndian) : null;
        case 'FD': // Double
            return length >= 8 ? view.getFloat64(offset, littleEndian) : null;
        default:
            // Try string for unknown VR
            let str = '';
            for (let i = 0; i < Math.min(length, 256); i++) {
                const c = bytes[i];
                if (c === 0) break;
                if (c >= 32 && c < 127) str += String.fromCharCode(c);
            }
            return str.trim();
    }
}

/**
 * Parse integer from string or number value
 */
function parseIntValue(value: string | number | null): number | undefined {
    if (value === null || value === '') return undefined;
    if (typeof value === 'number') return Math.floor(value);
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? undefined : parsed;
}

/**
 * Parse float from string or number value
 */
function parseFloatValue(value: string | number | null): number | undefined {
    if (value === null || value === '') return undefined;
    if (typeof value === 'number') return value;
    // Handle multi-value (take first)
    const str = String(value).split('\\')[0];
    const parsed = parseFloat(str);
    return isNaN(parsed) ? undefined : parsed;
}

/**
 * Skip a sequence element with undefined length
 */
function skipSequence(
    buffer: ArrayBuffer,
    view: DataView,
    offset: number,
    littleEndian: boolean
): number {
    // Look for sequence delimitation item (FFFE,E0DD)
    while (offset < buffer.byteLength - 8) {
        const group = view.getUint16(offset, littleEndian);
        const element = view.getUint16(offset + 2, littleEndian);

        if (group === 0xFFFE && element === 0xE0DD) {
            // Found delimiter, skip it
            offset += 8;
            break;
        }

        // Skip this item
        offset += 4;
        const len = view.getUint32(offset, littleEndian);
        offset += 4;

        if (len !== 0xFFFFFFFF) {
            offset += len;
        }
    }

    return offset;
}

/**
 * Quick check if a file might be DICOM (checks magic bytes only)
 */
export async function isDicomFile(file: File): Promise<boolean> {
    if (file.size < 132) return false;

    try {
        const buffer = await readFileChunk(file, 128, 132);
        const magic = new Uint8Array(buffer);
        return magic[0] === 68 && magic[1] === 73 && magic[2] === 67 && magic[3] === 77; // "DICM"
    } catch {
        return false;
    }
}
