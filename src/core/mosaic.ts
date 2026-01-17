export interface MosaicGrid {
    rows: number;
    cols: number;
    tileCount: number;
    assumedGrid: boolean;
}

export interface MosaicTileRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface MosaicPixelRegion {
    pixelData: Int16Array | Uint16Array | Uint8Array;
    width: number;
    height: number;
    minValue: number;
    maxValue: number;
}

export function resolveMosaicGrid(
    tileCount: number,
    rows?: number | null,
    cols?: number | null
): MosaicGrid | null {
    const safeTileCount = Math.max(0, Math.floor(tileCount));
    if (safeTileCount === 0) return null;

    let resolvedRows = rows ?? 0;
    let resolvedCols = cols ?? 0;
    let assumedGrid = false;

    if (resolvedRows <= 0 || resolvedCols <= 0) {
        const inferredCols = Math.ceil(Math.sqrt(safeTileCount)) || 1;
        const inferredRows = Math.ceil(safeTileCount / inferredCols) || 1;
        resolvedCols = inferredCols;
        resolvedRows = inferredRows;
        assumedGrid = true;
    }

    return {
        rows: resolvedRows,
        cols: resolvedCols,
        tileCount: safeTileCount,
        assumedGrid,
    };
}

export function computeMosaicTileRect(
    imageWidth: number,
    imageHeight: number,
    rows: number,
    cols: number,
    tileIndex: number
): MosaicTileRect {
    const safeRows = Math.max(1, Math.floor(rows));
    const safeCols = Math.max(1, Math.floor(cols));
    const maxIndex = safeRows * safeCols - 1;
    const safeIndex = Math.max(0, Math.min(tileIndex, maxIndex));

    const rawTileW = imageWidth / safeCols;
    const rawTileH = imageHeight / safeRows;

    const col = safeIndex % safeCols;
    const row = Math.floor(safeIndex / safeCols);

    const x = Math.floor(col * rawTileW);
    const y = Math.floor(row * rawTileH);
    const nextX = col === safeCols - 1 ? imageWidth : Math.floor((col + 1) * rawTileW);
    const nextY = row === safeRows - 1 ? imageHeight : Math.floor((row + 1) * rawTileH);

    return {
        x,
        y,
        w: Math.max(1, nextX - x),
        h: Math.max(1, nextY - y),
    };
}

function createPixelBuffer(
    source: Int16Array | Uint16Array | Uint8Array,
    length: number
): Int16Array | Uint16Array | Uint8Array {
    if (source instanceof Int16Array) return new Int16Array(length);
    if (source instanceof Uint16Array) return new Uint16Array(length);
    return new Uint8Array(length);
}

export function extractPixelRegion(
    pixelData: Int16Array | Uint16Array | Uint8Array,
    imageWidth: number,
    imageHeight: number,
    samplesPerPixel: number,
    sourceRect: MosaicTileRect
): MosaicPixelRegion {
    const srcX = Math.max(0, Math.min(Math.floor(sourceRect.x), imageWidth - 1));
    const srcY = Math.max(0, Math.min(Math.floor(sourceRect.y), imageHeight - 1));
    const srcW = Math.max(1, Math.min(Math.floor(sourceRect.w), imageWidth - srcX));
    const srcH = Math.max(1, Math.min(Math.floor(sourceRect.h), imageHeight - srcY));
    const safeSamples = Math.max(1, Math.floor(samplesPerPixel));
    const outputLength = srcW * srcH * safeSamples;
    const output = createPixelBuffer(pixelData, outputLength);

    let minValue = Number.POSITIVE_INFINITY;
    let maxValue = Number.NEGATIVE_INFINITY;

    for (let y = 0; y < srcH; y++) {
        const srcRowBase = ((srcY + y) * imageWidth + srcX) * safeSamples;
        const dstRowBase = (y * srcW) * safeSamples;
        for (let x = 0; x < srcW; x++) {
            const srcIdx = srcRowBase + x * safeSamples;
            const dstIdx = dstRowBase + x * safeSamples;
            for (let c = 0; c < safeSamples; c++) {
                const value = pixelData[srcIdx + c] ?? 0;
                output[dstIdx + c] = value;
                if (value < minValue) minValue = value;
                if (value > maxValue) maxValue = value;
            }
        }
    }

    if (minValue === Number.POSITIVE_INFINITY || maxValue === Number.NEGATIVE_INFINITY) {
        minValue = 0;
        maxValue = 0;
    }

    return {
        pixelData: output,
        width: srcW,
        height: srcH,
        minValue,
        maxValue,
    };
}
