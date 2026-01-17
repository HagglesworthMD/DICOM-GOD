/**
 * Stack Scrub tests
 */

import { describe, it, expect } from 'vitest';
import {
    calculateScrubDelta,
    calculateScrubFrameIndex,
    PIXELS_PER_FRAME,
    SHIFT_MULTIPLIER,
} from '../core/stackScrub';

describe('stackScrub', () => {
    describe('calculateScrubDelta', () => {
        it('returns 0 when no movement', () => {
            expect(calculateScrubDelta(100, 100, false)).toBe(0);
        });

        it('returns positive delta when dragging up (forward)', () => {
            // startY=100, currentY=100-PIXELS_PER_FRAME = drag up
            const delta = calculateScrubDelta(100, 100 - PIXELS_PER_FRAME, false);
            expect(delta).toBe(1);
        });

        it('returns negative delta when dragging down (backward)', () => {
            const delta = calculateScrubDelta(100, 100 + PIXELS_PER_FRAME, false);
            expect(delta).toBe(-1);
        });

        it('scales with pixel distance', () => {
            const delta = calculateScrubDelta(100, 100 - PIXELS_PER_FRAME * 5, false);
            expect(delta).toBe(5);
        });

        it('applies shift multiplier', () => {
            const noShift = calculateScrubDelta(100, 100 - PIXELS_PER_FRAME * 2, false);
            const withShift = calculateScrubDelta(100, 100 - PIXELS_PER_FRAME * 2, true);
            expect(withShift).toBe(noShift * SHIFT_MULTIPLIER);
        });

        it('rounds to nearest frame', () => {
            // Less than half a frame - rounds to 0
            const small = calculateScrubDelta(100, 100 - PIXELS_PER_FRAME / 3, false);
            expect(small).toBe(0);

            // More than half a frame - rounds to 1
            const larger = calculateScrubDelta(100, 100 - PIXELS_PER_FRAME * 0.6, false);
            expect(larger).toBe(1);
        });
    });

    describe('calculateScrubFrameIndex', () => {
        const totalFrames = 100;

        it('returns start frame when no movement', () => {
            const index = calculateScrubFrameIndex(50, 100, 100, totalFrames, false);
            expect(index).toBe(50);
        });

        it('increases frame index when dragging up', () => {
            const index = calculateScrubFrameIndex(50, 100, 100 - PIXELS_PER_FRAME * 10, totalFrames, false);
            expect(index).toBe(60);
        });

        it('decreases frame index when dragging down', () => {
            const index = calculateScrubFrameIndex(50, 100, 100 + PIXELS_PER_FRAME * 10, totalFrames, false);
            expect(index).toBe(40);
        });

        it('clamps to 0 minimum', () => {
            const index = calculateScrubFrameIndex(5, 100, 100 + PIXELS_PER_FRAME * 100, totalFrames, false);
            expect(index).toBe(0);
        });

        it('clamps to totalFrames-1 maximum', () => {
            const index = calculateScrubFrameIndex(90, 100, 100 - PIXELS_PER_FRAME * 100, totalFrames, false);
            expect(index).toBe(99);
        });

        it('applies shift multiplier for fast scrub', () => {
            const slow = calculateScrubFrameIndex(50, 100, 100 - PIXELS_PER_FRAME * 2, totalFrames, false);
            const fast = calculateScrubFrameIndex(50, 100, 100 - PIXELS_PER_FRAME * 2, totalFrames, true);
            expect(slow).toBe(52);
            expect(fast).toBe(50 + 2 * SHIFT_MULTIPLIER); // 50 + 10 = 60
        });

        it('handles single frame series', () => {
            const index = calculateScrubFrameIndex(0, 100, 100 - PIXELS_PER_FRAME * 10, 1, false);
            expect(index).toBe(0);
        });
    });
});
