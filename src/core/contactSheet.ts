/**
 * Contact Sheet Detection
 * Detects grid/montage layouts baked into ultrasound images
 * 
 * Two detection methods:
 * 1. US Regions Sequence (0018,6011) - DICOM standard, high confidence 🟢
 * 2. Heuristic gutter detection - image analysis, lower confidence 🟡
 */

import type { ContactSheet, ContactSheetTile, DecodedFrame } from './types';

/** Common grid configurations to test (cols × rows) */
const CANDIDATE_GRIDS: [number, number][] = [
    [2, 2],  // 4 tiles
    [3, 2],  // 6 tiles
    [2, 3],  // 6 tiles
    [3, 3],  // 9 tiles
    [4, 3],  // 12 tiles (most common for US cine)
    [3, 4],  // 12 tiles
    [4, 4],  // 16 tiles
];

/** Minimum score threshold for heuristic detection */
const HEURISTIC_THRESHOLD = 0.6;

/** Number of sample points per gutter line */
const GUTTER_SAMPLE_COUNT = 20;

/** Gutter darkness threshold (0-255, lower = darker) */
const GUTTER_DARKNESS_THRESHOLD = 30;

/**
 * Detect contact sheet grid from decoded frame using heuristics
 * 🟡 Heuristic: samples expected gutter lines for dark separators
 */
export function detectContactSheetHeuristic(
    frame: DecodedFrame
): ContactSheet | null {
    const { width, height, pixelData, samplesPerPixel } = frame;

    // Skip if image is too small or not single-channel grayscale
    if (width < 200 || height < 200) return null;

    let bestScore = 0;
    let bestGrid: [number, number] | null = null;

    for (const [cols, rows] of CANDIDATE_GRIDS) {
        const score = scoreGrid(pixelData, width, height, cols, rows, samplesPerPixel);
        if (score > bestScore) {
            bestScore = score;
            bestGrid = [cols, rows];
        }
    }

    // Must exceed threshold
    if (bestScore < HEURISTIC_THRESHOLD || !bestGrid) {
        return null;
    }

    const [cols, rows] = bestGrid;
    const tiles = generateTiles(width, height, cols, rows);

    return {
        kind: 'heuristic',
        grid: { cols, rows },
        tiles,
        reason: `Detected ${cols}×${rows} grid (confidence: ${Math.round(bestScore * 100)}%)`
    };
}

/**
 * Score a grid configuration by checking for dark gutter lines
 */
function scoreGrid(
    pixelData: Int16Array | Uint16Array | Uint8Array,
    width: number,
    height: number,
    cols: number,
    rows: number,
    samplesPerPixel: number
): number {
    const tileWidth = Math.floor(width / cols);
    const tileHeight = Math.floor(height / rows);

    // Skip grids that result in tiny tiles
    if (tileWidth < 50 || tileHeight < 50) return 0;

    let totalDarkSamples = 0;
    let totalSamples = 0;

    // Check vertical gutters (between columns)
    for (let c = 1; c < cols; c++) {
        const gutterX = c * tileWidth;
        const darkCount = sampleVerticalLine(pixelData, width, height, gutterX, samplesPerPixel);
        totalDarkSamples += darkCount;
        totalSamples += GUTTER_SAMPLE_COUNT;
    }

    // Check horizontal gutters (between rows)
    for (let r = 1; r < rows; r++) {
        const gutterY = r * tileHeight;
        const darkCount = sampleHorizontalLine(pixelData, width, height, gutterY, samplesPerPixel);
        totalDarkSamples += darkCount;
        totalSamples += GUTTER_SAMPLE_COUNT;
    }

    // Also sample edges (left, right, top, bottom) - often dark borders
    const edgeScore = sampleEdges(pixelData, width, height, samplesPerPixel);

    // Combine gutter score with edge score
    const gutterScore = totalSamples > 0 ? totalDarkSamples / totalSamples : 0;

    // Weight: 80% gutter, 20% edge
    return gutterScore * 0.8 + edgeScore * 0.2;
}

/**
 * Sample vertical line for dark pixels
 */
function sampleVerticalLine(
    pixelData: Int16Array | Uint16Array | Uint8Array,
    width: number,
    height: number,
    x: number,
    samplesPerPixel: number
): number {
    let darkCount = 0;
    const step = Math.floor(height / GUTTER_SAMPLE_COUNT);

    for (let i = 0; i < GUTTER_SAMPLE_COUNT; i++) {
        const y = Math.min(i * step, height - 1);
        const value = getPixelValue(pixelData, width, x, y, samplesPerPixel);
        if (value < GUTTER_DARKNESS_THRESHOLD) {
            darkCount++;
        }
    }

    return darkCount;
}

/**
 * Sample horizontal line for dark pixels
 */
function sampleHorizontalLine(
    pixelData: Int16Array | Uint16Array | Uint8Array,
    width: number,
    _height: number,
    y: number,
    samplesPerPixel: number
): number {
    let darkCount = 0;
    const step = Math.floor(width / GUTTER_SAMPLE_COUNT);

    for (let i = 0; i < GUTTER_SAMPLE_COUNT; i++) {
        const x = Math.min(i * step, width - 1);
        const value = getPixelValue(pixelData, width, x, y, samplesPerPixel);
        if (value < GUTTER_DARKNESS_THRESHOLD) {
            darkCount++;
        }
    }

    return darkCount;
}

/**
 * Sample image edges for dark borders
 */
function sampleEdges(
    pixelData: Int16Array | Uint16Array | Uint8Array,
    width: number,
    height: number,
    samplesPerPixel: number
): number {
    let darkCount = 0;
    const totalSamples = GUTTER_SAMPLE_COUNT * 4;

    // Top edge
    darkCount += sampleHorizontalLine(pixelData, width, height, 0, samplesPerPixel);
    // Bottom edge
    darkCount += sampleHorizontalLine(pixelData, width, height, height - 1, samplesPerPixel);
    // Left edge
    darkCount += sampleVerticalLine(pixelData, width, height, 0, samplesPerPixel);
    // Right edge
    darkCount += sampleVerticalLine(pixelData, width, height, width - 1, samplesPerPixel);

    return darkCount / totalSamples;
}

/**
 * Get pixel value at (x, y), normalized to 0-255 range
 */
function getPixelValue(
    pixelData: Int16Array | Uint16Array | Uint8Array,
    width: number,
    x: number,
    y: number,
    samplesPerPixel: number
): number {
    const idx = (y * width + x) * samplesPerPixel;
    const raw = pixelData[idx] ?? 0;

    // Normalize based on data type
    if (pixelData instanceof Uint8Array) {
        return raw;
    } else if (pixelData instanceof Uint16Array) {
        return Math.floor((raw / 65535) * 255);
    } else {
        // Int16Array - handle signed values
        const normalized = (raw + 32768) / 65535;
        return Math.floor(normalized * 255);
    }
}

/**
 * Generate tile rectangles for a grid configuration
 */
export function generateTiles(
    width: number,
    height: number,
    cols: number,
    rows: number
): ContactSheetTile[] {
    const tileWidth = Math.floor(width / cols);
    const tileHeight = Math.floor(height / rows);
    const tiles: ContactSheetTile[] = [];

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            tiles.push({
                x: c * tileWidth,
                y: r * tileHeight,
                w: tileWidth,
                h: tileHeight
            });
        }
    }

    return tiles;
}

/**
 * Get tile at specific index
 */
export function getTileAtIndex(
    contactSheet: ContactSheet,
    index: number
): ContactSheetTile | null {
    if (index < 0 || index >= contactSheet.tiles.length) {
        return null;
    }
    return contactSheet.tiles[index];
}
