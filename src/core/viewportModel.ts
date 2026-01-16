/**
 * Multi-Viewport Model
 * Defines the data model for multi-viewport layouts
 */

import type { Series, GeometryTrust, SeriesKind } from './types';

// Layout types
export type ViewportLayout = 1 | 2 | 4;

// Viewport slot identifier
export type ViewportSlotId = 0 | 1 | 2 | 3;

// Per-viewport state model
export interface ViewportSlot {
    /** Unique slot identifier */
    id: ViewportSlotId;
    /** Currently assigned series (null = empty slot) */
    series: Series | null;
    /** Whether this viewport is the active/focused one */
    isActive: boolean;
}

// Layout state
export interface LayoutState {
    /** Current layout */
    layout: ViewportLayout;
    /** Viewport slots */
    slots: ViewportSlot[];
    /** Active slot index (receives series selection) */
    activeSlotId: ViewportSlotId;
    /** Hovered slot index (for Alt+click assignment) */
    hoveredSlotId: ViewportSlotId | null;
    /** Whether smart hanging was used */
    hangingApplied: boolean;
    /** Previous state for undo */
    undoState: ViewportSlot[] | null;
}

// Smart hanging heuristics result
export interface HangingResult {
    assignments: Array<{ slotId: ViewportSlotId; series: Series }>;
    reason: string;
}

/**
 * Create initial layout state
 */
export function createInitialLayoutState(): LayoutState {
    return {
        layout: 1,
        slots: [
            { id: 0, series: null, isActive: true },
            { id: 1, series: null, isActive: false },
            { id: 2, series: null, isActive: false },
            { id: 3, series: null, isActive: false },
        ],
        activeSlotId: 0,
        hoveredSlotId: null,
        hangingApplied: false,
        undoState: null,
    };
}

/**
 * Get visible slots for a layout
 */
export function getVisibleSlots(layout: ViewportLayout): ViewportSlotId[] {
    switch (layout) {
        case 1: return [0];
        case 2: return [0, 1];
        case 4: return [0, 1, 2, 3];
    }
}

/**
 * Rank series for smart hanging
 * Higher score = better candidate for auto-fill
 */
export function rankSeriesForHanging(series: Series): number {
    let score = 0;

    // Prefer STACK kind (10 points)
    const kindScores: Record<SeriesKind, number> = {
        stack: 10,
        multiframe: 8,
        single: 5,
        unsafe: 0,
    };
    score += kindScores[series.kind] || 0;

    // Prefer verified geometry (5 points)
    const trustScores: Record<GeometryTrust, number> = {
        verified: 5,
        trusted: 3,
        untrusted: 1,
        unknown: 0,
    };
    score += trustScores[series.geometryTrust] || 0;

    // Prefer higher frame count (up to 5 points, capped at 100 frames)
    const frameCount = series.instances.length;
    score += Math.min(5, Math.floor(frameCount / 20));

    // Stable tie-breaker: series number (lower is better)
    if (series.seriesNumber !== null) {
        score += (1000 - Math.min(series.seriesNumber, 999)) / 1000;
    }

    return score;
}

/**
 * Compute smart hanging assignments for a study
 */
export function computeSmartHanging(
    allSeries: Series[],
    layout: ViewportLayout
): HangingResult {
    const visibleSlots = getVisibleSlots(layout);
    const numSlots = visibleSlots.length;

    // Rank all series
    const ranked = [...allSeries]
        .map(s => ({ series: s, score: rankSeriesForHanging(s) }))
        .sort((a, b) => {
            const scoreDiff = b.score - a.score;
            if (scoreDiff !== 0) return scoreDiff;
            // Stable tie-breaker: UID
            return a.series.seriesInstanceUid.localeCompare(b.series.seriesInstanceUid);
        });

    // Take top N for visible slots
    const assignments: Array<{ slotId: ViewportSlotId; series: Series }> = [];
    for (let i = 0; i < Math.min(numSlots, ranked.length); i++) {
        assignments.push({
            slotId: visibleSlots[i],
            series: ranked[i].series,
        });
    }

    const reason = assignments.length > 0
        ? `Auto-filled ${assignments.length} viewport(s) by heuristics (preferred stacks with verified geometry)`
        : 'No series available for auto-fill';

    return { assignments, reason };
}
