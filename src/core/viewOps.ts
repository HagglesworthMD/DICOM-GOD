import type { SeriesKind } from './types';

/**
 * Determine if a series kind allows stack scrolling
 * Only STACK and MULTIFRAME are scrollable; SINGLE and UNSAFE are not
 */
export function isSeriesScrollable(kind: SeriesKind): boolean {
    return kind === 'stack' || kind === 'multiframe';
}

/**
 * Get the reason why a series is not scrollable (for tooltip display)
 */
export function getScrollDisabledReason(kind: SeriesKind, cineReason?: string): string | null {
    if (kind === 'single') return 'Single-frame series';
    if (kind === 'unsafe') return cineReason || 'Unsafe series geometry';
    return null;
}

// Standard DICOM presets
export const PRESETS = {
    1: { label: 'Soft Tissue', wc: 40, ww: 400 },
    2: { label: 'Lung', wc: -600, ww: 1500 },
    3: { label: 'Bone', wc: 400, ww: 1800 },
    4: { label: 'Brain', wc: 40, ww: 80 }
};

/**
 * Calculate next frame index with direction awareness
 */
export function calculateNextFrame(
    current: number,
    total: number,
    step: number,
    stackReverse: boolean
): number {
    if (total <= 0) return 0;
    const dir = stackReverse ? -1 : 1;
    const delta = step * dir;
    const next = current + delta;
    return Math.max(0, Math.min(next, total - 1));
}

/**
 * Get preset by key key (1-4)
 */
export function getPreset(key: string): { wc: number; ww: number; label: string } | null {
    const k = key as unknown as keyof typeof PRESETS;
    return PRESETS[k] || null;
}
