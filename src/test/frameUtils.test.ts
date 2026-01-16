
import { describe, it, expect } from 'vitest';
import { selectFrameForInteraction } from '../core/frameUtils';
import type { DecodedFrame } from '../core/types';

describe('Frame Selection Logic', () => {
    // Mock frames
    const frameA = { width: 100, height: 100 } as DecodedFrame;
    const frameB = { width: 200, height: 200 } as DecodedFrame;

    it('returns current frame when available', () => {
        const result = selectFrameForInteraction(frameA, null);
        expect(result).toBe(frameA);

        const result2 = selectFrameForInteraction(frameA, frameB);
        expect(result2).toBe(frameA);
    });

    it('falls back to last good frame when current is null', () => {
        const result = selectFrameForInteraction(null, frameB);
        expect(result).toBe(frameB);
    });

    it('returns null when both are null', () => {
        const result = selectFrameForInteraction(null, null);
        expect(result).toBeNull();
    });
});
