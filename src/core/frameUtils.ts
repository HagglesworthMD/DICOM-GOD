
import type { DecodedFrame } from '../core/types';

/**
 * Select the appropriate frame for interactive tools.
 * Prioritizes the currently decoded frame.
 * Falls back to the last successfully rendered frame to prevent tools from 
 * becoming unresponsive during decode gaps (flicker-free behavior).
 */
export function selectFrameForInteraction(
    currentFrame: DecodedFrame | null,
    lastGoodFrame: DecodedFrame | null
): DecodedFrame | null {
    return currentFrame ?? lastGoodFrame;
}
