/**
 * App state store using React Context + Reducer
 * No external dependencies (no Redux/Zustand)
 */

import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from 'react';
import type { FileEntry, AppError, Study, Series, IndexProgress, FileRegistry } from '../core/types';
import {
    type LayoutState,
    type ViewportLayout,
    type ViewportSlotId,
    createInitialLayoutState,
    getVisibleSlots,
} from '../core/viewportModel';

// Preferences shape
export interface SeriesPreference {
    stackReverse: boolean;
}

export interface UserPreferences {
    pauseCineOnMeasure: boolean;
    seriesPrefs: Record<string, Partial<SeriesPreference>>; // Use Partial to be safe with future additions
}

const DEFAULT_PREFS: UserPreferences = {
    pauseCineOnMeasure: false,
    seriesPrefs: {},
};

// Safe localStorage init
function getInitialPrefs(): UserPreferences {
    try {
        const stored = localStorage.getItem('dicom_god_prefs');
        if (stored) {
            // Deep merge might be needed if structure gets complex, but shallow spread works for now
            // excluding nested seriesPrefs merge for simplicity unless needed
            const parsed = JSON.parse(stored);
            return {
                ...DEFAULT_PREFS,
                ...parsed,
                seriesPrefs: { ...DEFAULT_PREFS.seriesPrefs, ...(parsed.seriesPrefs || {}) }
            };
        }
    } catch (e) {
        console.warn('Failed to load prefs', e);
    }
    return DEFAULT_PREFS;
}


// State shape
export interface AppState {
    /** Selected/dropped files (not yet parsed) */
    files: FileEntry[];
    /** Local-only mode status */
    localModeEnabled: boolean;
    /** Warnings from local mode patch */
    localModeWarnings: string[];
    /** Current errors */
    errors: AppError[];
    /** Whether shortcuts help is visible */
    shortcutsHelpVisible: boolean;
    /** Status bar message */
    statusMessage: string;

    // Step 2: DICOM data
    /** Loaded studies */
    studies: Study[];
    /** Indexing progress */
    indexProgress: IndexProgress | null;
    /** Currently selected series */
    selectedSeries: Series | null;
    /** Whether a folder handle is stored */
    hasStoredFolder: boolean;
    /** Name of the stored folder */
    storedFolderName: string | null;
    /** File registry: fileKey -> File/handle */
    fileRegistry: FileRegistry;

    /** User preferences */
    preferences: UserPreferences;

    /** Multi-viewport layout state */
    layoutState: LayoutState;
}

// Local mode default: ON
function getInitialLocalMode(): boolean {
    if (typeof window === 'undefined') return true;
    try {
        const stored = localStorage.getItem('dicom_god_local_mode');
        if (stored !== null) return stored === 'true';
        return true; // Default to ON
    } catch {
        return true;
    }
}

const initialState: AppState = {
    files: [],
    localModeEnabled: getInitialLocalMode(),
    localModeWarnings: [],
    errors: [],
    shortcutsHelpVisible: false,
    statusMessage: 'Ready',

    // Step 2
    studies: [],
    indexProgress: null,
    selectedSeries: null,
    hasStoredFolder: false,
    storedFolderName: null,
    // Step 3: File registry
    fileRegistry: new Map(),

    preferences: getInitialPrefs(),

    // Multi-viewport layout
    layoutState: createInitialLayoutState(),
};

// Actions
export type AppAction =
    | { type: 'SET_FILES'; files: FileEntry[] }
    | { type: 'ADD_FILES'; files: FileEntry[] }
    | { type: 'CLEAR_FILES' }
    | { type: 'SET_LOCAL_MODE'; enabled: boolean; warnings?: string[] }
    | { type: 'ADD_ERROR'; error: AppError }
    | { type: 'DISMISS_ERROR'; id: string }
    | { type: 'CLEAR_ERRORS' }
    | { type: 'SET_SHORTCUTS_VISIBLE'; visible: boolean }
    | { type: 'SET_STATUS'; message: string }
    // Step 2: DICOM actions
    | { type: 'SET_STUDIES'; studies: Study[] }
    | { type: 'UPDATE_STUDY'; study: Study }
    | { type: 'CLEAR_STUDIES' }
    | { type: 'SET_INDEX_PROGRESS'; progress: IndexProgress | null }
    | { type: 'SELECT_SERIES'; series: Series | null }
    | { type: 'SET_STORED_FOLDER'; hasFolder: boolean; name: string | null }
    // Step 3: File registry
    | { type: 'SET_FILE_REGISTRY'; registry: FileRegistry }
    | { type: 'CLEAR_FILE_REGISTRY' }
    // Preferences
    | { type: 'SET_PREFERENCE'; key: keyof UserPreferences; value: any }
    | { type: 'UPDATE_SERIES_PREF'; seriesKey: string; prefKey: keyof SeriesPreference; value: boolean }
    // Multi-viewport layout
    | { type: 'SET_LAYOUT'; layout: ViewportLayout }
    | { type: 'SET_ACTIVE_SLOT'; slotId: ViewportSlotId }
    | { type: 'ASSIGN_SERIES_TO_SLOT'; slotId: ViewportSlotId; series: Series | null }
    | { type: 'APPLY_HANGING'; assignments: Array<{ slotId: ViewportSlotId; series: Series }> }
    | { type: 'UNDO_HANGING' }
    | { type: 'CLEAR_HANGING_BANNER' };

// Reducer
export function reducer(state: AppState, action: AppAction): AppState {
    switch (action.type) {
        case 'SET_FILES':
            return { ...state, files: action.files };
        case 'ADD_FILES':
            return { ...state, files: [...state.files, ...action.files] };
        case 'CLEAR_FILES':
            return { ...state, files: [] };
        case 'SET_LOCAL_MODE':
            try {
                localStorage.setItem('dicom_god_local_mode', String(action.enabled));
            } catch (e) {
                console.error('Failed to persist local mode', e);
            }
            return {
                ...state,
                localModeEnabled: action.enabled,
                localModeWarnings: action.warnings ?? [],
            };
        case 'ADD_ERROR':
            return { ...state, errors: [...state.errors, action.error] };
        case 'DISMISS_ERROR':
            return { ...state, errors: state.errors.filter((e) => e.id !== action.id) };
        case 'CLEAR_ERRORS':
            return { ...state, errors: [] };
        case 'SET_SHORTCUTS_VISIBLE':
            return { ...state, shortcutsHelpVisible: action.visible };
        case 'SET_STATUS':
            return { ...state, statusMessage: action.message };

        // Step 2: DICOM reducers
        case 'SET_STUDIES':
            return { ...state, studies: action.studies };
        case 'UPDATE_STUDY': {
            const idx = state.studies.findIndex(s => s.studyInstanceUid === action.study.studyInstanceUid);
            if (idx >= 0) {
                const newStudies = [...state.studies];
                newStudies[idx] = action.study;
                return { ...state, studies: newStudies };
            }
            return { ...state, studies: [...state.studies, action.study] };
        }
        case 'CLEAR_STUDIES':
            return { ...state, studies: [], selectedSeries: null };
        case 'SET_INDEX_PROGRESS':
            return { ...state, indexProgress: action.progress };
        case 'SELECT_SERIES':
            return { ...state, selectedSeries: action.series };
        case 'SET_STORED_FOLDER':
            return {
                ...state,
                hasStoredFolder: action.hasFolder,
                storedFolderName: action.name
            };

        // Step 3: File registry
        case 'SET_FILE_REGISTRY':
            return { ...state, fileRegistry: action.registry };
        case 'CLEAR_FILE_REGISTRY':
            return { ...state, fileRegistry: new Map() };

        // Preferences
        case 'SET_PREFERENCE': {
            const newPrefs = { ...state.preferences, [action.key]: action.value };
            try {
                localStorage.setItem('dicom_god_prefs', JSON.stringify(newPrefs));
            } catch (e) {
                console.error('Failed to save prefs', e);
            }
            return { ...state, preferences: newPrefs };
        }

        case 'UPDATE_SERIES_PREF': {
            const currentSeriesPrefs = state.preferences.seriesPrefs?.[action.seriesKey] || {};
            const updatedSeriesPrefs = {
                ...state.preferences.seriesPrefs,
                [action.seriesKey]: {
                    ...currentSeriesPrefs,
                    [action.prefKey]: action.value
                }
            };
            const newPrefs = { ...state.preferences, seriesPrefs: updatedSeriesPrefs };

            try {
                localStorage.setItem('dicom_god_prefs', JSON.stringify(newPrefs));
            } catch (e) {
                console.error('Failed to save prefs', e);
            }
            return { ...state, preferences: newPrefs };
        }

        // Multi-viewport layout reducers
        case 'SET_LAYOUT': {
            const newSlots = state.layoutState.slots.map(slot => ({
                ...slot,
                // Keep series if slot is still visible in new layout
                series: getVisibleSlots(action.layout).includes(slot.id) ? slot.series : null,
            }));
            return {
                ...state,
                layoutState: {
                    ...state.layoutState,
                    layout: action.layout,
                    slots: newSlots,
                    hangingApplied: false,
                    undoState: null,
                },
            };
        }

        case 'SET_ACTIVE_SLOT': {
            const newSlots = state.layoutState.slots.map(slot => ({
                ...slot,
                isActive: slot.id === action.slotId,
            }));
            return {
                ...state,
                layoutState: {
                    ...state.layoutState,
                    slots: newSlots,
                    activeSlotId: action.slotId,
                },
            };
        }

        case 'ASSIGN_SERIES_TO_SLOT': {
            const newSlots = state.layoutState.slots.map(slot =>
                slot.id === action.slotId ? { ...slot, series: action.series } : slot
            );
            return {
                ...state,
                layoutState: {
                    ...state.layoutState,
                    slots: newSlots,
                    hangingApplied: false,
                },
                // Also update legacy selectedSeries for compatibility
                selectedSeries: action.series,
            };
        }

        case 'APPLY_HANGING': {
            // Save current state for undo
            const undoState = state.layoutState.slots.map(s => ({ ...s }));

            // Apply assignments
            const newSlots = state.layoutState.slots.map(slot => {
                const assignment = action.assignments.find(a => a.slotId === slot.id);
                return assignment ? { ...slot, series: assignment.series } : slot;
            });

            return {
                ...state,
                layoutState: {
                    ...state.layoutState,
                    slots: newSlots,
                    hangingApplied: true,
                    undoState,
                },
                // Update selectedSeries to first assigned series
                selectedSeries: action.assignments[0]?.series ?? state.selectedSeries,
            };
        }

        case 'UNDO_HANGING': {
            if (!state.layoutState.undoState) return state;
            return {
                ...state,
                layoutState: {
                    ...state.layoutState,
                    slots: state.layoutState.undoState,
                    hangingApplied: false,
                    undoState: null,
                },
            };
        }

        case 'CLEAR_HANGING_BANNER': {
            return {
                ...state,
                layoutState: {
                    ...state.layoutState,
                    hangingApplied: false,
                },
            };
        }

        default:
            return state;
    }
}

// Context
const StateContext = createContext<AppState | null>(null);
const DispatchContext = createContext<Dispatch<AppAction> | null>(null);

export function StateProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(reducer, initialState);

    return (
        <StateContext.Provider value={state}>
            <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
        </StateContext.Provider>
    );
}

export function useAppState(): AppState {
    const ctx = useContext(StateContext);
    if (!ctx) throw new Error('useAppState must be used within StateProvider');
    return ctx;
}

export function useAppDispatch(): Dispatch<AppAction> {
    const ctx = useContext(DispatchContext);
    if (!ctx) throw new Error('useAppDispatch must be used within StateProvider');
    return ctx;
}
