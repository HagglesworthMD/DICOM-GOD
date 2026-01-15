/**
 * DICOM Pixel Data Decoder
 * Extracts and decodes pixel data from DICOM files
 * Supports: Implicit/Explicit VR Little Endian, RLE Lossless
 */

import { decodeRLE, rleToTypedArray } from './rleDecoder';
import { SUPPORTED_TRANSFER_SYNTAXES, isTransferSyntaxSupported } from './types';
import type { DecodedFrame } from './types';

// DICOM Tags
const TAGS = {
    TransferSyntaxUID: 0x00020010,
    Rows: 0x00280010,
    Columns: 0x00280011,
    BitsAllocated: 0x00280100,
    BitsStored: 0x00280101,
    HighBit: 0x00280102,
    PixelRepresentation: 0x00280103,
    SamplesPerPixel: 0x00280002,
    PhotometricInterpretation: 0x00280004,
    WindowCenter: 0x00281050,
    WindowWidth: 0x00281051,
    RescaleSlope: 0x00281053,
    RescaleIntercept: 0x00281052,
    NumberOfFrames: 0x00280008,
    PixelData: 0x7FE00010,
} as const;

const VR_32BIT = new Set(['OB', 'OD', 'OF', 'OL', 'OW', 'SQ', 'UC', 'UN', 'UR', 'UT']);

interface ParsedPixelInfo {
    rows: number;
    columns: number;
    bitsAllocated: number;
    bitsStored: number;
    highBit: number;
    pixelRepresentation: number;
    samplesPerPixel: number;
    photometricInterpretation: string;
    windowCenter: number;
    windowWidth: number;
    rescaleSlope: number;
    rescaleIntercept: number;
    numberOfFrames: number;
    transferSyntaxUid: string;
    pixelDataOffset: number;
    pixelDataLength: number;
    isEncapsulated: boolean;
}

/**
 * Decode a DICOM file and extract pixel data
 */
export async function decodePixelData(
    file: File,
    frameNumber = 0
): Promise<DecodedFrame> {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);



    // Parse to get pixel info and locate pixel data
    const info = parseForPixelData(buffer, view);



    // Check transfer syntax support
    if (!isTransferSyntaxSupported(info.transferSyntaxUid)) {
        throw new UnsupportedTransferSyntaxError(info.transferSyntaxUid);
    }

    // Check multi-frame
    if (info.numberOfFrames > 1 && frameNumber >= info.numberOfFrames) {
        throw new Error(`Frame ${frameNumber} out of range (${info.numberOfFrames} frames)`);
    }

    // Extract pixel data
    let pixelData: Int16Array | Uint16Array | Uint8Array;

    if (info.isEncapsulated) {
        // RLE encoded
        const rleData = extractEncapsulatedFrame(buffer, info.pixelDataOffset, frameNumber);
        const decoded = decodeRLE(
            rleData,
            info.columns,
            info.rows,
            info.bitsAllocated,
            info.samplesPerPixel
        );
        pixelData = rleToTypedArray(decoded, info.bitsAllocated, info.pixelRepresentation);
    } else {
        // Uncompressed
        pixelData = extractUncompressedFrame(
            buffer,
            info,
            frameNumber
        );
    }

    // Calculate min/max
    let minValue = Number.MAX_VALUE;
    let maxValue = Number.MIN_VALUE;
    for (let i = 0; i < pixelData.length; i++) {
        const v = pixelData[i];
        if (v < minValue) minValue = v;
        if (v > maxValue) maxValue = v;
    }

    // Default window if not specified
    let wc = info.windowCenter;
    let ww = info.windowWidth;
    if (ww === 0) {
        const min = minValue * info.rescaleSlope + info.rescaleIntercept;
        const max = maxValue * info.rescaleSlope + info.rescaleIntercept;
        wc = (min + max) / 2;
        ww = Math.max(1, max - min);
    }

    return {
        pixelData,
        width: info.columns,
        height: info.rows,
        bitsStored: info.bitsStored,
        isSigned: info.pixelRepresentation === 1,
        minValue,
        maxValue,
        rescaleSlope: info.rescaleSlope,
        rescaleIntercept: info.rescaleIntercept,
        windowCenter: wc,
        windowWidth: ww,
        photometricInterpretation: info.photometricInterpretation,
        samplesPerPixel: info.samplesPerPixel,
    };
}

/**
 * Parse DICOM file for pixel data info
 */
function parseForPixelData(buffer: ArrayBuffer, view: DataView): ParsedPixelInfo {
    // Check DICM magic
    if (buffer.byteLength < 132) {
        throw new Error('File too small');
    }

    const magic = String.fromCharCode(
        view.getUint8(128), view.getUint8(129), view.getUint8(130), view.getUint8(131)
    );
    if (magic !== 'DICM') {
        throw new Error('Not a DICOM file');
    }

    const info: ParsedPixelInfo = {
        rows: 0,
        columns: 0,
        bitsAllocated: 16,
        bitsStored: 16,
        highBit: 15,
        pixelRepresentation: 0,
        samplesPerPixel: 1,
        photometricInterpretation: 'MONOCHROME2',
        windowCenter: 0,
        windowWidth: 0,
        rescaleSlope: 1,
        rescaleIntercept: 0,
        numberOfFrames: 1,
        transferSyntaxUid: SUPPORTED_TRANSFER_SYNTAXES.EXPLICIT_VR_LE,
        pixelDataOffset: 0,
        pixelDataLength: 0,
        isEncapsulated: false,
    };

    let offset = 132;
    let isExplicitVR = true;
    let isLittleEndian = true;

    while (offset < buffer.byteLength - 8) {
        const group = view.getUint16(offset, isLittleEndian);
        const element = view.getUint16(offset + 2, isLittleEndian);
        const tag = (group << 16) | element;
        offset += 4;

        // Update encoding after meta group
        if (group > 0x0002 && info.transferSyntaxUid) {
            const ts = info.transferSyntaxUid;
            isExplicitVR = ts !== SUPPORTED_TRANSFER_SYNTAXES.IMPLICIT_VR_LE;
            isLittleEndian = ts !== '1.2.840.10008.1.2.2';
            info.isEncapsulated = ts === SUPPORTED_TRANSFER_SYNTAXES.RLE_LOSSLESS;
        }

        const useExplicitVR = group === 0x0002 || isExplicitVR;

        let vr = '';
        let valueLength: number;

        if (useExplicitVR) {
            if (offset + 2 > buffer.byteLength) break;
            vr = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1));
            offset += 2;

            if (VR_32BIT.has(vr)) {
                if (offset + 6 > buffer.byteLength) break;
                offset += 2;
                valueLength = view.getUint32(offset, isLittleEndian);
                offset += 4;
            } else {
                if (offset + 2 > buffer.byteLength) break;
                valueLength = view.getUint16(offset, isLittleEndian);
                offset += 2;
            }
        } else {
            if (offset + 4 > buffer.byteLength) break;
            valueLength = view.getUint32(offset, isLittleEndian);
            offset += 4;
        }

        // Pixel data - record location and stop
        if (tag === TAGS.PixelData) {
            info.pixelDataOffset = offset;
            info.pixelDataLength = valueLength === 0xFFFFFFFF ? buffer.byteLength - offset : valueLength;
            break;
        }

        // Skip undefined length sequences
        if (valueLength === 0xFFFFFFFF) {
            offset = skipSequence(view, offset, isLittleEndian, buffer.byteLength);
            continue;
        }

        if (offset + valueLength > buffer.byteLength) break;

        // Extract values we need
        const value = extractValue(buffer, view, offset, valueLength, vr, isLittleEndian);
        offset += valueLength;

        switch (tag) {
            case TAGS.TransferSyntaxUID:
                info.transferSyntaxUid = value as string;
                break;
            case TAGS.Rows:
                info.rows = value as number;
                break;
            case TAGS.Columns:
                info.columns = value as number;
                break;
            case TAGS.BitsAllocated:
                info.bitsAllocated = value as number;
                break;
            case TAGS.BitsStored:
                info.bitsStored = value as number;
                break;
            case TAGS.HighBit:
                info.highBit = value as number;
                break;
            case TAGS.PixelRepresentation:
                info.pixelRepresentation = value as number;
                break;
            case TAGS.SamplesPerPixel:
                info.samplesPerPixel = value as number;
                break;
            case TAGS.PhotometricInterpretation:
                info.photometricInterpretation = value as string;
                break;
            case TAGS.WindowCenter:
                info.windowCenter = parseFloat(String(value)) || 0;
                break;
            case TAGS.WindowWidth:
                info.windowWidth = parseFloat(String(value)) || 0;
                break;
            case TAGS.RescaleSlope:
                info.rescaleSlope = parseFloat(String(value)) || 1;
                break;
            case TAGS.RescaleIntercept:
                info.rescaleIntercept = parseFloat(String(value)) || 0;
                break;
            case TAGS.NumberOfFrames:
                info.numberOfFrames = parseInt(String(value), 10) || 1;
                break;
        }
    }

    if (info.pixelDataOffset === 0) {
        throw new Error('No pixel data found');
    }

    return info;
}

function extractValue(
    buffer: ArrayBuffer,
    view: DataView,
    offset: number,
    length: number,
    vr: string,
    littleEndian: boolean
): string | number {
    if (length === 0) return '';

    const bytes = new Uint8Array(buffer, offset, length);

    if (['UI', 'LO', 'SH', 'CS', 'DS', 'IS', 'DA', 'TM', 'PN', 'LT', 'ST', ''].includes(vr)) {
        let str = '';
        for (let i = 0; i < length; i++) {
            const c = bytes[i];
            if (c === 0) break;
            str += String.fromCharCode(c);
        }
        return str.trim();
    }

    if (vr === 'US') return view.getUint16(offset, littleEndian);
    if (vr === 'SS') return view.getInt16(offset, littleEndian);
    if (vr === 'UL') return view.getUint32(offset, littleEndian);
    if (vr === 'SL') return view.getInt32(offset, littleEndian);

    // Default: try string
    let str = '';
    for (let i = 0; i < Math.min(length, 64); i++) {
        const c = bytes[i];
        if (c === 0) break;
        if (c >= 32 && c < 127) str += String.fromCharCode(c);
    }
    return str.trim();
}

function skipSequence(view: DataView, offset: number, littleEndian: boolean, maxLen: number): number {
    while (offset < maxLen - 8) {
        const group = view.getUint16(offset, littleEndian);
        const element = view.getUint16(offset + 2, littleEndian);
        if (group === 0xFFFE && element === 0xE0DD) {
            return offset + 8;
        }
        offset += 4;
        const len = view.getUint32(offset, littleEndian);
        offset += 4;
        if (len !== 0xFFFFFFFF) offset += len;
    }
    return offset;
}

function extractUncompressedFrame(
    buffer: ArrayBuffer,
    info: ParsedPixelInfo,
    frameNumber: number
): Int16Array | Uint16Array | Uint8Array {
    const bytesPerPixel = (info.bitsAllocated / 8) * info.samplesPerPixel;
    const frameSize = info.rows * info.columns * bytesPerPixel;
    const frameOffset = info.pixelDataOffset + frameNumber * frameSize;

    if (frameOffset + frameSize > buffer.byteLength) {
        throw new Error('Frame data out of bounds');
    }

    const frameBuffer = buffer.slice(frameOffset, frameOffset + frameSize);

    if (info.bitsAllocated === 8) {
        return new Uint8Array(frameBuffer);
    }

    if (info.pixelRepresentation === 1) {
        return new Int16Array(frameBuffer);
    }
    return new Uint16Array(frameBuffer);
}

function extractEncapsulatedFrame(
    buffer: ArrayBuffer,
    pixelDataOffset: number,
    frameNumber: number
): ArrayBuffer {
    const view = new DataView(buffer);
    let offset = pixelDataOffset;

    // Skip Basic Offset Table (first item)
    // Item tag: (FFFE,E000)
    const itemGroup = view.getUint16(offset, true);
    const itemElement = view.getUint16(offset + 2, true);

    if (itemGroup !== 0xFFFE || itemElement !== 0xE000) {
        throw new Error('Expected encapsulated data item');
    }

    offset += 4;
    const botLength = view.getUint32(offset, true);
    offset += 4 + botLength; // Skip BOT

    // Find the frame we want
    let currentFrame = 0;
    while (offset < buffer.byteLength - 8) {
        const g = view.getUint16(offset, true);
        const e = view.getUint16(offset + 2, true);

        if (g === 0xFFFE && e === 0xE0DD) {
            throw new Error(`Frame ${frameNumber} not found`);
        }

        if (g !== 0xFFFE || e !== 0xE000) {
            throw new Error('Invalid encapsulated data');
        }

        offset += 4;
        const fragLength = view.getUint32(offset, true);
        offset += 4;

        if (currentFrame === frameNumber) {
            return buffer.slice(offset, offset + fragLength);
        }

        offset += fragLength;
        currentFrame++;
    }

    throw new Error(`Frame ${frameNumber} not found`);
}

export class UnsupportedTransferSyntaxError extends Error {
    transferSyntax: string;

    constructor(transferSyntax: string) {
        super(`Unsupported transfer syntax: ${transferSyntax}`);
        this.name = 'UnsupportedTransferSyntaxError';
        this.transferSyntax = transferSyntax;
    }
}

