/**
 * Viewer State Export/Import tests
 */

import { describe, it, expect } from 'vitest';
import {
    exportViewerState,
    parseViewerState,
    importViewerState,
    resolveSeriesFromState,
    STATE_VERSION,
    type ViewerStateV1,
    type ViewportStateV1,
} from '../core/viewerState';
import type { Series } from '../core/types';
import type { LayoutState, ViewportSlotId } from '../core/viewportModel';

// Mock series factory
function createMockSeries(uid: string, description = 'Test Series'): Series {
    return {
        seriesInstanceUid: uid,
        studyInstanceUid: '1.2.3.study',
        description,
        seriesNumber: 1,
        modality: 'CT',
        instances: [],
        geometryTrust: 'untrusted',
        kind: 'single',
        cineEligible: false,
        cineReason: 'Not eligible',
    };
}

// Mock layout state factory
function createMockLayoutState(overrides: Partial<LayoutState> = {}): LayoutState {
    return {
        layout: 2,
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
        ...overrides,
    };
}

describe('viewerState', () => {
    describe('exportViewerState', () => {
        it('exports layout and slots', () => {
            const layoutState = createMockLayoutState({ layout: 4 });
            const perViewportState = new Map<ViewportSlotId, ViewportStateV1>();

            const exported = exportViewerState(layoutState, perViewportState, true);

            expect(exported.version).toBe(STATE_VERSION);
            expect(exported.appId).toBe('dicom-god');
            expect(exported.layout).toBe(4);
            expect(exported.activeSlotId).toBe(0);
            expect(exported.slots).toHaveLength(4);
            expect(exported.localModeEnabled).toBe(true);
        });

        it('includes series UIDs when assigned', () => {
            const series = createMockSeries('1.2.3.series');
            const layoutState = createMockLayoutState({
                slots: [
                    { id: 0, series, isActive: true },
                    { id: 1, series: null, isActive: false },
                    { id: 2, series: null, isActive: false },
                    { id: 3, series: null, isActive: false },
                ],
            });
            const perViewportState = new Map<ViewportSlotId, ViewportStateV1>();

            const exported = exportViewerState(layoutState, perViewportState, false);

            expect(exported.slots[0].seriesInstanceUid).toBe('1.2.3.series');
            expect(exported.slots[1].seriesInstanceUid).toBeNull();
        });
    });

    describe('parseViewerState', () => {
        it('parses valid state', () => {
            const validState: ViewerStateV1 = {
                version: 1,
                exportedAt: new Date().toISOString(),
                appId: 'dicom-god',
                layout: 2,
                activeSlotId: 1,
                slots: [
                    { slotId: 0, seriesInstanceUid: 'uid-a', viewportState: null },
                    { slotId: 1, seriesInstanceUid: null, viewportState: null },
                ],
                localModeEnabled: true,
            };

            const parsed = parseViewerState(validState);

            expect(parsed).not.toBeNull();
            expect(parsed!.layout).toBe(2);
            expect(parsed!.activeSlotId).toBe(1);
            expect(parsed!.slots[0].seriesInstanceUid).toBe('uid-a');
        });

        it('rejects wrong version', () => {
            const invalidState = {
                version: 999,
                appId: 'dicom-god',
                layout: 1,
                activeSlotId: 0,
                slots: [],
            };

            const parsed = parseViewerState(invalidState);
            expect(parsed).toBeNull();
        });

        it('rejects wrong appId', () => {
            const invalidState = {
                version: 1,
                appId: 'other-app',
                layout: 1,
                activeSlotId: 0,
                slots: [],
            };

            const parsed = parseViewerState(invalidState);
            expect(parsed).toBeNull();
        });

        it('ignores unknown fields safely', () => {
            const stateWithExtra = {
                version: 1,
                exportedAt: new Date().toISOString(),
                appId: 'dicom-god',
                layout: 1,
                activeSlotId: 0,
                slots: [],
                localModeEnabled: true,
                unknownField: 'should be ignored',
                anotherExtra: { nested: true },
            };

            const parsed = parseViewerState(stateWithExtra);
            expect(parsed).not.toBeNull();
            expect(parsed!.layout).toBe(1);
            // Unknown fields should not appear in result
            expect((parsed as any).unknownField).toBeUndefined();
        });
    });

    describe('importViewerState', () => {
        it('returns success when all series found', () => {
            const seriesA = createMockSeries('uid-a');
            const seriesB = createMockSeries('uid-b');

            const state: ViewerStateV1 = {
                version: 1,
                exportedAt: new Date().toISOString(),
                appId: 'dicom-god',
                layout: 2,
                activeSlotId: 0,
                slots: [
                    { slotId: 0, seriesInstanceUid: 'uid-a', viewportState: null },
                    { slotId: 1, seriesInstanceUid: 'uid-b', viewportState: null },
                ],
                localModeEnabled: true,
            };

            const report = importViewerState(state, [seriesA, seriesB]);

            expect(report.success).toBe(true);
            expect(report.restoredSlots).toBe(2);
            expect(report.warnings).toHaveLength(0);
        });

        it('returns warnings for missing series', () => {
            const seriesA = createMockSeries('uid-a');

            const state: ViewerStateV1 = {
                version: 1,
                exportedAt: new Date().toISOString(),
                appId: 'dicom-god',
                layout: 2,
                activeSlotId: 0,
                slots: [
                    { slotId: 0, seriesInstanceUid: 'uid-a', viewportState: null },
                    { slotId: 1, seriesInstanceUid: 'uid-missing', viewportState: null },
                ],
                localModeEnabled: true,
            };

            const report = importViewerState(state, [seriesA]);

            expect(report.success).toBe(false);
            expect(report.restoredSlots).toBe(1);
            expect(report.warnings).toHaveLength(1);
            expect(report.warnings[0]).toContain('Slot 2');
            expect(report.warnings[0]).toContain('not found');
        });
    });

    describe('resolveSeriesFromState', () => {
        it('returns map of found series', () => {
            const seriesA = createMockSeries('uid-a');
            const seriesB = createMockSeries('uid-b');

            const state: ViewerStateV1 = {
                version: 1,
                exportedAt: new Date().toISOString(),
                appId: 'dicom-god',
                layout: 2,
                activeSlotId: 0,
                slots: [
                    { slotId: 0, seriesInstanceUid: 'uid-a', viewportState: null },
                    { slotId: 1, seriesInstanceUid: 'uid-b', viewportState: null },
                ],
                localModeEnabled: true,
            };

            const resolved = resolveSeriesFromState(state, [seriesA, seriesB]);

            expect(resolved.size).toBe(2);
            expect(resolved.get(0)?.series.seriesInstanceUid).toBe('uid-a');
            expect(resolved.get(1)?.series.seriesInstanceUid).toBe('uid-b');
        });

        it('skips missing series', () => {
            const seriesA = createMockSeries('uid-a');

            const state: ViewerStateV1 = {
                version: 1,
                exportedAt: new Date().toISOString(),
                appId: 'dicom-god',
                layout: 2,
                activeSlotId: 0,
                slots: [
                    { slotId: 0, seriesInstanceUid: 'uid-a', viewportState: null },
                    { slotId: 1, seriesInstanceUid: 'uid-missing', viewportState: null },
                ],
                localModeEnabled: true,
            };

            const resolved = resolveSeriesFromState(state, [seriesA]);

            expect(resolved.size).toBe(1);
            expect(resolved.has(0)).toBe(true);
            expect(resolved.has(1)).toBe(false);
        });
    });

    describe('roundtrip', () => {
        it('export->parse preserves all fields except exportedAt', () => {
            const series = createMockSeries('uid-test');
            const layoutState = createMockLayoutState({
                layout: 4,
                activeSlotId: 2,
                slots: [
                    { id: 0, series, isActive: false },
                    { id: 1, series: null, isActive: false },
                    { id: 2, series: null, isActive: true },
                    { id: 3, series: null, isActive: false },
                ],
            });

            const viewportState: ViewportStateV1 = {
                frameIndex: 5,
                windowCenter: 100,
                windowWidth: 200,
                panX: 10,
                panY: -20,
                zoom: 1.5,
                invert: true,
                rotation: 90,
                measurements: [
                    { startX: 0, startY: 0, endX: 100, endY: 100, lengthMm: 141.42 },
                ],
            };

            const perViewportState = new Map<ViewportSlotId, ViewportStateV1>();
            perViewportState.set(0, viewportState);

            const exported = exportViewerState(layoutState, perViewportState, false);
            const parsed = parseViewerState(exported);

            expect(parsed).not.toBeNull();
            expect(parsed!.layout).toBe(4);
            expect(parsed!.activeSlotId).toBe(2);
            expect(parsed!.localModeEnabled).toBe(false);
            expect(parsed!.slots[0].seriesInstanceUid).toBe('uid-test');
            expect(parsed!.slots[0].viewportState?.frameIndex).toBe(5);
            expect(parsed!.slots[0].viewportState?.zoom).toBe(1.5);
            expect(parsed!.slots[0].viewportState?.measurements).toHaveLength(1);
        });
    });
});
