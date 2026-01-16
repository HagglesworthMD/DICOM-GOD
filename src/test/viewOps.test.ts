
import { describe, it, expect } from 'vitest';
import { calculateNextFrame, getPreset } from '../core/viewOps';

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
});
