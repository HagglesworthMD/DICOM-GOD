/**
 * DICOM Viewport - Real image viewer with interactions
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import { getFlag } from '../core/featureFlags';
import { useAppState } from '../state/store';
import {
    decodeFrame,
    registerInstanceFiles,
    clearInstanceFiles,
    DecodeError
} from '../core/decodeBridge';
import { renderFrame, renderLoading, renderError, drawOverlay } from '../core/canvas2dRenderer';
// geometryTrust helpers available if needed
import { verifySeriesGeometry as _verifySeriesGeometry } from '../core/geometryTrust';
void _verifySeriesGeometry; // Suppress unused warning - may be used later
import { isTransferSyntaxSupported } from '../core/types';
import type { Series, Instance, DecodedFrame, ViewportState, FileRegistry } from '../core/types';
import './Viewport.css';

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

// ============================================================================
// LRU Frame Cache
// ============================================================================
const CACHE_MAX_SIZE = 32;
const PREFETCH_AHEAD = 6;    // Frames to prefetch in nav direction
const PREFETCH_BEHIND = 2;   // Frames to prefetch behind (for backscroll)
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

export function DicomViewer({ series, fileRegistry }: DicomViewerProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [viewState, setViewState] = useState<ViewportState>(DEFAULT_STATE);
    const [currentFrame, setCurrentFrame] = useState<DecodedFrame | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isUnsupported, setIsUnsupported] = useState(false);
    const [missingPermission, setMissingPermission] = useState(false);
    const [waitingForFiles, setWaitingForFiles] = useState(false);
    const cineIntervalRef = useRef<number | null>(null);
    const dragRef = useRef<{ startX: number; startY: number; mode: 'pan' | 'wl' | 'measure' | null }>({ startX: 0, startY: 0, mode: null });
    const wheelAccumulator = useRef(0);
    const activeRequestId = useRef(0);

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

    // Track if we've successfully rendered at least one frame (for safe cine overlay suppression)
    const hasRenderedFrameRef = useRef(false);



    const instances = series.instances;
    const currentInstance = instances[viewState.frameIndex];



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
            clearInstanceFiles();
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

        // Check multi-frame
        if (currentInstance.numberOfFrames && currentInstance.numberOfFrames > 1) {
            setError('Multi-frame DICOM not yet supported');
            setIsUnsupported(true);
            setLoading(false);
            return;
        }

        const cacheKey = `${currentInstance.fileKey}:0`;
        const cache = frameCacheRef.current;

        // Cache hit - instant display
        const cachedFrame = cache.get(cacheKey);
        if (cachedFrame) {
            if (DEBUG_PREFETCH) console.log('[PREFETCH] Cache HIT:', cacheKey);
            setCurrentFrame(cachedFrame);
            if (viewState.frameIndex === 0 || !currentFrame) {
                setViewState(prev => ({
                    ...prev,
                    windowCenter: cachedFrame.windowCenter,
                    windowWidth: cachedFrame.windowWidth,
                }));
            }
            setLoading(false);
            setError(null);
            return;
        }

        // Cache miss - decode
        if (DEBUG_PREFETCH) console.log('[PREFETCH] Cache MISS:', cacheKey);

        // Increment ID for this new frame load attempt - Latest Wins
        const requestId = ++activeRequestId.current;

        // Only show loading if NOT playing cine (avoid flicker)
        // Keep last frame visible during decode
        if (!viewState.isPlaying) {
            setLoading(true);
        }
        setError(null);
        setIsUnsupported(false);

        decodeFrame(currentInstance, 0)
            .then(frame => {
                // Ignore if stale
                if (requestId !== activeRequestId.current) return;

                // Store in cache
                cache.set(cacheKey, frame);

                setCurrentFrame(frame);
                // Set initial window from frame defaults
                if (viewState.frameIndex === 0 || !currentFrame) {
                    setViewState(prev => ({
                        ...prev,
                        windowCenter: frame.windowCenter,
                        windowWidth: frame.windowWidth,
                    }));
                }
                setLoading(false);
            })
            .catch(err => {
                // Ignore if stale
                if (requestId !== activeRequestId.current) return;

                if (err instanceof DecodeError) {
                    setError(err.message);
                    setIsUnsupported(err.isUnsupported);
                } else {
                    setError(err.message || 'Decode failed');
                }
                setLoading(false);
            });
    }, [currentInstance, viewState.frameIndex]);

    // Prefetch pump - runs after frame changes
    const runPrefetchPump = useCallback(() => {
        const queue = prefetchQueueRef.current;
        const cache = frameCacheRef.current;
        const generation = prefetchGenerationRef.current;

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
                    // Check generation - ignore if series changed
                    if (prefetchGenerationRef.current !== generation) {
                        if (DEBUG_PREFETCH) console.log('[PREFETCH] Stale generation, discarding:', cacheKey);
                        return;
                    }
                    cache.set(cacheKey, frame);
                    if (DEBUG_PREFETCH) console.log('[PREFETCH] Cached:', cacheKey, 'size:', cache.size);
                })
                .catch(() => {
                    // Silently ignore prefetch errors
                })
                .finally(() => {
                    prefetchInflightRef.current--;
                    // Pump again
                    if (prefetchGenerationRef.current === generation) {
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

        // Prefetch ahead in navigation direction
        for (let i = 1; i <= PREFETCH_AHEAD; i++) {
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
        for (let i = 1; i <= PREFETCH_BEHIND; i++) {
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
    }, [viewState.frameIndex, instances, runPrefetchPump]);

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

        // During cine, suppress loading overlay ONLY if we've already rendered at least one frame
        // This prevents flicker while keeping honest "Loading..." for initial load
        const canSuppressLoading = viewState.isPlaying && hasRenderedFrameRef.current;
        if (loading && !canSuppressLoading) {
            renderLoading(canvas, 'Loading...');
            return;
        }

        if (error) {
            renderError(canvas, error, isUnsupported);
            return;
        }

        if (currentFrame) {
            renderFrame(canvas, currentFrame, viewState);
            hasRenderedFrameRef.current = true; // Mark that we've successfully rendered

            // Compute image-to-canvas transform for measurements
            const imageAspect = currentFrame.width / currentFrame.height;
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
            const scale = displayWidth / currentFrame.width;

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
                totalFrames: instances.length,
                windowCenter: viewState.windowCenter,
                windowWidth: viewState.windowWidth,
                zoom: viewState.zoom,
                dimensions: { width: currentFrame.width, height: currentFrame.height },
                pixelSpacing,
                geometryTrust: series.geometryTrustInfo,
                measurements: viewState.measurements,
                inProgressMeasurement: measureRef.current,
                imageToCanvasTransform: { scale, offsetX, offsetY }
            });
        }
    }, [currentFrame, viewState, loading, error, isUnsupported, instances.length, currentInstance, series.geometryTrustInfo]);

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

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement) return;

            switch (e.key.toLowerCase()) {
                case 'i':
                    setViewState(prev => ({ ...prev, invert: !prev.invert }));
                    break;
                case 'r':
                    setViewState(prev => ({
                        ...prev,
                        zoom: 1,
                        panX: 0,
                        panY: 0,
                        invert: false,
                        windowCenter: currentFrame?.windowCenter ?? 40,
                        windowWidth: currentFrame?.windowWidth ?? 400,
                    }));
                    break;
                case ' ':
                    e.preventDefault();
                    toggleCine();
                    break;
                case 'arrowup':
                    e.preventDefault();
                    prevFrame();
                    break;
                case 'arrowdown':
                    e.preventDefault();
                    nextFrame();
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [currentFrame]);

    const nextFrame = useCallback(() => {
        setViewState(prev => ({
            ...prev,
            frameIndex: Math.min(prev.frameIndex + 1, instances.length - 1),
        }));
    }, [instances.length]);

    const prevFrame = useCallback(() => {
        setViewState(prev => ({
            ...prev,
            frameIndex: Math.max(prev.frameIndex - 1, 0),
        }));
    }, []);

    const toggleCine = useCallback(() => {
        setViewState(prev => {
            const newPlaying = !prev.isPlaying;

            if (newPlaying) {
                // Set navigation direction to forward for cine
                lastNavDirRef.current = 1;

                // Time-based cine: record start time and index
                cineStartTimeRef.current = performance.now();
                cineStartIndexRef.current = prev.frameIndex;
            } else {
                // Stop cine - clear timing refs
                cineStartTimeRef.current = 0;
                cineStartIndexRef.current = 0;
            }

            return { ...prev, isPlaying: newPlaying };
        });
    }, []);

    // Cine loop effect - manages the interval based on isPlaying state
    useEffect(() => {
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
        const totalFrames = instances.length;

        // Kickstart prefetch for smoother cine start
        const queue: Instance[] = [];
        const queuedSet = prefetchQueuedSetRef.current;
        queuedSet.clear();
        for (let i = 1; i <= PREFETCH_AHEAD; i++) {
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
    }, [viewState.isPlaying, viewState.cineFrameRate, instances, runPrefetchPump]);

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
            } else {
                // Stack scroll
                wheelAccumulator.current += e.deltaY;
                const threshold = 40; // Pixels per step

                if (Math.abs(wheelAccumulator.current) >= threshold) {
                    const steps = Math.trunc(wheelAccumulator.current / threshold);
                    wheelAccumulator.current %= threshold;

                    if (steps !== 0) {
                        // Track navigation direction
                        lastNavDirRef.current = steps > 0 ? 1 : -1;

                        setViewState(prev => ({
                            ...prev,
                            frameIndex: Math.max(0, Math.min(instances.length - 1, prev.frameIndex + steps))
                        }));
                    }
                }
            }
        };

        container.addEventListener('wheel', onWheel, { passive: false });
        // Reset accumulator when series changes to prevent jump
        wheelAccumulator.current = 0;
        return () => container.removeEventListener('wheel', onWheel);
    }, [series.seriesInstanceUid, instances.length]);

    // Convert canvas coordinates to image pixel coordinates
    const canvasToImageCoords = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container || !currentFrame) return null;

        const rect = canvas.getBoundingClientRect();
        const canvasX = clientX - rect.left;
        const canvasY = clientY - rect.top;

        // Reverse the display transform from renderFrame
        const imageAspect = currentFrame.width / currentFrame.height;
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
        const imgPixelX = ((canvasX - imageX) / displayWidth) * currentFrame.width;
        const imgPixelY = ((canvasY - imageY) / displayHeight) * currentFrame.height;

        return { x: imgPixelX, y: imgPixelY };
    }, [currentFrame, viewState.zoom, viewState.panX, viewState.panY]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        // Measurement tool takes priority on left click
        if (viewState.activeTool === 'length' && e.button === 0 && !e.shiftKey && !e.altKey && !e.ctrlKey) {
            const imgCoords = canvasToImageCoords(e.clientX, e.clientY);
            if (imgCoords) {
                measureRef.current = {
                    startX: imgCoords.x,
                    startY: imgCoords.y,
                    endX: imgCoords.x,
                    endY: imgCoords.y
                };
                dragRef.current = { startX: e.clientX, startY: e.clientY, mode: 'measure' };
            }
            return;
        }

        if (e.button === 0 && (e.altKey || e.ctrlKey)) {
            // Window/Level
            dragRef.current = { startX: e.clientX, startY: e.clientY, mode: 'wl' };
        } else if (e.button === 2 || (e.button === 0 && e.shiftKey)) {
            // Window/Level (right click)
            dragRef.current = { startX: e.clientX, startY: e.clientY, mode: 'wl' };
        } else if (e.button === 0 || e.button === 1) {
            // Pan
            dragRef.current = { startX: e.clientX, startY: e.clientY, mode: 'pan' };
        }
    }, [viewState.activeTool, canvasToImageCoords]);

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
            setViewState(prev => ({
                ...prev,
                windowCenter: prev.windowCenter + dy,
                windowWidth: Math.max(1, prev.windowWidth + dx * 2),
            }));
        }

        dragRef.current.startX = e.clientX;
        dragRef.current.startY = e.clientY;
    }, [canvasToImageCoords]);

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
        dragRef.current.mode = null;
    }, []);

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
                        onClick={() => setViewState(prev => ({ ...prev, activeTool: prev.activeTool === 'hand' ? 'length' : 'hand' }))}
                        title={viewState.activeTool === 'hand' ? 'Hand Tool (H) - Click to switch to Measure' : 'Length Tool (M) - Click to switch to Hand'}
                        style={{ fontWeight: viewState.activeTool === 'length' ? 'bold' : 'normal' }}
                    >
                        {viewState.activeTool === 'hand' ? '✋' : '📏'}
                    </button>
                    <button onClick={toggleCine} title="Toggle cine (Space)">
                        {viewState.isPlaying ? '⏸' : '▶'}
                    </button>
                    <button onClick={() => setViewState(prev => ({ ...prev, invert: !prev.invert }))} title="Invert (I)">
                        ◐
                    </button>
                    <button onClick={() => setViewState({ ...DEFAULT_STATE, windowCenter: currentFrame?.windowCenter ?? 40, windowWidth: currentFrame?.windowWidth ?? 400 })} title="Reset (R)">
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
                                <h3>⏳ Loading Files...</h3>
                                <p>Waiting for scanner...</p>
                            </>
                        )}
                    </div>
                )}
            </div>

            <div className="dicom-viewer__status">
                <span>Frame: {viewState.frameIndex + 1}/{instances.length}</span>
                <span>WC/WW: {Math.round(viewState.windowCenter)}/{Math.round(viewState.windowWidth)}</span>
                <span>Zoom: {Math.round(viewState.zoom * 100)}%</span>
                {viewState.isPlaying && <span className="dicom-viewer__cine">▶ CINE</span>}
            </div>
        </div>
    );
}



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
