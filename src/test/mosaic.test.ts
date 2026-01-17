import { describe, it, expect } from 'vitest';
import { computeMosaicTileRect, resolveMosaicGrid } from '../core/mosaic';

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
