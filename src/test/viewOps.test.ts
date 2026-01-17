
import { describe, it, expect } from 'vitest';
import { calculateNextFrame, getPreset, isSeriesScrollable, getScrollDisabledReason } from '../core/viewOps';

describe('viewOps', () => {
    describe('calculateNextFrame', () => {
        it('steps forward', () => {
            expect(calculateNextFrame(0, 10, 1, false)).toBe(1);
            expect(calculateNextFrame(5, 10, 2, false)).toBe(7);
        });

        it('steps backward', () => {
            expect(calculateNextFrame(5, 10, -1, false)).toBe(4);
            expect(calculateNextFrame(2, 10, -5, false)).toBe(0); // Clamp 0
        });

        it('clamps max', () => {
            expect(calculateNextFrame(9, 10, 1, false)).toBe(9);
            expect(calculateNextFrame(8, 10, 5, false)).toBe(9);
        });

        it('handles stack reverse', () => {
            // Forward step (1) on reverse stack -> index decreases (-1)
            expect(calculateNextFrame(5, 10, 1, true)).toBe(4);
            // Backward step (-1) on reverse stack -> index increases (1)
            expect(calculateNextFrame(5, 10, -1, true)).toBe(6);
        });
    });

    describe('getPreset', () => {
        it('returns correct preset', () => {
            const p = getPreset('1');
            expect(p).toBeTruthy();
            expect(p?.label).toBe('Soft Tissue');
        });

        it('returns null for invalid key', () => {
            expect(getPreset('9')).toBeNull();
        });
    });

    describe('isSeriesScrollable', () => {
        it('returns true for stack series', () => {
            expect(isSeriesScrollable('stack')).toBe(true);
        });

        it('returns true for multiframe series', () => {
            expect(isSeriesScrollable('multiframe')).toBe(true);
        });

        it('returns false for single frame series', () => {
            expect(isSeriesScrollable('single')).toBe(false);
        });

        it('returns false for unsafe series', () => {
            expect(isSeriesScrollable('unsafe')).toBe(false);
        });
    });

    describe('getScrollDisabledReason', () => {
        it('returns reason for single frame', () => {
            expect(getScrollDisabledReason('single')).toBe('Single-frame series');
        });

        it('returns custom cineReason for unsafe series', () => {
            expect(getScrollDisabledReason('unsafe', 'Mixed orientations')).toBe('Mixed orientations');
        });

        it('returns fallback for unsafe series without cineReason', () => {
            expect(getScrollDisabledReason('unsafe')).toBe('Unsafe series geometry');
        });

        it('returns null for scrollable series', () => {
            expect(getScrollDisabledReason('stack')).toBeNull();
            expect(getScrollDisabledReason('multiframe')).toBeNull();
        });
    });
});
