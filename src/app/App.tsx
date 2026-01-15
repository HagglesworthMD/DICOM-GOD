/**
 * Main App component
 */

import { useCallback, useEffect, useRef } from 'react';
import { StateProvider, useAppState, useAppDispatch } from '../state/store';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { DropZone } from '../components/DropZone';
import { FolderPicker } from '../components/FolderPicker';
import { StudyBrowser } from '../components/StudyBrowser';
import { Viewport } from '../components/Viewport';
import { StatusBar } from '../components/StatusBar';
import { LocalModeBanner } from '../components/LocalModeBanner';
import { ShortcutsHelp } from '../components/ShortcutsHelp';
import { ToastContainer } from '../ui/Toast';
import { Toggle } from '../ui/Toggle';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { enableLocalOnlyMode, disableLocalOnlyMode, isLocalOnlyMode } from '../core/localOnly';
import { createWorkerBridge, isWorkerSupported, type IndexingJob } from '../core/ipc';
import { createLogger } from '../core/logger';
import type { FileEntry, AppError, FileRegistry } from '../core/types';
import '../styles/app.css';

const log = createLogger('App');

function AppContent() {
    const state = useAppState();
    const dispatch = useAppDispatch();
    const workerBridge = useRef(isWorkerSupported() ? createWorkerBridge() : null);
    const currentJob = useRef<IndexingJob | null>(null);

    // Cleanup worker on unmount
    useEffect(() => {
        return () => {
            workerBridge.current?.terminate();
        };
    }, []);

    const startIndexing = useCallback((files: FileEntry[]) => {
        if (!workerBridge.current) {
            log.error('Worker not supported');
            dispatch({
                type: 'ADD_ERROR',
                error: {
                    id: Date.now().toString(),
                    message: 'Web Workers not supported in this browser',
                    timestamp: Date.now(),
                }
            });
            return;
        }

        // Cancel any existing job
        if (currentJob.current) {
            currentJob.current.cancel();
        }

        // Clear existing studies
        dispatch({ type: 'CLEAR_STUDIES' });

        // Start new indexing job
        currentJob.current = workerBridge.current.startIndexing(files, {
            onProgress: (progress) => {
                dispatch({ type: 'SET_INDEX_PROGRESS', progress });
            },
            onStudyUpdate: (study) => {
                dispatch({ type: 'UPDATE_STUDY', study });
            },
            onComplete: (studies, progress) => {
                dispatch({ type: 'SET_STUDIES', studies });
                dispatch({ type: 'SET_INDEX_PROGRESS', progress });
                dispatch({
                    type: 'SET_STATUS',
                    message: `Indexed ${progress.dicomFiles} DICOM files in ${studies.length} studies`
                });
                currentJob.current = null;
            },
            onError: (error) => {
                dispatch({
                    type: 'SET_INDEX_PROGRESS',
                    progress: {
                        phase: 'error',
                        totalFiles: 0,
                        processedFiles: 0,
                        dicomFiles: 0,
                        skippedFiles: 0,
                        errorFiles: 0,
                        errorMessage: error,
                    }
                });
                dispatch({
                    type: 'ADD_ERROR',
                    error: {
                        id: Date.now().toString(),
                        message: `Indexing error: ${error}`,
                        timestamp: Date.now(),
                    }
                });
                currentJob.current = null;
            },
            onCancelled: () => {
                dispatch({
                    type: 'SET_INDEX_PROGRESS',
                    progress: {
                        phase: 'cancelled',
                        totalFiles: 0,
                        processedFiles: 0,
                        dicomFiles: 0,
                        skippedFiles: 0,
                        errorFiles: 0,
                    }
                });
                currentJob.current = null;
            },
        });
    }, [dispatch]);

    const handleFilesSelected = useCallback(
        (files: FileEntry[]) => {
            log.info(`Received ${files.length} files`);
            dispatch({ type: 'SET_FILES', files });

            // Build registry map
            const registry: FileRegistry = new Map();
            for (const f of files) {
                if (f.fileKey) {
                    if (f.handle) {
                        registry.set(f.fileKey, {
                            kind: 'handle',
                            handle: f.handle,
                            name: f.name,
                            size: f.size
                        });
                    } else {
                        registry.set(f.fileKey, {
                            kind: 'file',
                            file: f.file,
                            name: f.name,
                            size: f.size
                        });
                    }
                }
            }
            dispatch({ type: 'SET_FILE_REGISTRY', registry });

            dispatch({
                type: 'SET_STATUS',
                message: `Scanning ${files.length} file${files.length === 1 ? '' : 's'}...`,
            });

            // Start indexing in worker
            startIndexing(files);
        },
        [dispatch, startIndexing]
    );

    const handleLocalModeToggle = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const enabled = e.target.checked;
            if (enabled) {
                const warnings = enableLocalOnlyMode();
                dispatch({ type: 'SET_LOCAL_MODE', enabled: true, warnings });
                dispatch({ type: 'SET_STATUS', message: 'Local-only mode enabled' });
            } else {
                disableLocalOnlyMode();
                dispatch({ type: 'SET_LOCAL_MODE', enabled: false, warnings: [] });
                dispatch({ type: 'SET_STATUS', message: 'Local-only mode disabled' });
            }
        },
        [dispatch]
    );

    const handleError = useCallback(
        (error: Error) => {
            const appError: AppError = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                message: error.message,
                stack: error.stack,
                timestamp: Date.now(),
            };
            dispatch({ type: 'ADD_ERROR', error: appError });
        },
        [dispatch]
    );

    const handleDismissError = useCallback(
        (id: string) => {
            dispatch({ type: 'DISMISS_ERROR', id });
        },
        [dispatch]
    );

    const handleShowShortcuts = useCallback(() => {
        dispatch({ type: 'SET_SHORTCUTS_VISIBLE', visible: true });
    }, [dispatch]);

    return (
        <ErrorBoundary onError={handleError}>
            <div className="app">
                <LocalModeBanner />

                <header className="app__header">
                    <h1 className="app__title">
                        <span className="app__title-icon">🏥</span>
                        DICOM God
                    </h1>

                    <div className="app__actions">
                        <FolderPicker onFilesSelected={handleFilesSelected} />

                        <Toggle
                            label="Local Mode"
                            checked={isLocalOnlyMode()}
                            onChange={handleLocalModeToggle}
                        />

                        <Button variant="ghost" size="sm" onClick={handleShowShortcuts} title="Keyboard shortcuts (?)">
                            <Icon name="keyboard" size={18} />
                        </Button>
                    </div>
                </header>

                <DropZone onFiles={handleFilesSelected} className="app__main">
                    <StudyBrowser />
                    <Viewport />
                </DropZone>

                <StatusBar />

                <ToastContainer
                    toasts={state.errors.map((e) => ({
                        id: e.id,
                        message: e.message,
                        stack: e.stack,
                        type: 'error' as const,
                    }))}
                    onDismiss={handleDismissError}
                />

                <ShortcutsHelp />
            </div>
        </ErrorBoundary>
    );
}

export function App() {
    return (
        <StateProvider>
            <AppContent />
        </StateProvider>
    );
}
