/**
 * Viewer State Export/Import
 * Deterministic JSON serialization for viewer state persistence
 */

import type { Series } from './types';
import type { LayoutState, ViewportLayout, ViewportSlotId } from './viewportModel';

/** Version identifier for state schema */
export const STATE_VERSION = 1;

/** Per-viewport state that can be exported */
export interface ViewportStateV1 {
    /** Frame index in the series stack */
    frameIndex: number;
    /** Window center (brightness) */
    windowCenter: number;
    /** Window width (contrast) */
    windowWidth: number;
    /** Pan offset X */
    panX: number;
    /** Pan offset Y */
    panY: number;
    /** Zoom level */
    zoom: number;
    /** Invert grayscale */
    invert: boolean;
    /** Rotation in degrees (0, 90, 180, 270) */
    rotation: number;
    /** Length measurements */
    measurements: Array<{
        startX: number;
        startY: number;
        endX: number;
        endY: number;
        lengthMm: number;
    }>;
}

/** Per-slot export data */
export interface SlotStateV1 {
    /** Slot ID (0-3) */
    slotId: ViewportSlotId;
    /** Series UID if assigned, null if empty */
    seriesInstanceUid: string | null;
    /** Viewport state if series is assigned */
    viewportState: ViewportStateV1 | null;
}

/** Root export structure */
export interface ViewerStateV1 {
    /** Schema version */
    version: 1;
    /** ISO timestamp of export */
    exportedAt: string;
    /** Application identifier */
    appId: 'dicom-god';
    /** Layout configuration */
    layout: ViewportLayout;
    /** Active slot ID */
    activeSlotId: ViewportSlotId;
    /** Slot states */
    slots: SlotStateV1[];
    /** Local mode enabled */
    localModeEnabled: boolean;
}

/** Import result report */
export interface ImportReport {
    /** Whether import was successful overall */
    success: boolean;
    /** Number of slots successfully restored */
    restoredSlots: number;
    /** Warnings about missing series */
    warnings: string[];
    /** Layout that was restored */
    layout: ViewportLayout;
}

/** Default viewport state */
const DEFAULT_VIEWPORT_STATE: ViewportStateV1 = {
    frameIndex: 0,
    windowCenter: 40,
    windowWidth: 400,
    panX: 0,
    panY: 0,
    zoom: 1,
    invert: false,
    rotation: 0,
    measurements: [],
};

/**
 * Export current viewer state to JSON structure
 */
export function exportViewerState(
    layoutState: LayoutState,
    perViewportState: Map<ViewportSlotId, ViewportStateV1>,
    localModeEnabled: boolean
): ViewerStateV1 {
    const slots: SlotStateV1[] = layoutState.slots.map(slot => {
        const seriesUid = slot.series?.seriesInstanceUid ?? null;
        const viewportState = seriesUid ? (perViewportState.get(slot.id) ?? DEFAULT_VIEWPORT_STATE) : null;

        return {
            slotId: slot.id,
            seriesInstanceUid: seriesUid,
            viewportState: viewportState ? { ...viewportState } : null,
        };
    });

    return {
        version: STATE_VERSION,
        exportedAt: new Date().toISOString(),
        appId: 'dicom-god',
        layout: layoutState.layout,
        activeSlotId: layoutState.activeSlotId,
        slots,
        localModeEnabled,
    };
}

/**
 * Validate and parse imported state
 */
export function parseViewerState(json: unknown): ViewerStateV1 | null {
    if (typeof json !== 'object' || json === null) return null;

    const obj = json as Record<string, unknown>;

    // Check version
    if (obj.version !== STATE_VERSION) return null;
    if (obj.appId !== 'dicom-god') return null;

    // Validate layout
    const layout = obj.layout;
    if (layout !== 1 && layout !== 2 && layout !== 4) return null;

    // Validate activeSlotId
    const activeSlotId = obj.activeSlotId;
    if (typeof activeSlotId !== 'number' || activeSlotId < 0 || activeSlotId > 3) return null;

    // Validate slots array
    if (!Array.isArray(obj.slots)) return null;

    const slots: SlotStateV1[] = [];
    for (const slotData of obj.slots) {
        if (typeof slotData !== 'object' || slotData === null) continue;

        const s = slotData as Record<string, unknown>;
        const slotId = s.slotId;
        if (typeof slotId !== 'number' || slotId < 0 || slotId > 3) continue;

        const seriesInstanceUid = typeof s.seriesInstanceUid === 'string' ? s.seriesInstanceUid : null;

        let viewportState: ViewportStateV1 | null = null;
        if (s.viewportState && typeof s.viewportState === 'object') {
            const vs = s.viewportState as Record<string, unknown>;
            viewportState = {
                frameIndex: typeof vs.frameIndex === 'number' ? vs.frameIndex : 0,
                windowCenter: typeof vs.windowCenter === 'number' ? vs.windowCenter : 40,
                windowWidth: typeof vs.windowWidth === 'number' ? vs.windowWidth : 400,
                panX: typeof vs.panX === 'number' ? vs.panX : 0,
                panY: typeof vs.panY === 'number' ? vs.panY : 0,
                zoom: typeof vs.zoom === 'number' ? vs.zoom : 1,
                invert: typeof vs.invert === 'boolean' ? vs.invert : false,
                rotation: typeof vs.rotation === 'number' ? vs.rotation : 0,
                measurements: Array.isArray(vs.measurements) ? parseMeasurements(vs.measurements) : [],
            };
        }

        slots.push({
            slotId: slotId as ViewportSlotId,
            seriesInstanceUid,
            viewportState,
        });
    }

    return {
        version: STATE_VERSION,
        exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date().toISOString(),
        appId: 'dicom-god',
        layout: layout as ViewportLayout,
        activeSlotId: activeSlotId as ViewportSlotId,
        slots,
        localModeEnabled: typeof obj.localModeEnabled === 'boolean' ? obj.localModeEnabled : true,
    };
}

/** Parse measurements array safely */
function parseMeasurements(arr: unknown[]): ViewportStateV1['measurements'] {
    const result: ViewportStateV1['measurements'] = [];

    for (const m of arr) {
        if (typeof m !== 'object' || m === null) continue;
        const meas = m as Record<string, unknown>;

        if (
            typeof meas.startX === 'number' &&
            typeof meas.startY === 'number' &&
            typeof meas.endX === 'number' &&
            typeof meas.endY === 'number' &&
            typeof meas.lengthMm === 'number'
        ) {
            result.push({
                startX: meas.startX,
                startY: meas.startY,
                endX: meas.endX,
                endY: meas.endY,
                lengthMm: meas.lengthMm,
            });
        }
    }

    return result;
}

/**
 * Import viewer state and return report
 * Does NOT mutate store - returns actions to dispatch
 */
export function importViewerState(
    state: ViewerStateV1,
    availableSeries: Series[]
): ImportReport {
    const warnings: string[] = [];
    let restoredSlots = 0;

    // Build lookup map for available series
    const seriesMap = new Map<string, Series>();
    for (const series of availableSeries) {
        seriesMap.set(series.seriesInstanceUid, series);
    }

    // Check each slot for missing series
    for (const slotState of state.slots) {
        if (slotState.seriesInstanceUid) {
            const series = seriesMap.get(slotState.seriesInstanceUid);
            if (series) {
                restoredSlots++;
            } else {
                warnings.push(
                    `Slot ${slotState.slotId + 1}: Series ${slotState.seriesInstanceUid.slice(-12)} not found in current dataset`
                );
            }
        }
    }

    return {
        success: warnings.length === 0,
        restoredSlots,
        warnings,
        layout: state.layout,
    };
}

/**
 * Find series from state that exist in available series
 */
export function resolveSeriesFromState(
    state: ViewerStateV1,
    availableSeries: Series[]
): Map<ViewportSlotId, { series: Series; viewportState: ViewportStateV1 | null }> {
    const seriesMap = new Map<string, Series>();
    for (const series of availableSeries) {
        seriesMap.set(series.seriesInstanceUid, series);
    }

    const result = new Map<ViewportSlotId, { series: Series; viewportState: ViewportStateV1 | null }>();

    for (const slotState of state.slots) {
        if (slotState.seriesInstanceUid) {
            const series = seriesMap.get(slotState.seriesInstanceUid);
            if (series) {
                result.set(slotState.slotId, {
                    series,
                    viewportState: slotState.viewportState,
                });
            }
        }
    }

    return result;
}

/**
 * Download state as JSON file
 */
export function downloadStateAsJson(state: ViewerStateV1): void {
    const json = JSON.stringify(state, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'dicom-god-state.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
}

/**
 * Read JSON file and parse as ViewerState
 */
export async function readStateFromFile(file: File): Promise<ViewerStateV1 | null> {
    try {
        const text = await file.text();
        const json = JSON.parse(text);
        return parseViewerState(json);
    } catch {
        return null;
    }
}
