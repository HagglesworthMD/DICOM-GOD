/**
 * DICOM Viewport - Real image viewer with interactions
 */

import { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { getFlag } from '../core/featureFlags';
import { useAppState, useAppDispatch } from '../state/store';
import {
    decodeFrame,
    registerInstanceFiles,
    clearInstanceFilesForSeries,
    DecodeError
} from '../core/decodeBridge';
import { renderFrame, renderLoading, renderError, drawOverlay } from '../core/canvas2dRenderer';
// geometryTrust helpers available if needed
import { verifySeriesGeometry as _verifySeriesGeometry } from '../core/geometryTrust';
void _verifySeriesGeometry; // Suppress unused warning - may be used later
import { isTransferSyntaxSupported } from '../core/types';
import type { Series, Instance, DecodedFrame, ViewportState, FileRegistry, ContactSheet } from '../core/types';
import './Viewport.css';
import type { ShortcutAction } from '../core/shortcuts';
import { calculateNextFrame } from '../core/viewOps';
import { PRESET_LIST, formatWl, getPresetById } from '../core/wlPresets';
import { calculateScrubFrameIndex } from '../core/stackScrub';
import { resolveFrameAuthority } from '../core/frameAuthority';
import { classifySeriesSemantics } from '../core/seriesSemantics';
import { computePercentileWindow, toModalityValue } from '../core/voiLut';
import { getSeriesWindowDefault, setSeriesWindowDefault } from '../core/seriesWindowCache';
import { computeMosaicTileRect, resolveMosaicGrid } from '../core/mosaic';

/** Imperative handle exposed by DicomViewer for external action routing */
export interface DicomViewerHandle {
    /** Apply a shortcut action to this viewer */
    applyAction(action: ShortcutAction): void;
}



const DEFAULT_STATE: ViewportState = {
    frameIndex: 0,
    windowCenter: 40,
    windowWidth: 400,
    zoom: 1,
    panX: 0,
    panY: 0,
    invert: false,
    isPlaying: false,
    cineFrameRate: 15,
    activeTool: 'hand',
    measurements: [],
};

const WINDOW_SAMPLE_FRAMES = 5;
const WINDOW_SAMPLE_PIXELS = 20000;
const WINDOW_PERCENTILE_LOW = 1;
const WINDOW_PERCENTILE_HIGH = 99;

function buildSampleIndices(total: number, target: number): number[] {
    if (total <= 0) return [];
    if (total <= target) {
        return Array.from({ length: total }, (_, i) => i);
    }

    const indices = new Set<number>();
    const step = (total - 1) / (target - 1);
    for (let i = 0; i < target; i++) {
        indices.add(Math.round(i * step));
    }

    return Array.from(indices).sort((a, b) => a - b);
}

function collectModalitySamples(frame: DecodedFrame, maxSamples: number): number[] {
    if (frame.samplesPerPixel !== 1) return [];
    const total = frame.pixelData.length;
    if (total === 0) return [];

    const stride = Math.max(1, Math.floor(total / maxSamples));
    const samples: number[] = [];
    const pixelRepresentation = frame.isSigned ? 1 : 0;

    for (let i = 0; i < total; i += stride) {
        const stored = frame.pixelData[i] ?? 0;
        samples.push(toModalityValue(stored, {
            slope: frame.rescaleSlope,
            intercept: frame.rescaleIntercept,
            bitsStored: frame.bitsStored,
            pixelRepresentation,
        }));
    }

    return samples;
}

function computeFallbackWindow(frame: DecodedFrame): { center: number; width: number } {
    const samples = collectModalitySamples(frame, WINDOW_SAMPLE_PIXELS);
    if (samples.length > 0) {
        const result = computePercentileWindow(
            samples,
            WINDOW_PERCENTILE_LOW,
            WINDOW_PERCENTILE_HIGH
        );
        return { center: result.center, width: result.width };
    }

    const pixelRepresentation = frame.isSigned ? 1 : 0;
    const min = toModalityValue(frame.minValue, {
        slope: frame.rescaleSlope,
        intercept: frame.rescaleIntercept,
        bitsStored: frame.bitsStored,
        pixelRepresentation,
    });
    const max = toModalityValue(frame.maxValue, {
        slope: frame.rescaleSlope,
        intercept: frame.rescaleIntercept,
        bitsStored: frame.bitsStored,
        pixelRepresentation,
    });
    const width = Math.max(1, max - min);
    return { center: min + width / 2, width };
}

// ============================================================================
// LRU Frame Cache
// ============================================================================
const CACHE_MAX_SIZE = 32;
const PREFETCH_CINE_AHEAD = 8;    // Frames to prefetch ahead during cine
const PREFETCH_CINE_BEHIND = 2;   // Frames to prefetch behind during cine
const PREFETCH_MANUAL_AHEAD = 4;  // Frames to prefetch ahead during manual nav
const PREFETCH_MANUAL_BEHIND = 2; // Frames to prefetch behind during manual nav
const PREFETCH_MAX_INFLIGHT = 1;
const DEBUG_PREFETCH = false;

/** Simple LRU cache for decoded frames */
class FrameLRUCache {
    private cache = new Map<string, DecodedFrame>();
    private maxSize: number;

    constructor(maxSize: number) {
        this.maxSize = maxSize;
    }

    /** Get frame, refreshing LRU order */
    get(key: string): DecodedFrame | undefined {
        const frame = this.cache.get(key);
        if (frame) {
            // Refresh: delete and re-add to make it newest
            this.cache.delete(key);
            this.cache.set(key, frame);
        }
        return frame;
    }

    /** Set frame, evicting oldest if at capacity */
    set(key: string, frame: DecodedFrame): void {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            // Evict oldest (first key)
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) {
                this.cache.delete(oldest);
            }
        }
        this.cache.set(key, frame);
    }

    has(key: string): boolean {
        return this.cache.has(key);
    }

    clear(): void {
        this.cache.clear();
    }

    get size(): number {
        return this.cache.size;
    }
}

interface DicomViewerProps {
    series: Series;
    fileRegistry: FileRegistry;
}

export const DicomViewer = forwardRef<DicomViewerHandle, DicomViewerProps>(
    function DicomViewer({ series, fileRegistry }, ref) {
        const { preferences } = useAppState();
        const dispatch = useAppDispatch();
        const canvasRef = useRef<HTMLCanvasElement>(null);
        const containerRef = useRef<HTMLDivElement>(null);

        // Per-series preferences
        const seriesKey = series.seriesInstanceUid || `series-${series.seriesNumber}`;
        const seriesPref = preferences.seriesPrefs?.[seriesKey] || {};
        const stackReverse = seriesPref.stackReverse ?? false;

        const [viewState, setViewState] = useState<ViewportState>(DEFAULT_STATE);
        const [currentFrame, setCurrentFrame] = useState<DecodedFrame | null>(null);
        const [contactSheet, setContactSheet] = useState<ContactSheet | null>(null);
        const [tileSteppingEnabled, setTileSteppingEnabled] = useState(false);
        const [tileIndex, setTileIndex] = useState(0);
        const [isBuffering, setIsBuffering] = useState(false);
        const [loading, setLoading] = useState(true);
        const [error, setError] = useState<string | null>(null);
        const [isUnsupported, setIsUnsupported] = useState(false);
        const [windowingSource, setWindowingSource] = useState<'dicom' | 'assumed'>('dicom');
        const [missingPermission, setMissingPermission] = useState(false);
        const [waitingForFiles, setWaitingForFiles] = useState(false);
        const cineIntervalRef = useRef<number | null>(null);
        const dragRef = useRef<{ startX: number; startY: number; mode: 'pan' | 'wl' | 'zoom' | 'measure' | 'scrub' | null }>({ startX: 0, startY: 0, mode: null });
        const scrubRef = useRef<{ startFrame: number; startY: number; wasPlaying: boolean }>({ startFrame: 0, startY: 0, wasPlaying: false });
        const wheelAccumulator = useRef(0);
        const activeRequestId = useRef(0);
        const windowingLockedRef = useRef(false);
        const assumedWindowTokenRef = useRef<number | null>(null);

        // Series Lifecycle Token (Hard Reset)
        // Incremented on every series switch to fence off old async tasks
        const activeSeriesTokenRef = useRef(0);

        // Measurement in-progress state (image pixel coords)
        const measureRef = useRef<{ startX: number; startY: number; endX: number; endY: number } | null>(null);

        // LRU cache for decoded frames (per-component instance = per-series due to key remount)
        const frameCacheRef = useRef(new FrameLRUCache(CACHE_MAX_SIZE));

        // Prefetch state
        const prefetchQueueRef = useRef<Instance[]>([]);
        const prefetchQueuedSetRef = useRef(new Set<string>()); // Dedupe
        const prefetchInflightRef = useRef(0);
        const prefetchGenerationRef = useRef(0); // Invalidation token

        // Navigation direction tracking (+1 forward, -1 backward)
        const lastNavDirRef = useRef<1 | -1>(1);

        // Time-based cine state
        const cineStartTimeRef = useRef(0);
        const cineStartIndexRef = useRef(0);
        const tileCineStartIndexRef = useRef(0);

        // Track if we've successfully rendered at least one frame (for safe cine overlay suppression)
        const hasRenderedFrameRef = useRef(false);

        // Flicker-free cine: hold last successfully decoded frame to display while buffering
        const lastGoodFrameRef = useRef<DecodedFrame | null>(null);

        // --- Series Switch Hard Reset ---
        useEffect(() => {
            // 1. Increment token to invalidate old async/cine
            activeSeriesTokenRef.current++;
            const token = activeSeriesTokenRef.current;

            // 2. Clear buffers and caches
            lastGoodFrameRef.current = null;
            hasRenderedFrameRef.current = false;
            prefetchQueueRef.current = [];
            prefetchQueuedSetRef.current.clear();

            // 3. Reset State (Stop cine, Frame 0)
            setViewState({
                ...DEFAULT_STATE,
                // Preserve tool if desired, or reset to hand? Let's reset to clean slate per request
                activeTool: 'hand',
                frameIndex: 0
            });
            setCurrentFrame(null);
            setContactSheet(null);
            setTileSteppingEnabled(false);
            setTileIndex(0);
            setLoading(true);
            setError(null);
            setWindowingSource('dicom');
            windowingLockedRef.current = false;
            assumedWindowTokenRef.current = null;

            // 4. Force stop any lingering cine interval (double safety)
            if (cineIntervalRef.current) {
                clearInterval(cineIntervalRef.current);
                cineIntervalRef.current = null;
            }

            if (DEBUG_PREFETCH) console.log(`[SeriesSwitch] Token ${token} activated for ${series.seriesInstanceUid}`);

        }, [series.seriesInstanceUid]);




        const instances = series.instances;
        const semantics = classifySeriesSemantics(instances);
        const hasMultiframe = series.hasMultiframe ?? semantics.hasMultiframe;
        const stackLike = series.stackLike ?? semantics.stackLike;
        const seriesCanCine = series.cineEligible;
        const seriesCineReason = series.cineReason;

        // ============================================================================
        // Frame Resolution for STACK vs MULTIFRAME
        // ============================================================================
        // STACK: frameIndex indexes into instances array, intraFrameIndex = 0
        // MULTIFRAME: frameIndex indexes into frames within first instance
        // ============================================================================
        const isMultiframe = hasMultiframe && instances.length > 0 &&
            (instances[0].numberOfFrames ?? 1) > 1;

        const baseTotalFrames = isMultiframe
            ? (instances[0].numberOfFrames ?? 1)
            : instances.length;

        const contactSheetTileCount = contactSheet?.tiles.length ?? 0;
        const mosaicGrid = resolveMosaicGrid(
            contactSheetTileCount,
            contactSheet?.grid.rows,
            contactSheet?.grid.cols
        );
        const tileCount = mosaicGrid?.tileCount ?? 0;
        const mosaicActive = !!mosaicGrid && baseTotalFrames === 1;
        const tileSteppingOn = mosaicActive && tileSteppingEnabled;
        const totalFrames = baseTotalFrames;
        const effectiveStackLike = mosaicActive ? tileSteppingOn : stackLike;

        const currentInstance = mosaicActive
            ? instances[0]
            : isMultiframe
                ? instances[0]  // Multiframe: always the first (and usually only) instance
                : instances[viewState.frameIndex];

        const intraFrameIndex = isMultiframe
            ? viewState.frameIndex  // Multiframe: frameIndex is the frame within the file
            : 0;  // Stack: always frame 0 within each instance file

        const canCine = mosaicActive ? (tileSteppingOn && tileCount > 1) : seriesCanCine;
        const cineReason = mosaicActive
            ? (tileSteppingOn ? (tileCount > 1 ? undefined : 'Only one mosaic tile') : 'Mosaic tiles are not acquisition frames')
            : seriesCineReason;
        const mosaicTooltip = mosaicGrid?.assumedGrid
            ? `This is a single image containing multiple tiles. Tiles are not acquisition frames. Grid inferred: ${mosaicGrid.rows}×${mosaicGrid.cols}.`
            : 'This is a single image containing multiple tiles. Tiles are not acquisition frames.';
        const mosaicMeasurementAllowed = !mosaicActive
            || (series.geometryTrustInfo?.spacingSource === 'PixelSpacing'
                && (series.geometryTrustInfo.level === 'verified' || series.geometryTrustInfo.level === 'trusted'));
        const mosaicMeasurementWarning = mosaicActive && !mosaicMeasurementAllowed
            ? 'Measurements disabled: spacing untrusted for mosaic tiles'
            : null;

        const resolveRenderSource = useCallback((frame: DecodedFrame | null) => {
            if (!frame) return null;
            if (!mosaicActive || !mosaicGrid) {
                return {
                    frame,
                    mosaic: null,
                    width: frame.width,
                    height: frame.height,
                    tileInfo: undefined,
                };
            }

            const safeIndex = Math.min(tileIndex, mosaicGrid.tileCount - 1);
            const rect = computeMosaicTileRect(
                frame.width,
                frame.height,
                mosaicGrid.rows,
                mosaicGrid.cols,
                safeIndex
            );

            return {
                frame,
                mosaic: {
                    rows: mosaicGrid.rows,
                    cols: mosaicGrid.cols,
                    tileIndex: safeIndex,
                    tileCount: mosaicGrid.tileCount,
                    assumedGrid: mosaicGrid.assumedGrid,
                },
                width: rect.w,
                height: rect.h,
                tileInfo: {
                    tileIndex: safeIndex,
                    tileCount: mosaicGrid.tileCount,
                    grid: { rows: mosaicGrid.rows, cols: mosaicGrid.cols },
                    kind: contactSheet?.kind ?? 'heuristic',
                },
            };
        }, [mosaicActive, mosaicGrid, tileIndex, contactSheet]);

        useEffect(() => {
            if (!mosaicActive) {
                if (tileIndex !== 0) setTileIndex(0);
                if (tileSteppingEnabled) setTileSteppingEnabled(false);
                return;
            }
            const maxIndex = Math.max(0, tileCount - 1);
            if (tileIndex > maxIndex) {
                setTileIndex(maxIndex);
            }
        }, [mosaicActive, tileCount, tileIndex, tileSteppingEnabled]);

        useEffect(() => {
            if (mosaicActive && viewState.frameIndex !== 0) {
                setViewState(prev => ({ ...prev, frameIndex: 0 }));
            }
        }, [mosaicActive, viewState.frameIndex]);

        useEffect(() => {
            if (mosaicActive && !mosaicMeasurementAllowed && viewState.activeTool === 'length') {
                setViewState(prev => ({ ...prev, activeTool: 'hand' }));
            }
        }, [mosaicActive, mosaicMeasurementAllowed, viewState.activeTool]);

        const resolveWindowDefaults = useCallback((frame: DecodedFrame | null) => {
            if (!frame) {
                return { center: 40, width: 400, source: 'assumed' as const };
            }
            if (frame.windowProvided && frame.windowWidth > 0) {
                return { center: frame.windowCenter, width: frame.windowWidth, source: 'dicom' as const };
            }
            const cached = getSeriesWindowDefault(series.seriesInstanceUid);
            if (cached) {
                return { center: cached.center, width: cached.width, source: 'assumed' as const };
            }
            const fallback = computeFallbackWindow(frame);
            return { center: fallback.center, width: fallback.width, source: 'assumed' as const };
        }, [series.seriesInstanceUid]);

        const computeSeriesWindowDefaults = useCallback(async () => {
            if (assumedWindowTokenRef.current === activeSeriesTokenRef.current) return;
            if (getSeriesWindowDefault(series.seriesInstanceUid)) return;
            if (instances.length === 0) return;

            const token = activeSeriesTokenRef.current;
            assumedWindowTokenRef.current = token;
            try {
                const samples: number[] = [];
                const targets = isMultiframe
                    ? buildSampleIndices(baseTotalFrames, WINDOW_SAMPLE_FRAMES).map(frameNumber => ({
                        instance: instances[0],
                        frameNumber,
                    }))
                    : buildSampleIndices(instances.length, WINDOW_SAMPLE_FRAMES).map(idx => ({
                        instance: instances[idx],
                        frameNumber: 0,
                    }));

                for (const target of targets) {
                    try {
                        const frame = await decodeFrame(target.instance, target.frameNumber);
                        if (activeSeriesTokenRef.current !== token) return;
                        samples.push(...collectModalitySamples(frame, WINDOW_SAMPLE_PIXELS));
                    } catch {
                        // Ignore sample errors; we'll compute from remaining frames
                    }
                }

                if (activeSeriesTokenRef.current !== token) return;
                if (samples.length === 0) return;

                const result = computePercentileWindow(
                    samples,
                    WINDOW_PERCENTILE_LOW,
                    WINDOW_PERCENTILE_HIGH
                );
                setSeriesWindowDefault(series.seriesInstanceUid, {
                    center: result.center,
                    width: result.width,
                    low: result.low,
                    high: result.high,
                    method: 'percentile',
                });

                if (!windowingLockedRef.current && activeSeriesTokenRef.current === token) {
                    setViewState(prev => ({
                        ...prev,
                        windowCenter: result.center,
                        windowWidth: result.width,
                    }));
                }
                setWindowingSource('assumed');
            } finally {
                if (assumedWindowTokenRef.current === token) {
                    assumedWindowTokenRef.current = null;
                }
            }
        }, [instances, isMultiframe, baseTotalFrames, series.seriesInstanceUid]);



        // Register files with decode bridge via Registry
        useEffect(() => {
            let mounted = true;

            const resolveFiles = async () => {
                setMissingPermission(false);
                setWaitingForFiles(false);

                const fileEntries: { instance: Instance; file: File }[] = [];
                let permissionErrorFound = false;

                for (const instance of instances) {
                    const entry = fileRegistry.get(instance.fileKey);

                    if (!entry) continue;

                    try {
                        let file: File;
                        if (entry.kind === 'file') {
                            file = entry.file;
                        } else {
                            // Prefer cached file if available (from scan)
                            if (entry.file) {
                                file = entry.file;
                            } else {
                                // Fallback to getting file from handle
                                file = await entry.handle.getFile();
                            }
                        }
                        fileEntries.push({ instance, file });
                    } catch (err) {
                        // Check for permission errors
                        if (err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'NotFoundError')) {
                            permissionErrorFound = true;
                        }
                        console.error('Failed to resolve file for instance', instance.sopInstanceUid, err);
                    }
                }

                if (mounted) {
                    if (permissionErrorFound) {
                        setMissingPermission(true);
                    } else if (fileEntries.length < instances.length) {
                        // If we have some files but not all, we might be scanning or restricted
                        setWaitingForFiles(true);

                        // Register what we have anyway
                        if (fileEntries.length > 0) {
                            registerInstanceFiles(fileEntries);
                        }
                    } else {
                        registerInstanceFiles(fileEntries);
                    }
                }
            };

            resolveFiles();

            return () => {
                mounted = false;
                // Clear only files for THIS series, not all files (multi-viewport safe)
                const instanceUids = instances.map(i => i.sopInstanceUid);
                clearInstanceFilesForSeries(instanceUids);
            };
        }, [instances, fileRegistry]);

        // Load frame when index changes (cache-first)
        useEffect(() => {
            if (!currentInstance) return;

            // Check transfer syntax support
            if (!isTransferSyntaxSupported(currentInstance.transferSyntaxUid)) {
                setError(`Unsupported: ${currentInstance.transferSyntaxUid}`);
                setIsUnsupported(true);
                setLoading(false);
                return;
            }

            // Multiframe is now supported - no rejection needed
            // The isMultiframe logic above handles frame addressing correctly

            const cacheKey = `${currentInstance.fileKey}:${intraFrameIndex}`;
            const cache = frameCacheRef.current;

            // Cache hit - instant display
            const cachedFrame = cache.get(cacheKey);
            if (cachedFrame) {
                if (DEBUG_PREFETCH) console.log('[PREFETCH] Cache HIT:', cacheKey);
                setCurrentFrame(cachedFrame);
                if (!contactSheet && cachedFrame.contactSheet && baseTotalFrames === 1) {
                    setContactSheet(cachedFrame.contactSheet);
                }
                if (viewState.frameIndex === 0 || !currentFrame) {
                    const defaults = resolveWindowDefaults(cachedFrame);
                    setViewState(prev => ({
                        ...prev,
                        windowCenter: defaults.center,
                        windowWidth: defaults.width,
                    }));
                    setWindowingSource(defaults.source);
                }
                setLoading(false);
                setError(null);
                return;
            }

            // Cache miss - decode
            if (DEBUG_PREFETCH) console.log('[PREFETCH] Cache MISS:', cacheKey);

            // Increment ID for this new frame load attempt - Latest Wins
            const requestId = ++activeRequestId.current;
            const token = activeSeriesTokenRef.current;

            // Only show loading if NOT playing cine (avoid flicker)
            // Keep last frame visible during decode
            if (!viewState.isPlaying) {
                setLoading(true);
            }
            setError(null);
            setIsUnsupported(false);

            decodeFrame(currentInstance, intraFrameIndex)
                .then(frame => {
                    // Ignore if stale request or series changed
                if (requestId !== activeRequestId.current || token !== activeSeriesTokenRef.current) return;

                // Store in cache
                cache.set(cacheKey, frame);

                setCurrentFrame(frame);
                if (!contactSheet && frame.contactSheet && baseTotalFrames === 1) {
                    setContactSheet(frame.contactSheet);
                }
                // Set initial window from frame defaults
                if (viewState.frameIndex === 0 || !currentFrame) {
                    const defaults = resolveWindowDefaults(frame);
                    setViewState(prev => ({
                        ...prev,
                            windowCenter: defaults.center,
                            windowWidth: defaults.width,
                        }));
                        setWindowingSource(defaults.source);
                    }
                    setLoading(false);
                })
                .catch(err => {
                    // Ignore if stale request or series changed
                    if (requestId !== activeRequestId.current || token !== activeSeriesTokenRef.current) return;

                    if (err instanceof DecodeError) {
                        setError(err.message);
                        setIsUnsupported(err.isUnsupported);
                    } else {
                        setError(err.message || 'Decode failed');
                    }
                    setLoading(false);
                });
        }, [currentInstance, intraFrameIndex, baseTotalFrames, contactSheet]);

        // Assumed VOI calculation for series (percentile-based)
        useEffect(() => {
            if (!currentFrame) return;
            if (currentFrame.windowProvided && currentFrame.windowWidth > 0) return;
            if (currentFrame.samplesPerPixel !== 1) return;
            computeSeriesWindowDefaults();
        }, [currentFrame, computeSeriesWindowDefaults]);

        // Prefetch pump - runs after frame changes
        const runPrefetchPump = useCallback(() => {
            const queue = prefetchQueueRef.current;
            const cache = frameCacheRef.current;
            const generation = prefetchGenerationRef.current;
            const token = activeSeriesTokenRef.current;

            // Pump while we have capacity and items in queue
            while (prefetchInflightRef.current < PREFETCH_MAX_INFLIGHT && queue.length > 0) {
                const instance = queue.shift()!;
                const cacheKey = `${instance.fileKey}:0`;

                // Skip if already cached or unsupported
                if (cache.has(cacheKey)) continue;
                if (!isTransferSyntaxSupported(instance.transferSyntaxUid)) continue;
                if (instance.numberOfFrames && instance.numberOfFrames > 1) continue;

                prefetchInflightRef.current++;
                if (DEBUG_PREFETCH) console.log('[PREFETCH] Fetching:', cacheKey, 'inflight:', prefetchInflightRef.current);

                decodeFrame(instance, 0)
                    .then(frame => {
                        // Check generation and series token
                        if (prefetchGenerationRef.current !== generation) {
                            if (DEBUG_PREFETCH) console.log('[PREFETCH] Stale generation, discarding:', cacheKey);
                            return;
                        }
                        if (activeSeriesTokenRef.current !== token) return;

                        cache.set(cacheKey, frame);
                        if (DEBUG_PREFETCH) console.log('[PREFETCH] Cached:', cacheKey, 'size:', cache.size);
                    })
                    .catch(() => {
                        // Silently ignore prefetch errors
                    })
                    .finally(() => {
                        prefetchInflightRef.current--;
                        // Pump again
                        if (prefetchGenerationRef.current === generation && activeSeriesTokenRef.current === token) {
                            runPrefetchPump();
                        }
                    });
            }
        }, []);

        // Schedule prefetch after frame index changes (direction-aware)
        useEffect(() => {
            const startIdx = viewState.frameIndex;
            const dir = lastNavDirRef.current;
            const queue: Instance[] = [];
            const queuedSet = prefetchQueuedSetRef.current;
            queuedSet.clear();

            // Use larger prefetch window during cine playback
            const prefetchAhead = viewState.isPlaying ? PREFETCH_CINE_AHEAD : PREFETCH_MANUAL_AHEAD;
            const prefetchBehind = viewState.isPlaying ? PREFETCH_CINE_BEHIND : PREFETCH_MANUAL_BEHIND;

            // Prefetch ahead in navigation direction
            for (let i = 1; i <= prefetchAhead; i++) {
                let idx: number;
                if (dir > 0) {
                    idx = (startIdx + i) % instances.length;
                } else {
                    idx = (startIdx - i + instances.length) % instances.length;
                }
                const inst = instances[idx];
                if (inst && !queuedSet.has(inst.fileKey)) {
                    queue.push(inst);
                    queuedSet.add(inst.fileKey);
                }
            }

            // Prefetch behind (opposite direction) for back-scroll resilience
            for (let i = 1; i <= prefetchBehind; i++) {
                let idx: number;
                if (dir > 0) {
                    idx = (startIdx - i + instances.length) % instances.length;
                } else {
                    idx = (startIdx + i) % instances.length;
                }
                const inst = instances[idx];
                if (inst && !queuedSet.has(inst.fileKey)) {
                    queue.push(inst);
                    queuedSet.add(inst.fileKey);
                }
            }

            prefetchQueueRef.current = queue;
            runPrefetchPump();
        }, [viewState.frameIndex, viewState.isPlaying, instances, runPrefetchPump]);

        // Render to canvas
        useEffect(() => {
            const canvas = canvasRef.current;
            if (!canvas) return;

            // Size canvas to container
            const container = containerRef.current;
            if (container) {
                const rect = container.getBoundingClientRect();
                canvas.width = rect.width;
                canvas.height = rect.height;
            }

            // Error state takes priority
            if (error) {
                renderError(canvas, error, isUnsupported);
                return;
            }

            // Resolve authoritative frame
            const authority = resolveFrameAuthority(
                viewState.frameIndex,
                currentFrame,
                lastGoodFrameRef.current,
                viewState.isPlaying
            );

            if (authority.reason === 'current' && authority.frame) {
                lastGoodFrameRef.current = authority.frame;
            }

            const isFallback = authority.isFallback;
            if (isBuffering !== isFallback) {
                setIsBuffering(isFallback);
            }

            const frameToRender = authority.frame;

            // Handle loading state
            if (!frameToRender) {
                if (loading) {
                    renderLoading(canvas, 'Decoding...');
                }
                return;
            }

            const renderSource = resolveRenderSource(frameToRender);
            if (!renderSource) {
                return;
            }

            if (import.meta.env.DEV) {
                console.debug('[Viewport] render', {
                    seriesUid: series.seriesInstanceUid,
                    kind: series.kind,
                    stackLike: effectiveStackLike,
                    totalFrames,
                    currentFrame: viewState.frameIndex,
                    authorityIndex: authority.index,
                    instanceUid: currentInstance?.sopInstanceUid,
                    frameNumber: intraFrameIndex,
                    decodedSize: { width: frameToRender.width, height: frameToRender.height },
                });
            }

            // Render the frame (current or last good)
            renderFrame(canvas, renderSource.frame, viewState, { mosaic: renderSource.mosaic });
            hasRenderedFrameRef.current = true;

            // Compute image-to-canvas transform for measurements
            const srcW = renderSource.width;
            const srcH = renderSource.height;
            const imageAspect = srcW / srcH;
            const canvasAspect = canvas.width / canvas.height;
            let displayWidth: number;
            let displayHeight: number;

            if (imageAspect > canvasAspect) {
                displayWidth = canvas.width;
                displayHeight = canvas.width / imageAspect;
            } else {
                displayHeight = canvas.height;
                displayWidth = canvas.height * imageAspect;
            }

            displayWidth *= viewState.zoom;
            displayHeight *= viewState.zoom;

            const offsetX = (canvas.width - displayWidth) / 2 + viewState.panX;
            const offsetY = (canvas.height - displayHeight) / 2 + viewState.panY;
            const scale = displayWidth / srcW;

            // Get pixel spacing from current instance
            let pixelSpacing: number[] | undefined;
            if (currentInstance?.pixelSpacing) {
                const parts = currentInstance.pixelSpacing.split('\\').map(parseFloat);
                if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                    pixelSpacing = parts;
                }
            } else if (currentInstance?.imagerPixelSpacing) {
                const parts = currentInstance.imagerPixelSpacing.split('\\').map(parseFloat);
                if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                    pixelSpacing = parts;
                }
            }

            drawOverlay(canvas, {
                frameIndex: viewState.frameIndex,
                totalFrames: totalFrames,
                windowCenter: viewState.windowCenter,
                windowWidth: viewState.windowWidth,
                windowSource: windowingSource,
                zoom: viewState.zoom,
                dimensions: { width: renderSource.width, height: renderSource.height },
                pixelSpacing,
                geometryTrust: series.geometryTrustInfo,
                measurements: viewState.measurements,
                inProgressMeasurement: measureRef.current,
                imageToCanvasTransform: { scale, offsetX, offsetY },
                cineInfo: {
                    isPlaying: viewState.isPlaying,
                    fps: viewState.cineFrameRate,
                    canCine,
                    isBuffering: isFallback,
                    cineReason
                },
                activePresetName: viewState.activePreset ? getPresetById(viewState.activePreset)?.label : undefined,
                tileInfo: renderSource.tileInfo,
            });
        }, [currentFrame, viewState, loading, error, isUnsupported, totalFrames, currentInstance, series.geometryTrustInfo, canCine, cineReason, windowingSource, resolveRenderSource, effectiveStackLike, series.seriesInstanceUid, series.kind, intraFrameIndex]);

        // Resize handler
        useEffect(() => {
            const handleResize = () => {
                const container = containerRef.current;
                const canvas = canvasRef.current;
                if (container && canvas) {
                    const rect = container.getBoundingClientRect();
                    canvas.width = rect.width;
                    canvas.height = rect.height;
                    // Trigger re-render
                    setViewState(prev => ({ ...prev }));
                }
            };

            window.addEventListener('resize', handleResize);
            handleResize();
            return () => window.removeEventListener('resize', handleResize);
        }, []);



        const toggleCine = useCallback(() => {
            // Guard: don't start cine on short series
            if (!canCine) return;

            setViewState(prev => {
                const newPlaying = !prev.isPlaying;

                if (newPlaying) {
                    // Set navigation direction to forward for cine
                    lastNavDirRef.current = 1;

                    // Time-based cine: record start time and index
                    cineStartTimeRef.current = performance.now();
                    cineStartIndexRef.current = prev.frameIndex;
                    if (mosaicActive && tileSteppingOn) {
                        tileCineStartIndexRef.current = tileIndex;
                    }
                } else {
                    // Stop cine - clear timing refs
                    cineStartTimeRef.current = 0;
                    cineStartIndexRef.current = 0;
                }

                return { ...prev, isPlaying: newPlaying };
            });
        }, [canCine, mosaicActive, tileSteppingOn, tileIndex]);

        // Cine loop effect - manages the interval based on isPlaying state
        useEffect(() => {
            const token = activeSeriesTokenRef.current;

            // Stop cine if series becomes ineligible (too few frames)
            if (viewState.isPlaying && !canCine) {
                setViewState(prev => ({ ...prev, isPlaying: false }));
                return;
            }

            // Only run interval when playing
            if (!viewState.isPlaying) {
                // Ensure cleanup when not playing
                if (cineIntervalRef.current) {
                    clearInterval(cineIntervalRef.current);
                    cineIntervalRef.current = null;
                }
                return;
            }

            const frameDurationMs = 1000 / viewState.cineFrameRate;
            // totalFrames is already computed above and used for cine target calculation

            // Kickstart prefetch for smoother cine start
            const queue: Instance[] = [];
            const queuedSet = prefetchQueuedSetRef.current;
            queuedSet.clear();
            for (let i = 1; i <= PREFETCH_CINE_AHEAD; i++) {
                const idx = (viewState.frameIndex + i) % totalFrames;
                const inst = instances[idx];
                if (inst && !queuedSet.has(inst.fileKey)) {
                    queue.push(inst);
                    queuedSet.add(inst.fileKey);
                }
            }
            prefetchQueueRef.current = queue;
            runPrefetchPump();

            // Time-based cine interval (catch-up skip)
            cineIntervalRef.current = window.setInterval(() => {
                // Strict token check to prevent phantom steps after series switch
                if (activeSeriesTokenRef.current !== token) return;

                if (mosaicActive && tileSteppingOn) {
                    if (tileCount <= 1) return;
                    const elapsed = performance.now() - cineStartTimeRef.current;
                    const framesSinceStart = Math.floor(elapsed / frameDurationMs);
                    const targetIndex = (tileCineStartIndexRef.current + framesSinceStart) % tileCount;
                    setTileIndex(prev => (prev === targetIndex ? prev : targetIndex));
                    return;
                }

                setViewState(p => {
                    // CRITICAL: Hard guard - do NOT advance if not playing
                    if (!p.isPlaying) return p;

                    const elapsed = performance.now() - cineStartTimeRef.current;
                    const framesSinceStart = Math.floor(elapsed / frameDurationMs);
                    const targetIndex = (cineStartIndexRef.current + framesSinceStart) % totalFrames;

                    // Only update if target is different (skip duplicates)
                    if (p.frameIndex === targetIndex) return p;
                    return { ...p, frameIndex: targetIndex };
                });
            }, frameDurationMs / 2); // Check at 2x rate for responsiveness

            // Cleanup on effect teardown (when isPlaying becomes false or component unmounts)
            return () => {
                if (cineIntervalRef.current) {
                    clearInterval(cineIntervalRef.current);
                    cineIntervalRef.current = null;
                }
            };
        }, [viewState.isPlaying, viewState.cineFrameRate, instances, runPrefetchPump, canCine, mosaicActive, tileSteppingOn, tileCount, totalFrames]);

        // Mouse handlers
        // Native wheel handler for non-passive prevention (stack scroll)
        useEffect(() => {
            const container = containerRef.current;
            if (!container) return;

            const onWheel = (e: WheelEvent) => {
                e.preventDefault();

                if (e.ctrlKey || e.metaKey) {
                    // Zoom
                    const delta = e.deltaY > 0 ? 0.9 : 1.1;
                    setViewState(prev => ({
                        ...prev,
                        zoom: Math.max(0.1, Math.min(10, prev.zoom * delta)),
                    }));
                    return;
                }

                if (mosaicActive) {
                    if (!tileSteppingOn || tileCount <= 1) return;

                    const fastMode = e.shiftKey;
                    const fineMode = e.altKey;
                    const threshold = fineMode ? 20 : 40;
                    const multiplier = fastMode ? 5 : 1;

                    wheelAccumulator.current += e.deltaY;

                    if (Math.abs(wheelAccumulator.current) >= threshold) {
                        const rawSteps = Math.trunc(wheelAccumulator.current / threshold);
                        wheelAccumulator.current %= threshold;

                        if (rawSteps !== 0) {
                            const steps = rawSteps * multiplier;
                            lastNavDirRef.current = steps > 0 ? 1 : -1;
                            setTileIndex(prev => Math.max(0, Math.min(tileCount - 1, prev + steps)));
                        }
                    }
                    return;
                }

                // Guard: Single frame series should not scroll (stops 1-frame jitter)
                if (!effectiveStackLike || totalFrames <= 1) return;

                {
                    // Stack scroll with modifier support
                    // Shift = fast (5 frames), Alt = fine (1 frame with lower threshold)
                    const fastMode = e.shiftKey;
                    const fineMode = e.altKey;

                    const threshold = fineMode ? 20 : 40; // Lower threshold for fine mode
                    const multiplier = fastMode ? 5 : 1;

                    wheelAccumulator.current += e.deltaY;

                    if (Math.abs(wheelAccumulator.current) >= threshold) {
                        const rawSteps = Math.trunc(wheelAccumulator.current / threshold);
                        wheelAccumulator.current %= threshold;

                        if (rawSteps !== 0) {
                            const dir = stackReverse ? -1 : 1;
                            const steps = rawSteps * multiplier * dir;
                            // Track navigation direction
                            lastNavDirRef.current = steps > 0 ? 1 : -1;

                            setViewState(prev => ({
                                ...prev,
                                frameIndex: Math.max(0, Math.min(totalFrames - 1, prev.frameIndex + steps))
                            }));
                        }
                    }
                }
            };

            container.addEventListener('wheel', onWheel, { passive: false });
            // Reset accumulator when series changes to prevent jump
            wheelAccumulator.current = 0;
            return () => container.removeEventListener('wheel', onWheel);
        }, [series.seriesInstanceUid, effectiveStackLike, mosaicActive, tileSteppingOn, tileCount, totalFrames, stackReverse]);

        // Imperative action handler for external routing (from MultiViewport)
        const applyAction = useCallback((action: ShortcutAction) => {
            if (!action) return;

            switch (action) {
                case 'TOGGLE_CINE':
                    toggleCine();
                    break;
                case 'PREV_FRAME':
                    if (mosaicActive && tileSteppingOn) {
                        setTileIndex(prev => Math.max(0, prev - 1));
                        break;
                    }
                    setViewState(prev => ({
                        ...prev,
                        frameIndex: calculateNextFrame(prev.frameIndex, totalFrames, -1, stackReverse)
                    }));
                    break;
                case 'NEXT_FRAME':
                    if (mosaicActive && tileSteppingOn) {
                        setTileIndex(prev => Math.min(tileCount - 1, prev + 1));
                        break;
                    }
                    setViewState(prev => ({
                        ...prev,
                        frameIndex: calculateNextFrame(prev.frameIndex, totalFrames, 1, stackReverse)
                    }));
                    break;
                case 'JUMP_BACK_10':
                    if (mosaicActive && tileSteppingOn) {
                        setTileIndex(prev => Math.max(0, prev - 10));
                        break;
                    }
                    setViewState(prev => ({
                        ...prev,
                        frameIndex: calculateNextFrame(prev.frameIndex, totalFrames, -10, stackReverse)
                    }));
                    break;
                case 'JUMP_FWD_10':
                    if (mosaicActive && tileSteppingOn) {
                        setTileIndex(prev => Math.min(tileCount - 1, prev + 10));
                        break;
                    }
                    setViewState(prev => ({
                        ...prev,
                        frameIndex: calculateNextFrame(prev.frameIndex, totalFrames, 10, stackReverse)
                    }));
                    break;
                case 'FIRST_FRAME':
                    if (mosaicActive && tileSteppingOn) {
                        setTileIndex(0);
                        break;
                    }
                    setViewState(prev => ({ ...prev, frameIndex: 0 }));
                    break;
                case 'LAST_FRAME':
                    if (mosaicActive && tileSteppingOn) {
                        setTileIndex(Math.max(0, tileCount - 1));
                        break;
                    }
                    setViewState(prev => ({ ...prev, frameIndex: totalFrames - 1 }));
                    break;
                case 'RESET':
                    windowingLockedRef.current = true;
                    {
                        const defaults = resolveWindowDefaults(currentFrame);
                        setViewState(prev => ({
                            ...prev,
                            zoom: 1, panX: 0, panY: 0,
                            windowCenter: defaults.center,
                            windowWidth: defaults.width,
                            invert: false
                        }));
                        setWindowingSource(defaults.source);
                    }
                    break;
                case 'INVERT':
                    setViewState(prev => ({ ...prev, invert: !prev.invert }));
                    break;
                case 'HAND_TOOL':
                    setViewState(prev => ({ ...prev, activeTool: 'hand' }));
                    break;
                case 'WL_TOOL':
                    setViewState(prev => ({ ...prev, activeTool: 'wl' }));
                    break;
                case 'ZOOM_TOOL':
                    setViewState(prev => ({ ...prev, activeTool: 'zoom' }));
                    break;
                case 'MEASURE_TOOL':
                    if (!mosaicMeasurementAllowed) {
                        dispatch({
                            type: 'SET_STATUS',
                            message: mosaicMeasurementWarning || 'Measurements disabled'
                        });
                        break;
                    }
                    setViewState(prev => ({ ...prev, activeTool: 'length' }));
                    break;
                case 'WL_PRESET_1':
                case 'WL_PRESET_2':
                case 'WL_PRESET_3':
                case 'WL_PRESET_4':
                case 'WL_PRESET_5': {
                    const index = parseInt(action.split('_')[2], 10) - 1;
                    const preset = PRESET_LIST[index];
                    if (preset) {
                        windowingLockedRef.current = true;
                        setViewState(prev => ({
                            ...prev,
                            windowCenter: preset.wc,
                            windowWidth: preset.ww,
                            activePreset: preset.id,
                        }));
                        dispatch({ type: 'SET_STATUS', message: `WL: ${preset.name} (${formatWl(preset.wc, preset.ww)})` });
                    }
                    break;
                }
                case 'WL_DICOM_DEFAULT': {
                    // Reset to DICOM-provided values
                    windowingLockedRef.current = true;
                    const dicomProvided = !!(currentFrame?.windowProvided && currentFrame.windowWidth > 0);
                    const defaults = resolveWindowDefaults(currentFrame);
                    const wc = dicomProvided ? currentFrame!.windowCenter : defaults.center;
                    const ww = dicomProvided ? currentFrame!.windowWidth : defaults.width;
                    setViewState(prev => ({
                        ...prev,
                        windowCenter: wc,
                        windowWidth: ww,
                        activePreset: dicomProvided ? 'dicom_default' : undefined,
                    }));
                    setWindowingSource(dicomProvided ? 'dicom' : defaults.source);
                    const label = dicomProvided ? 'DICOM Default' : 'Assumed VOI';
                    dispatch({ type: 'SET_STATUS', message: `WL: ${label} (${formatWl(wc, ww)})` });
                    break;
                }
                case 'CLOSE_DIALOG':
                    // Reset tool to hand
                    setViewState(prev => ({ ...prev, activeTool: 'hand' }));
                    break;
                case 'TOGGLE_HELP':
                    dispatch({ type: 'SET_SHORTCUTS_VISIBLE', visible: true });
                    break;
            }
        }, [totalFrames, stackReverse, toggleCine, dispatch, currentFrame, mosaicActive, tileSteppingOn, tileCount, mosaicMeasurementAllowed, mosaicMeasurementWarning]);

        // Expose imperative handle for external action routing
        useImperativeHandle(ref, () => ({
            applyAction,
        }), [applyAction]);

        // Convert canvas coordinates to image pixel coordinates
        const canvasToImageCoords = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
            const canvas = canvasRef.current;
            const container = containerRef.current;
            // Use resolveFrameAuthority to ensure we interact with the visible frame
            const authority = resolveFrameAuthority(
                viewState.frameIndex,
                currentFrame,
                lastGoodFrameRef.current,
                viewState.isPlaying
            );
            const frameForTools = authority.frame;
            if (!canvas || !container || !frameForTools) return null;
            const renderSource = resolveRenderSource(frameForTools);
            if (!renderSource) return null;

            const rect = canvas.getBoundingClientRect();
            const canvasX = clientX - rect.left;
            const canvasY = clientY - rect.top;

            // Reverse the display transform from renderFrame
            const imageAspect = renderSource.width / renderSource.height;
            const canvasAspect = canvas.width / canvas.height;

            let displayWidth: number;
            let displayHeight: number;

            if (imageAspect > canvasAspect) {
                displayWidth = canvas.width;
                displayHeight = canvas.width / imageAspect;
            } else {
                displayHeight = canvas.height;
                displayWidth = canvas.height * imageAspect;
            }

            displayWidth *= viewState.zoom;
            displayHeight *= viewState.zoom;

            const imageX = (canvas.width - displayWidth) / 2 + viewState.panX;
            const imageY = (canvas.height - displayHeight) / 2 + viewState.panY;

            // Convert canvas coords to image pixel coords
            const imgPixelX = ((canvasX - imageX) / displayWidth) * renderSource.width;
            const imgPixelY = ((canvasY - imageY) / displayHeight) * renderSource.height;

            return { x: imgPixelX, y: imgPixelY };
        }, [currentFrame, viewState.zoom, viewState.panX, viewState.panY, resolveRenderSource]);

        const handleMouseDown = useCallback((e: React.MouseEvent) => {
            // Measurement tool (length) takes priority on left click
            if (viewState.activeTool === 'length' && e.button === 0 && !e.shiftKey && !e.altKey && !e.ctrlKey) {
                if (!mosaicMeasurementAllowed) {
                    dispatch({
                        type: 'SET_STATUS',
                        message: mosaicMeasurementWarning || 'Measurements disabled'
                    });
                    return;
                }

                // Optional: Pause cine when drawing measurements
                if (preferences.pauseCineOnMeasure && viewState.isPlaying) {
                    toggleCine();
                }

                const imgCoords = canvasToImageCoords(e.clientX, e.clientY);
                if (imgCoords) {
                    measureRef.current = {
                        startX: imgCoords.x,
                        startY: imgCoords.y,
                        endX: imgCoords.x,
                        endY: imgCoords.y
                    };
                    dragRef.current = { startX: e.clientX, startY: e.clientY, mode: 'measure' };
                    // Force immediate overlay redraw so endpoints appear instantly
                    setViewState(prev => ({ ...prev }));
                }
                return;
            }

            // Tool-based modes (from keyboard shortcuts)
            if (viewState.activeTool === 'wl' && e.button === 0) {
                dragRef.current = { startX: e.clientX, startY: e.clientY, mode: 'wl' };
                return;
            }

            if (viewState.activeTool === 'zoom' && e.button === 0) {
                dragRef.current = { startX: e.clientX, startY: e.clientY, mode: 'zoom' };
                return;
            }

            // Fallback: modifier-based modes (for hand tool or no specific tool)
            // Right-click or Alt+Left: Stack scrub (drag up/down to scroll frames)
            if (e.button === 2 || (e.button === 0 && e.altKey)) {
                if (mosaicActive && (!tileSteppingOn || tileCount <= 1)) {
                    return;
                }
                const scrubTotal = mosaicActive ? tileCount : totalFrames;
                if (scrubTotal <= 1) return;
                const scrubStart = mosaicActive ? tileIndex : viewState.frameIndex;
                // Start scrub mode
                scrubRef.current = {
                    startFrame: scrubStart,
                    startY: e.clientY,
                    wasPlaying: viewState.isPlaying
                };
                // Pause cine while scrubbing
                if (viewState.isPlaying) {
                    toggleCine();
                }
                dragRef.current = { startX: e.clientX, startY: e.clientY, mode: 'scrub' };
            } else if (e.button === 0 && e.ctrlKey) {
                // Ctrl+Left: Window/Level
                dragRef.current = { startX: e.clientX, startY: e.clientY, mode: 'wl' };
            } else if (e.button === 0 || e.button === 1) {
                // Left or Middle: Pan
                dragRef.current = { startX: e.clientX, startY: e.clientY, mode: 'pan' };
            }
        }, [viewState.activeTool, viewState.isPlaying, viewState.frameIndex, preferences.pauseCineOnMeasure, canvasToImageCoords, toggleCine, mosaicActive, tileSteppingOn, tileCount, totalFrames, tileIndex, mosaicMeasurementAllowed, mosaicMeasurementWarning, dispatch]);

        const handleMouseMove = useCallback((e: React.MouseEvent) => {
            if (!dragRef.current.mode) return;

            if (dragRef.current.mode === 'measure') {
                const imgCoords = canvasToImageCoords(e.clientX, e.clientY);
                if (imgCoords && measureRef.current) {
                    measureRef.current.endX = imgCoords.x;
                    measureRef.current.endY = imgCoords.y;
                    // Force re-render to update measurement line
                    setViewState(prev => ({ ...prev }));
                }
                return;
            }

            const dx = e.clientX - dragRef.current.startX;
            const dy = e.clientY - dragRef.current.startY;

            if (dragRef.current.mode === 'pan') {
                setViewState(prev => ({
                    ...prev,
                    panX: prev.panX + dx,
                    panY: prev.panY + dy,
                }));
            } else if (dragRef.current.mode === 'wl') {
                windowingLockedRef.current = true;
                setViewState(prev => ({
                    ...prev,
                    windowCenter: prev.windowCenter + dy,
                    windowWidth: Math.max(1, prev.windowWidth + dx * 2),
                }));
            } else if (dragRef.current.mode === 'zoom') {
                // Zoom via vertical drag: up = zoom in, down = zoom out
                const zoomDelta = 1 + dy * -0.005;
                setViewState(prev => ({
                    ...prev,
                    zoom: Math.max(0.1, Math.min(10, prev.zoom * zoomDelta)),
                }));
            } else if (dragRef.current.mode === 'scrub') {
                // Stack scrub: use absolute Y from start, not delta
                const scrubTotal = mosaicActive ? tileCount : totalFrames;
                if (scrubTotal <= 1) return;
                const newIndex = calculateScrubFrameIndex(
                    scrubRef.current.startFrame,
                    scrubRef.current.startY,
                    e.clientY,
                    scrubTotal,
                    e.shiftKey
                );
                if (mosaicActive) {
                    setTileIndex(newIndex);
                } else {
                    setViewState(prev => ({
                        ...prev,
                        frameIndex: newIndex,
                    }));
                }
                // Don't update startY for scrub - we use absolute position
                return;
            }

            dragRef.current.startX = e.clientX;
            dragRef.current.startY = e.clientY;
        }, [canvasToImageCoords, mosaicActive, tileCount, totalFrames]);

        const handleMouseUp = useCallback(() => {
            // Commit measurement if we were drawing one
            if (dragRef.current.mode === 'measure' && measureRef.current) {
                const m = measureRef.current;
                // Only add if it's not a zero-length line
                const dx = m.endX - m.startX;
                const dy = m.endY - m.startY;
                if (Math.sqrt(dx * dx + dy * dy) > 2) {
                    setViewState(prev => ({
                        ...prev,
                        measurements: [...prev.measurements, {
                            id: crypto.randomUUID(),
                            startX: m.startX,
                            startY: m.startY,
                            endX: m.endX,
                            endY: m.endY
                        }]
                    }));
                }
                measureRef.current = null;
            }

            // Resume cine if it was playing before scrub started
            if (dragRef.current.mode === 'scrub' && scrubRef.current.wasPlaying && canCine) {
                toggleCine();
            }

            dragRef.current.mode = null;
        }, [canCine, toggleCine]);

        const handleContextMenu = useCallback((e: React.MouseEvent) => {
            e.preventDefault();
        }, []);

        // Geometry trust computed from series.geometryTrust

        return (
            <div className="dicom-viewer">
                <div className="dicom-viewer__toolbar">
                    <div className="dicom-viewer__info">
                        <span className="dicom-viewer__modality">{series.modality}</span>
                        <span className="dicom-viewer__description">{series.description}</span>
                        <span
                            className="dicom-viewer__trust"
                            style={{ opacity: 0.8, fontSize: '0.85em', cursor: 'help' }}
                            title={series.geometryTrustInfo?.reasons.join('\n') || (series.geometryTrust === 'untrusted' ? 'Sorted by Instance Number (Fallback)' : 'Sorted by IPP')}
                        >
                            {series.geometryTrust === 'verified' && '🟢 Spatial Verified'}
                            {series.geometryTrust === 'trusted' && '⚠️ Spatial (Irregular)'}
                            {series.geometryTrust === 'untrusted' && '🔢 Instance Order'}
                            {(series.geometryTrust === 'unknown' || !series.geometryTrust) && '❓ Unknown Order'}
                        </span>
                    </div>
                    <div className="dicom-viewer__controls">
                        <button
                            onClick={() => setViewState(prev => ({ ...prev, activeTool: 'hand' }))}
                            title="Hand Tool (H) - Pan/Window/Level"
                            style={{
                                fontWeight: viewState.activeTool === 'hand' ? 'bold' : 'normal',
                                background: viewState.activeTool === 'hand' ? 'var(--color-surface-hover)' : undefined,
                                borderColor: viewState.activeTool === 'hand' ? 'var(--color-primary)' : undefined
                            }}
                        >
                            ✋
                        </button>
                        <button
                            onClick={() => setViewState(prev => ({ ...prev, activeTool: 'length' }))}
                            title={mosaicMeasurementAllowed
                                ? 'Length Tool (M) - Measure Distance'
                                : mosaicMeasurementWarning || 'Measurements disabled'}
                            disabled={!mosaicMeasurementAllowed}
                            style={{
                                fontWeight: viewState.activeTool === 'length' ? 'bold' : 'normal',
                                background: viewState.activeTool === 'length' ? 'var(--color-surface-hover)' : undefined,
                                borderColor: viewState.activeTool === 'length' ? 'var(--color-primary)' : undefined,
                                opacity: mosaicMeasurementAllowed ? 1 : 0.5
                            }}
                        >
                            📏
                        </button>
                        {viewState.activeTool === 'length' && (
                            <button
                                onClick={() => dispatch({
                                    type: 'SET_PREFERENCE',
                                    key: 'pauseCineOnMeasure',
                                    value: !preferences.pauseCineOnMeasure
                                })}
                                title={`Pause cine while dragging: ${preferences.pauseCineOnMeasure ? 'ON' : 'OFF'}`}
                                style={{
                                    opacity: preferences.pauseCineOnMeasure ? 1 : 0.3,
                                    fontSize: '0.9em',
                                    width: '24px',
                                    marginLeft: '2px',
                                    marginRight: '4px',
                                    color: preferences.pauseCineOnMeasure ? '#fc4' : 'inherit'
                                }}
                            >
                                ⏸
                            </button>
                        )}
                        <button
                            onClick={toggleCine}
                            disabled={!canCine}
                            title={canCine ? 'Toggle cine (Space)' : `Cine disabled: ${cineReason || 'Not eligible'}`}
                            style={{ opacity: canCine ? 1 : 0.5 }}
                        >
                            {viewState.isPlaying ? '⏸' : '▶'}
                        </button>
                        <button
                            onClick={() => dispatch({
                                type: 'UPDATE_SERIES_PREF',
                                seriesKey,
                                prefKey: 'stackReverse',
                                value: !stackReverse
                            })}
                            title={`Stack Direction: ${stackReverse ? 'Reverse' : 'Normal'} (Persisted)`}
                            style={{ color: stackReverse ? '#fc4' : 'inherit', fontSize: '1.1em' }}
                        >
                            ⇅
                        </button>
                        {mosaicActive && (
                            <button
                                onClick={() => {
                                    setTileSteppingEnabled(prev => {
                                        const next = !prev;
                                        dispatch({
                                            type: 'SET_STATUS',
                                            message: `Tile stepping ${next ? 'enabled' : 'disabled'}`
                                        });
                                        return next;
                                    });
                                }}
                                title={`${mosaicTooltip} Step tiles to navigate within the mosaic.`}
                                style={{
                                    color: tileSteppingOn ? '#4f4' : 'inherit',
                                    background: tileSteppingOn ? 'var(--color-surface-hover)' : undefined,
                                    borderColor: tileSteppingOn ? '#4f4' : undefined,
                                    fontSize: '0.85em'
                                }}
                            >
                                Step tiles
                            </button>
                        )}
                        <button onClick={() => setViewState(prev => ({ ...prev, invert: !prev.invert }))} title="Invert (I)">
                            ◐
                        </button>
                        <button
                            onClick={() => {
                                windowingLockedRef.current = true;
                                const defaults = resolveWindowDefaults(currentFrame);
                                setViewState({ ...DEFAULT_STATE, windowCenter: defaults.center, windowWidth: defaults.width });
                                setWindowingSource(defaults.source);
                            }}
                            title="Reset (R)"
                        >
                            ↺
                        </button>
                        {viewState.measurements.length > 0 && (
                            <button
                                onClick={() => setViewState(prev => ({ ...prev, measurements: [] }))}
                                title="Clear all measurements"
                                style={{ color: '#f66' }}
                            >
                                🗑
                            </button>
                        )}
                    </div>
                </div>

                <div
                    ref={containerRef}
                    className="dicom-viewer__canvas-container"
                    data-tool={viewState.activeTool}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    onContextMenu={handleContextMenu}
                >
                    <canvas ref={canvasRef} className="dicom-viewer__canvas" />

                    {(missingPermission || waitingForFiles) && (
                        <div style={{
                            position: 'absolute',
                            top: 0, left: 0, right: 0, bottom: 0,
                            display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                            background: 'rgba(0,0,0,0.8)', color: 'white',
                            zIndex: 10
                        }}>
                            {missingPermission ? (
                                <>
                                    <h3>⚠️ Permission Required</h3>
                                    <p>Browser requires gesture to read files.</p>
                                    <p style={{ fontSize: '0.9em', opacity: 0.8 }}>Please re-open the folder.</p>
                                </>
                            ) : (
                                <>
                                    <div className="dicom-viewer__spinner" />
                                    <h3>Loading Files...</h3>
                                    <p>Waiting for scanner...</p>
                                </>
                            )}
                        </div>
                    )}
                </div>

                <div className="dicom-viewer__status">
                    <span>Frame: {viewState.frameIndex + 1}/{totalFrames}</span>
                    {mosaicActive && (
                        <span title={mosaicTooltip}>MOSAIC / CONTACT SHEET tile {tileIndex + 1}/{tileCount}</span>
                    )}
                    {mosaicMeasurementWarning && (
                        <span title={mosaicMeasurementWarning} style={{ color: '#fc4' }}>
                            ⚠ measure off
                        </span>
                    )}
                    <span>WC/WW: {Math.round(viewState.windowCenter)}/{Math.round(viewState.windowWidth)}</span>
                    {windowingSource === 'assumed' && (
                        <span
                            className="dicom-viewer__assumed-voi"
                            title="VOI computed from sampled frames"
                        >
                            assumed VOI
                        </span>
                    )}
                    <span>Zoom: {Math.round(viewState.zoom * 100)}%</span>
                    {viewState.isPlaying && <span className="dicom-viewer__cine">▶ CINE</span>}
                    {isBuffering && <span className="dicom-viewer__buffering" title="Displaying previous frame while decoding">⏳</span>}
                </div>
            </div>
        );
    }
);



export function Viewport() {
    const viewerEnabled = getFlag('viewerEnabled');
    const { selectedSeries, fileRegistry } = useAppState();

    if (!viewerEnabled) {
        // ... (disabled state)
        return (
            <main className="viewport viewport--disabled">
                <div className="viewport__placeholder">
                    <span className="viewport__placeholder-icon">🔒</span>
                    <h2>Viewer Disabled</h2>
                    <p>The viewer is currently disabled via feature flags</p>
                </div>
            </main>
        );
    }

    if (!selectedSeries) {
        // ... (placeholder state)
        return (
            <main className="viewport">
                <div className="viewport__placeholder">
                    <span className="viewport__placeholder-icon">🖼️</span>
                    <h2>DICOM Viewport</h2>
                    <p>Select a series to view</p>
                    <div className="viewport__info">
                        <div className="viewport__info-row">
                            <span>Stack scroll</span>
                            <kbd>Wheel / ↑↓</kbd>
                        </div>
                        <div className="viewport__info-row">
                            <span>Zoom</span>
                            <kbd>Ctrl+Wheel</kbd>
                        </div>
                        <div className="viewport__info-row">
                            <span>Pan</span>
                            <kbd>Left drag</kbd>
                        </div>
                        <div className="viewport__info-row">
                            <span>Window/Level</span>
                            <kbd>Right drag / Alt+drag</kbd>
                        </div>
                        <div className="viewport__info-row">
                            <span>Invert</span>
                            <kbd>I</kbd>
                        </div>
                        <div className="viewport__info-row">
                            <span>Reset</span>
                            <kbd>R</kbd>
                        </div>
                        <div className="viewport__info-row">
                            <span>Cine</span>
                            <kbd>Space</kbd>
                        </div>
                    </div>
                </div>
            </main>
        );
    }

    return (
        <main className="viewport">
            <DicomViewer
                key={selectedSeries.seriesInstanceUid}
                series={selectedSeries}
                fileRegistry={fileRegistry}
            />
        </main>
    );
}
