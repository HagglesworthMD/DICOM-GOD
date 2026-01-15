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
import { getTrustBadge, getTrustDescription, verifySeriesGeometry } from '../core/geometryTrust';
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
};

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
    const dragRef = useRef<{ startX: number; startY: number; mode: 'pan' | 'wl' | null }>({ startX: 0, startY: 0, mode: null });
    const wheelAccumulator = useRef(0);


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

    // Load frame when index changes
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

        setLoading(true);
        setError(null);
        setIsUnsupported(false);

        decodeFrame(currentInstance, 0)
            .then(frame => {
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
                if (err instanceof DecodeError) {
                    setError(err.message);
                    setIsUnsupported(err.isUnsupported);
                } else {
                    setError(err.message || 'Decode failed');
                }
                setLoading(false);
            });
    }, [currentInstance, viewState.frameIndex]);

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

        if (loading) {
            renderLoading(canvas, 'Loading...');
            return;
        }

        if (error) {
            renderError(canvas, error, isUnsupported);
            return;
        }

        if (currentFrame) {
            renderFrame(canvas, currentFrame, viewState);
            drawOverlay(canvas, {
                frameIndex: viewState.frameIndex,
                totalFrames: instances.length,
                windowCenter: viewState.windowCenter,
                windowWidth: viewState.windowWidth,
                zoom: viewState.zoom,
                dimensions: { width: currentFrame.width, height: currentFrame.height },
            });
        }
    }, [currentFrame, viewState, loading, error, isUnsupported, instances.length]);

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
                cineIntervalRef.current = window.setInterval(() => {
                    setViewState(p => ({
                        ...p,
                        frameIndex: (p.frameIndex + 1) % instances.length,
                    }));
                }, 1000 / prev.cineFrameRate);
            } else if (cineIntervalRef.current) {
                clearInterval(cineIntervalRef.current);
                cineIntervalRef.current = null;
            }

            return { ...prev, isPlaying: newPlaying };
        });
    }, [instances.length]);

    // Cleanup cine on unmount
    useEffect(() => {
        return () => {
            if (cineIntervalRef.current) {
                clearInterval(cineIntervalRef.current);
            }
        };
    }, []);

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

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
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
    }, []);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!dragRef.current.mode) return;

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
    }, []);

    const handleMouseUp = useCallback(() => {
        dragRef.current.mode = null;
    }, []);

    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
    }, []);

    // Geometry trust
    const trustInfo = verifySeriesGeometry(series);

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
                    <button onClick={toggleCine} title="Toggle cine (Space)">
                        {viewState.isPlaying ? '⏸' : '▶'}
                    </button>
                    <button onClick={() => setViewState(prev => ({ ...prev, invert: !prev.invert }))} title="Invert (I)">
                        ◐
                    </button>
                    <button onClick={() => setViewState({ ...DEFAULT_STATE, windowCenter: currentFrame?.windowCenter ?? 40, windowWidth: currentFrame?.windowWidth ?? 400 })} title="Reset (R)">
                        ↺
                    </button>
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
            <DicomViewer series={selectedSeries} fileRegistry={fileRegistry} />
        </main>
    );
}
