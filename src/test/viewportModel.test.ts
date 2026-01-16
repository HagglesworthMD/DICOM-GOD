/**
 * Multi-Viewport Model tests
 */

import { describe, it, expect } from 'vitest';
import {
    createInitialLayoutState,
    getVisibleSlots,
    rankSeriesForHanging,
    computeSmartHanging,
} from '../core/viewportModel';
import type { Series } from '../core/types';

// Mock series factory
function createMockSeries(overrides: Partial<Series> = {}): Series {
    return {
        seriesInstanceUid: `1.2.3.${Math.random().toString(36).slice(2)}`,
        studyInstanceUid: '1.2.3.study',
        description: 'Test Series',
        seriesNumber: 1,
        modality: 'CT',
        instances: [],
        geometryTrust: 'untrusted',
        kind: 'single',
        cineEligible: false,
        cineReason: 'Not eligible',
        ...overrides,
    };
}

describe('viewportModel', () => {
    describe('createInitialLayoutState', () => {
        it('creates initial state with layout 1', () => {
            const state = createInitialLayoutState();
            expect(state.layout).toBe(1);
            expect(state.slots).toHaveLength(4);
            expect(state.activeSlotId).toBe(0);
            expect(state.hangingApplied).toBe(false);
        });

        it('has slot 0 as active by default', () => {
            const state = createInitialLayoutState();
            expect(state.slots[0].isActive).toBe(true);
            expect(state.slots[1].isActive).toBe(false);
        });
    });

    describe('getVisibleSlots', () => {
        it('returns [0] for layout 1', () => {
            expect(getVisibleSlots(1)).toEqual([0]);
        });

        it('returns [0,1] for layout 2', () => {
            expect(getVisibleSlots(2)).toEqual([0, 1]);
        });

        it('returns [0,1,2,3] for layout 4', () => {
            expect(getVisibleSlots(4)).toEqual([0, 1, 2, 3]);
        });
    });

    describe('rankSeriesForHanging', () => {
        it('ranks STACK higher than SINGLE', () => {
            const stack = createMockSeries({ kind: 'stack' });
            const single = createMockSeries({ kind: 'single' });

            expect(rankSeriesForHanging(stack)).toBeGreaterThan(rankSeriesForHanging(single));
        });

        it('ranks verified geometry higher than untrusted', () => {
            const verified = createMockSeries({ geometryTrust: 'verified' });
            const untrusted = createMockSeries({ geometryTrust: 'untrusted' });

            expect(rankSeriesForHanging(verified)).toBeGreaterThan(rankSeriesForHanging(untrusted));
        });

        it('ranks higher frame count higher', () => {
            const manyFrames = createMockSeries({ instances: Array(100).fill({}) as any });
            const fewFrames = createMockSeries({ instances: Array(5).fill({}) as any });

            expect(rankSeriesForHanging(manyFrames)).toBeGreaterThan(rankSeriesForHanging(fewFrames));
        });

        it('is deterministic for identical series', () => {
            const series = createMockSeries({ seriesInstanceUid: 'stable.uid' });
            const score1 = rankSeriesForHanging(series);
            const score2 = rankSeriesForHanging(series);

            expect(score1).toBe(score2);
        });
    });

    describe('computeSmartHanging', () => {
        it('returns empty assignments for empty series list', () => {
            const result = computeSmartHanging([], 2);
            expect(result.assignments).toHaveLength(0);
        });

        it('fills up to layout count', () => {
            const series = [
                createMockSeries({ seriesNumber: 1 }),
                createMockSeries({ seriesNumber: 2 }),
                createMockSeries({ seriesNumber: 3 }),
            ];

            const result = computeSmartHanging(series, 2);
            expect(result.assignments).toHaveLength(2);
        });

        it('assigns to visible slots only', () => {
            const series = [
                createMockSeries({ seriesNumber: 1 }),
            ];

            const result = computeSmartHanging(series, 1);
            expect(result.assignments).toHaveLength(1);
            expect(result.assignments[0].slotId).toBe(0);
        });

        it('prefers stack series', () => {
            const single = createMockSeries({ kind: 'single', seriesNumber: 1 });
            const stack = createMockSeries({ kind: 'stack', seriesNumber: 2 });

            // Send single first, but stack should be ranked higher
            const result = computeSmartHanging([single, stack], 1);

            expect(result.assignments[0].series.kind).toBe('stack');
        });

        it('is deterministic across calls', () => {
            const series = [
                createMockSeries({ seriesNumber: 1, seriesInstanceUid: 'a' }),
                createMockSeries({ seriesNumber: 2, seriesInstanceUid: 'b' }),
            ];

            const result1 = computeSmartHanging(series, 2);
            const result2 = computeSmartHanging(series, 2);

            expect(result1.assignments.map(a => a.series.seriesInstanceUid))
                .toEqual(result2.assignments.map(a => a.series.seriesInstanceUid));
        });
    });
});
