/**
 * MultiViewport - Container for 1/2/4 viewport layouts
 */

import { useCallback } from 'react';
import { useAppState, useAppDispatch } from '../state/store';
import { getFlag } from '../core/featureFlags';
import { DicomViewer } from './Viewport';
import { getVisibleSlots, computeSmartHanging, type ViewportLayout, type ViewportSlotId } from '../core/viewportModel';
import './MultiViewport.css';

export function MultiViewport() {
    const viewerEnabled = getFlag('viewerEnabled');
    const { layoutState, fileRegistry, studies } = useAppState();
    const dispatch = useAppDispatch();

    const { layout, slots, hangingApplied, undoState } = layoutState;
    const visibleSlots = getVisibleSlots(layout);

    // Handle layout change
    const handleSetLayout = useCallback((newLayout: ViewportLayout) => {
        dispatch({ type: 'SET_LAYOUT', layout: newLayout });
    }, [dispatch]);

    // Handle slot click (set active)
    const handleSlotClick = useCallback((slotId: ViewportSlotId) => {
        dispatch({ type: 'SET_ACTIVE_SLOT', slotId });
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

                    return (
                        <div
                            key={slotId}
                            className={`multi-viewport__slot ${isActive ? 'multi-viewport__slot--active' : ''}`}
                            onClick={() => handleSlotClick(slotId)}
                        >
                            {slot.series ? (
                                <DicomViewer
                                    key={`slot-${slotId}`}
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
                        </div>
                    );
                })}
            </div>
        </main>
    );
}
