/**
 * Tests for deterministic sorting of studies/series/instances
 */

import { describe, it, expect } from 'vitest';
import type { Series, Instance } from '../core/types';

// Helper to create test data
function createInstance(overrides: Partial<Instance>): Instance {
    return {
        sopInstanceUid: '1.2.3',
        seriesInstanceUid: '1.2.3',
        instanceNumber: null,
        filePath: 'test.dcm',
        fileSize: 1000,
        ...overrides,
    };
}

function createSeries(overrides: Partial<Series>): Series {
    return {
        seriesInstanceUid: '1.2.3',
        studyInstanceUid: '1.2.3',
        description: 'Test Series',
        seriesNumber: null,
        modality: 'CT',
        instances: [],
        geometryTrust: 'unknown',
        ...overrides,
    };
}

// Reserved for future tests
// function createStudy(overrides: Partial<Study>): Study { ... }

// Sort functions matching the worker
function sortInstances(instances: Instance[]): Instance[] {
    return [...instances].sort((a, b) => {
        // InstanceNumber comparison (null sorts last)
        if (a.instanceNumber !== null && b.instanceNumber !== null) {
            const numCmp = a.instanceNumber - b.instanceNumber;
            if (numCmp !== 0) return numCmp;
        } else if (a.instanceNumber !== null) {
            return -1;
        } else if (b.instanceNumber !== null) {
            return 1;
        }
        // SOPInstanceUID as tiebreaker
        return a.sopInstanceUid.localeCompare(b.sopInstanceUid);
    });
}

function sortSeries(series: Series[]): Series[] {
    return [...series].sort((a, b) => {
        // SeriesNumber comparison (null sorts last)
        if (a.seriesNumber !== null && b.seriesNumber !== null) {
            const numCmp = a.seriesNumber - b.seriesNumber;
            if (numCmp !== 0) return numCmp;
        } else if (a.seriesNumber !== null) {
            return -1;
        } else if (b.seriesNumber !== null) {
            return 1;
        }
        // Description as tiebreaker
        const descCmp = a.description.localeCompare(b.description);
        if (descCmp !== 0) return descCmp;
        // UID as final tiebreaker
        return a.seriesInstanceUid.localeCompare(b.seriesInstanceUid);
    });
}

describe('Deterministic Sorting', () => {
    describe('sortInstances', () => {
        it('sorts by instanceNumber ascending', () => {
            const instances = [
                createInstance({ sopInstanceUid: 'a', instanceNumber: 3 }),
                createInstance({ sopInstanceUid: 'b', instanceNumber: 1 }),
                createInstance({ sopInstanceUid: 'c', instanceNumber: 2 }),
            ];

            const sorted = sortInstances(instances);

            expect(sorted.map(i => i.instanceNumber)).toEqual([1, 2, 3]);
        });

        it('puts null instanceNumber last', () => {
            const instances = [
                createInstance({ sopInstanceUid: 'a', instanceNumber: null }),
                createInstance({ sopInstanceUid: 'b', instanceNumber: 1 }),
                createInstance({ sopInstanceUid: 'c', instanceNumber: null }),
            ];

            const sorted = sortInstances(instances);

            expect(sorted[0].instanceNumber).toBe(1);
            expect(sorted[1].instanceNumber).toBe(null);
            expect(sorted[2].instanceNumber).toBe(null);
        });

        it('uses SOPInstanceUID as tiebreaker', () => {
            const instances = [
                createInstance({ sopInstanceUid: 'z.1', instanceNumber: 1 }),
                createInstance({ sopInstanceUid: 'a.1', instanceNumber: 1 }),
                createInstance({ sopInstanceUid: 'm.1', instanceNumber: 1 }),
            ];

            const sorted = sortInstances(instances);

            expect(sorted.map(i => i.sopInstanceUid)).toEqual(['a.1', 'm.1', 'z.1']);
        });

        it('is deterministic with same input', () => {
            const instances = [
                createInstance({ sopInstanceUid: 'c', instanceNumber: 2 }),
                createInstance({ sopInstanceUid: 'a', instanceNumber: 1 }),
                createInstance({ sopInstanceUid: 'b', instanceNumber: 2 }),
            ];

            const sorted1 = sortInstances(instances);
            const sorted2 = sortInstances(instances);

            expect(sorted1.map(i => i.sopInstanceUid)).toEqual(sorted2.map(i => i.sopInstanceUid));
        });
    });

    describe('sortSeries', () => {
        it('sorts by seriesNumber ascending', () => {
            const series = [
                createSeries({ seriesInstanceUid: 'a', seriesNumber: 3 }),
                createSeries({ seriesInstanceUid: 'b', seriesNumber: 1 }),
                createSeries({ seriesInstanceUid: 'c', seriesNumber: 2 }),
            ];

            const sorted = sortSeries(series);

            expect(sorted.map(s => s.seriesNumber)).toEqual([1, 2, 3]);
        });

        it('puts null seriesNumber last', () => {
            const series = [
                createSeries({ seriesInstanceUid: 'a', seriesNumber: null }),
                createSeries({ seriesInstanceUid: 'b', seriesNumber: 1 }),
            ];

            const sorted = sortSeries(series);

            expect(sorted[0].seriesNumber).toBe(1);
            expect(sorted[1].seriesNumber).toBe(null);
        });

        it('uses description as tiebreaker', () => {
            const series = [
                createSeries({ seriesInstanceUid: 'a', seriesNumber: 1, description: 'Zebra' }),
                createSeries({ seriesInstanceUid: 'b', seriesNumber: 1, description: 'Apple' }),
            ];

            const sorted = sortSeries(series);

            expect(sorted.map(s => s.description)).toEqual(['Apple', 'Zebra']);
        });

        it('uses UID as final tiebreaker', () => {
            const series = [
                createSeries({ seriesInstanceUid: 'z', seriesNumber: 1, description: 'Same' }),
                createSeries({ seriesInstanceUid: 'a', seriesNumber: 1, description: 'Same' }),
            ];

            const sorted = sortSeries(series);

            expect(sorted.map(s => s.seriesInstanceUid)).toEqual(['a', 'z']);
        });
    });
});
