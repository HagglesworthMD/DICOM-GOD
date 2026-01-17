/**
 * MultiViewport - Container for 1/2/4 viewport layouts
 */

import { useCallback, useRef, useEffect } from 'react';
import { useAppState, useAppDispatch } from '../state/store';
import { getFlag } from '../core/featureFlags';
import { DicomViewer, type DicomViewerHandle } from './Viewport';
import { getVisibleSlots, computeSmartHanging, type ViewportLayout, type ViewportSlotId } from '../core/viewportModel';
import { mapKeyToAction } from '../core/shortcuts';
import './MultiViewport.css';

export function MultiViewport() {
    const viewerEnabled = getFlag('viewerEnabled');
    const { layoutState, fileRegistry, studies } = useAppState();
    const dispatch = useAppDispatch();

    const { layout, slots, hangingApplied, undoState, activeSlotId, hoveredSlotId } = layoutState;
    const visibleSlots = getVisibleSlots(layout);

    // Refs to DicomViewer instances for imperative action routing
    const viewerRefs = useRef<Record<ViewportSlotId, DicomViewerHandle | null>>({
        0: null, 1: null, 2: null, 3: null
    });

    // Handle layout change
    const handleSetLayout = useCallback((newLayout: ViewportLayout) => {
        dispatch({ type: 'SET_LAYOUT', layout: newLayout });
    }, [dispatch]);

    // Handle slot click (set active)
    const handleSlotClick = useCallback((slotId: ViewportSlotId) => {
        dispatch({ type: 'SET_ACTIVE_SLOT', slotId });
    }, [dispatch]);

    // Handle slot hover
    const handleSlotMouseEnter = useCallback((slotId: ViewportSlotId) => {
        dispatch({ type: 'SET_HOVERED_SLOT', slotId });
    }, [dispatch]);

    const handleSlotMouseLeave = useCallback(() => {
        dispatch({ type: 'SET_HOVERED_SLOT', slotId: null });
    }, [dispatch]);

    // Smart hanging
    const handleSmartHang = useCallback(() => {
        // Gather all series from all studies
        const allSeries = studies.flatMap(study => study.series);
        if (allSeries.length === 0) return;

        const result = computeSmartHanging(allSeries, layout);
        if (result.assignments.length > 0) {
            dispatch({ type: 'APPLY_HANGING', assignments: result.assignments });
            dispatch({ type: 'SET_STATUS', message: result.reason });
        }
    }, [studies, layout, dispatch]);

    // Undo hanging
    const handleUndoHanging = useCallback(() => {
        dispatch({ type: 'UNDO_HANGING' });
        dispatch({ type: 'SET_STATUS', message: 'Reverted auto-fill' });
    }, [dispatch]);

    // Dismiss banner
    const handleDismissBanner = useCallback(() => {
        dispatch({ type: 'CLEAR_HANGING_BANNER' });
    }, [dispatch]);

    // Global keyboard handler for slot focus and action routing
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if target is input/textarea/contenteditable
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
                return;
            }

            // Slot focus keys: 1/2/3/4 (no modifiers)
            if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
                const slotNum = parseInt(e.key, 10);
                if (slotNum >= 1 && slotNum <= 4) {
                    const targetSlotId = (slotNum - 1) as ViewportSlotId;
                    // Only focus if slot is visible in current layout
                    if (visibleSlots.includes(targetSlotId)) {
                        e.preventDefault();
                        dispatch({ type: 'SET_ACTIVE_SLOT', slotId: targetSlotId });
                        return;
                    }
                }
            }

            // Tab / Shift+Tab: cycle through visible slots
            if (e.key === 'Tab') {
                e.preventDefault();
                const currentIndex = visibleSlots.indexOf(activeSlotId);
                let nextIndex: number;
                if (e.shiftKey) {
                    // Shift+Tab: go backwards, wrap around
                    nextIndex = (currentIndex - 1 + visibleSlots.length) % visibleSlots.length;
                } else {
                    // Tab: go forwards, wrap around
                    nextIndex = (currentIndex + 1) % visibleSlots.length;
                }
                dispatch({ type: 'SET_ACTIVE_SLOT', slotId: visibleSlots[nextIndex] });
                return;
            }

            // Route other shortcuts to active viewport
            const action = mapKeyToAction(e);
            if (action) {
                e.preventDefault();

                // Handle global actions first
                if (action === 'TOGGLE_HELP') {
                    dispatch({ type: 'SET_SHORTCUTS_VISIBLE', visible: true });
                    return;
                }
                if (action === 'CLOSE_DIALOG') {
                    dispatch({ type: 'SET_SHORTCUTS_VISIBLE', visible: false });
                    // Also route to viewport for clearing selection
                }

                // Route viewport-specific actions
                const activeViewer = viewerRefs.current[activeSlotId];
                if (activeViewer) {
                    activeViewer.applyAction(action);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [visibleSlots, activeSlotId, dispatch]);

    if (!viewerEnabled) {
        return (
            <main className="multi-viewport multi-viewport--disabled">
                <div className="multi-viewport__placeholder">
                    <span className="multi-viewport__placeholder-icon">🔒</span>
                    <h2>Viewer Disabled</h2>
                    <p>The viewer is currently disabled via feature flags</p>
                </div>
            </main>
        );
    }

    const gridClass = `multi-viewport__grid multi-viewport__grid--${layout}`;

    return (
        <main className="multi-viewport">
            {/* Layout Toolbar */}
            <div className="multi-viewport__toolbar">
                <div className="multi-viewport__layout-selector">
                    <button
                        className={layout === 1 ? 'active' : ''}
                        onClick={() => handleSetLayout(1)}
                        title="Single viewport"
                    >
                        ▢
                    </button>
                    <button
                        className={layout === 2 ? 'active' : ''}
                        onClick={() => handleSetLayout(2)}
                        title="2 viewports (side by side)"
                    >
                        ▢▢
                    </button>
                    <button
                        className={layout === 4 ? 'active' : ''}
                        onClick={() => handleSetLayout(4)}
                        title="4 viewports (2x2 grid)"
                    >
                        ◫
                    </button>
                </div>

                <button
                    className="multi-viewport__auto-hang-btn"
                    onClick={handleSmartHang}
                    title="Auto-fill viewports with best series from loaded study"
                    disabled={studies.length === 0}
                >
                    🪄 Auto-Fill
                </button>
            </div>

            {/* Hanging Banner */}
            {hangingApplied && (
                <div className="multi-viewport__hanging-banner">
                    <span>⚡ Auto-filled by heuristics</span>
                    {undoState && (
                        <button onClick={handleUndoHanging}>Undo</button>
                    )}
                    <button onClick={handleDismissBanner} className="dismiss">✕</button>
                </div>
            )}

            {/* Viewport Grid */}
            <div className={gridClass}>
                {visibleSlots.map(slotId => {
                    const slot = slots[slotId];
                    const isActive = slot.isActive;
                    const isHovered = hoveredSlotId === slotId && !isActive;

                    return (
                        <div
                            key={slotId}
                            className={`multi-viewport__slot ${isActive ? 'multi-viewport__slot--active' : ''} ${isHovered ? 'multi-viewport__slot--hovered' : ''}`}
                            onClick={() => handleSlotClick(slotId)}
                            onPointerDown={() => handleSlotClick(slotId)}
                            onMouseEnter={() => handleSlotMouseEnter(slotId)}
                            onMouseLeave={handleSlotMouseLeave}
                        >
                            {slot.series ? (
                                <DicomViewer
                                    key={`slot-${slotId}`}
                                    ref={(handle) => { viewerRefs.current[slotId] = handle; }}
                                    series={slot.series}
                                    fileRegistry={fileRegistry}
                                />
                            ) : (
                                <div className="multi-viewport__empty-slot">
                                    <span className="multi-viewport__empty-icon">🖼️</span>
                                    <p>Viewport {slotId + 1}</p>
                                    <p className="multi-viewport__empty-hint">
                                        {isActive ? 'Select a series from the browser' : 'Click to activate'}
                                    </p>
                                </div>
                            )}
                            {/* Hover overlay for Alt+click assignment */}
                            {isHovered && visibleSlots.length > 1 && (
                                <div className="multi-viewport__hover-overlay">
                                    <span>Alt+click to assign here</span>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </main>
    );
}
