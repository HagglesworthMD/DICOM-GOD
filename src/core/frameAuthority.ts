
import type { DecodedFrame } from './types';

/**
 * Result of the authoritative frame selection.
 * Tells the UI exactly what to show and why.
 */
export interface FrameAuthority {
    /** The actual pixel data to render */
    frame: DecodedFrame | null;
    /** The authoritative frame index (may match frame or be ahead if buffering) */
    index: number;
    /** Why this frame was chosen */
    reason: 'current' | 'bufferFallback' | 'waiting';
    /** Whether we are falling back to a previous frame (flicker prevention) */
    isFallback: boolean;
    /** Whether we have something valid to render */
    ready: boolean;
}

/**
 * Single source of truth for which frame to display.
 * 
 * @param currentIndex - The target frame index from view state
 * @param currentFrame - The frame currently decoded for that index (if any)
 * @param lastGoodFrame - The last successfully rendered frame (for fallback)
 * @param isPlaying - Whether cine is active (context for fallback decisions)
 */
export function resolveFrameAuthority(
    currentIndex: number,
    currentFrame: DecodedFrame | null,
    lastGoodFrame: DecodedFrame | null,
    _isPlaying: boolean
): FrameAuthority {
    // 1. If we have the exact frame for the current index, use it.
    if (currentFrame) {
        return {
            frame: currentFrame,
            index: currentIndex,
            reason: 'current',
            isFallback: false,
            ready: true
        };
    }

    // 2. If we don't have the current frame, but have a last good one:
    if (lastGoodFrame) {
        // If playing, we indefinitely show last good frame to prevent flicker (buffering look)
        // If NOT playing, users prefer to see "Loading..." if they jumped to a new frame
        // BUT strict anti-flicker logic says: always show old pixel data until new is ready.
        // We'll stick to flick-free > loading blank.
        return {
            frame: lastGoodFrame,
            index: currentIndex, // We still claim we are at currentIndex, but showing stale pixels
            reason: 'bufferFallback',
            isFallback: true,
            ready: true
        };
    }

    // 3. Nothing at all
    return {
        frame: null,
        index: currentIndex,
        reason: 'waiting',
        isFallback: false,
        ready: false
    };
}
