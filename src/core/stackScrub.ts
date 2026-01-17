/**
 * Stack Scrub Utilities
 * Helpers for drag-to-scroll frame navigation
 */

/** Pixels of vertical drag per frame change */
export const PIXELS_PER_FRAME = 8;

/** Speed multiplier when Shift is held */
export const SHIFT_MULTIPLIER = 5;

/**
 * Calculate frame delta from pixel movement
 * @param startY - Starting Y position (pixels)
 * @param currentY - Current Y position (pixels)
 * @param shiftHeld - Whether Shift key is held for speed boost
 * @returns Frame delta (positive = forward, negative = backward)
 */
export function calculateScrubDelta(
    startY: number,
    currentY: number,
    shiftHeld: boolean
): number {
    const pixelDelta = startY - currentY; // Up = positive (forward)
    const rawDelta = Math.round(pixelDelta / PIXELS_PER_FRAME);
    return shiftHeld ? rawDelta * SHIFT_MULTIPLIER : rawDelta;
}

/**
 * Calculate new frame index from scrub gesture
 * @param startFrame - Frame index when scrub started
 * @param startY - Starting Y position (pixels)
 * @param currentY - Current Y position (pixels)
 * @param totalFrames - Total number of frames in stack
 * @param shiftHeld - Whether Shift key is held
 * @returns New frame index (clamped to valid range)
 */
export function calculateScrubFrameIndex(
    startFrame: number,
    startY: number,
    currentY: number,
    totalFrames: number,
    shiftHeld: boolean
): number {
    const delta = calculateScrubDelta(startY, currentY, shiftHeld);
    const newIndex = startFrame + delta;
    return Math.max(0, Math.min(totalFrames - 1, newIndex));
}
