
import { describe, it, expect } from 'vitest';
import { resolveFrameAuthority } from '../core/frameAuthority';
import type { DecodedFrame } from '../core/types';

// Mock frame helper
function createMockFrame(id: string): DecodedFrame {
    return {
        width: 512,
        height: 512,
        windowCenter: 40,
        windowWidth: 400,
        pixelData: new Float32Array(10),
        minPixelValue: 0,
        maxPixelValue: 100,
        intercept: 0,
        slope: 1,
        // Mock ID for test checking
        _testId: id
    } as any;
}

describe('resolveFrameAuthority', () => {
    it('returns current frame if available', () => {
        const current = createMockFrame('current');
        const last = createMockFrame('last');

        const auth = resolveFrameAuthority(5, current, last, true);

        expect(auth.frame).toBe(current);
        expect(auth.index).toBe(5);
        expect(auth.reason).toBe('current');
        expect(auth.isFallback).toBe(false);
        expect(auth.ready).toBe(true);
    });

    it('falls back to lastGoodFrame if current missing (buffering)', () => {
        const last = createMockFrame('last');

        const auth = resolveFrameAuthority(10, null, last, true);

        expect(auth.frame).toBe(last);
        expect(auth.index).toBe(10); // Index matches requested
        expect(auth.reason).toBe('bufferFallback');
        expect(auth.isFallback).toBe(true);
        expect(auth.ready).toBe(true);
    });

    it('returns not ready if nothing available', () => {
        const auth = resolveFrameAuthority(0, null, null, false);

        expect(auth.frame).toBeNull();
        expect(auth.ready).toBe(false);
        expect(auth.reason).toBe('waiting');
    });

    it('logic is independent of play state for fallback (anti-flicker)', () => {
        const last = createMockFrame('last');

        // Even if not playing, we prefer showing stale pixels over blank/loading
        const auth = resolveFrameAuthority(2, null, last, false);

        expect(auth.frame).toBe(last);
        expect(auth.reason).toBe('bufferFallback');
        expect(auth.isFallback).toBe(true);
    });
});
