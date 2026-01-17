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
