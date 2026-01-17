import { describe, it, expect } from 'vitest';
import { computeMosaicTileRect, extractPixelRegion, resolveMosaicGrid } from '../core/mosaic';

describe('computeMosaicTileRect', () => {
    it('computes correct source rect for center tile in 3x3 grid', () => {
        const rect = computeMosaicTileRect(300, 300, 3, 3, 4);
        expect(rect).toEqual({ x: 100, y: 100, w: 100, h: 100 });
    });
});

describe('resolveMosaicGrid', () => {
    it('infers grid when rows/cols are missing', () => {
        const grid = resolveMosaicGrid(43, null, null);
        expect(grid).not.toBeNull();
        expect(grid?.assumedGrid).toBe(true);
        expect((grid?.rows ?? 0) * (grid?.cols ?? 0)).toBeGreaterThanOrEqual(43);
    });
});

describe('extractPixelRegion', () => {
    it('extracts the correct tile pixels in row-major order', () => {
        const pixelData = new Uint8Array(16);
        for (let i = 0; i < pixelData.length; i++) {
            pixelData[i] = i;
        }

        const region = extractPixelRegion(
            pixelData,
            4,
            4,
            1,
            { x: 2, y: 2, w: 2, h: 2 }
        );

        expect(region.width).toBe(2);
        expect(region.height).toBe(2);
        expect(Array.from(region.pixelData)).toEqual([10, 11, 14, 15]);
        expect(region.minValue).toBe(10);
        expect(region.maxValue).toBe(15);
    });
});
