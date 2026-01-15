/**
 * RLE Lossless Decoder for DICOM
 * Implements DICOM RLE compression (Transfer Syntax 1.2.840.10008.1.2.5)
 */

/**
 * Decode RLE compressed DICOM pixel data
 * Returns the decompressed bytes
 */
export function decodeRLE(
    compressedData: ArrayBuffer,
    width: number,
    height: number,
    bitsAllocated: number,
    samplesPerPixel: number
): Uint8Array {
    const view = new DataView(compressedData);

    // RLE header: number of segments (uint32) + 15 segment offsets (uint32 each)
    const numSegments = view.getUint32(0, true);

    if (numSegments === 0 || numSegments > 15) {
        throw new Error(`Invalid RLE segment count: ${numSegments}`);
    }

    // Read segment offsets
    const offsets: number[] = [];
    for (let i = 0; i < numSegments; i++) {
        offsets.push(view.getUint32(4 + i * 4, true));
    }

    // Calculate output size
    const bytesPerPixel = (bitsAllocated / 8) * samplesPerPixel;
    const outputSize = width * height * bytesPerPixel;
    const output = new Uint8Array(outputSize);

    // For each segment
    const bytesPerSegment = width * height;

    for (let seg = 0; seg < numSegments; seg++) {
        const segmentStart = offsets[seg];
        const segmentEnd = seg + 1 < numSegments
            ? offsets[seg + 1]
            : compressedData.byteLength;

        // Decode this segment
        let srcPos = segmentStart;
        let dstPos = 0;
        const segmentOutput = new Uint8Array(bytesPerSegment);

        while (srcPos < segmentEnd && dstPos < bytesPerSegment) {
            const n = view.getInt8(srcPos++);

            if (n >= 0) {
                // Literal run: copy next n+1 bytes
                const count = n + 1;
                for (let i = 0; i < count && srcPos < segmentEnd && dstPos < bytesPerSegment; i++) {
                    segmentOutput[dstPos++] = view.getUint8(srcPos++);
                }
            } else if (n >= -127) {
                // Replicate run: repeat next byte -(n)+1 times
                const count = -n + 1;
                if (srcPos < segmentEnd) {
                    const value = view.getUint8(srcPos++);
                    for (let i = 0; i < count && dstPos < bytesPerSegment; i++) {
                        segmentOutput[dstPos++] = value;
                    }
                }
            }
            // n === -128 is a no-op
        }

        // Interleave segment into output
        // For 16-bit data, segment 0 is high bytes, segment 1 is low bytes
        // For RGB, segments are per-plane
        if (bitsAllocated === 8) {
            // 8-bit: simple copy for grayscale, interleave for RGB
            if (samplesPerPixel === 1) {
                output.set(segmentOutput);
            } else {
                // RGB: plane interleave
                for (let i = 0; i < bytesPerSegment && i < dstPos; i++) {
                    output[i * samplesPerPixel + seg] = segmentOutput[i];
                }
            }
        } else if (bitsAllocated === 16) {
            // 16-bit: segments are byte planes (high/low)
            // Segment 0 = low bytes, Segment 1 = high bytes (little endian output)
            const byteOffset = seg;
            for (let i = 0; i < bytesPerSegment && i < dstPos; i++) {
                const pixelIdx = i;
                output[pixelIdx * 2 + (1 - byteOffset)] = segmentOutput[i];
            }
        }
    }

    return output;
}

/**
 * Convert decoded RLE bytes to typed array
 */
export function rleToTypedArray(
    decodedBytes: Uint8Array,
    bitsAllocated: number,
    pixelRepresentation: number
): Uint8Array | Uint16Array | Int16Array {
    if (bitsAllocated === 8) {
        return decodedBytes;
    }

    if (bitsAllocated === 16) {
        // Create 16-bit view
        const buffer = decodedBytes.buffer.slice(
            decodedBytes.byteOffset,
            decodedBytes.byteOffset + decodedBytes.byteLength
        );

        if (pixelRepresentation === 1) {
            return new Int16Array(buffer);
        }
        return new Uint16Array(buffer);
    }

    throw new Error(`Unsupported bits allocated: ${bitsAllocated}`);
}
