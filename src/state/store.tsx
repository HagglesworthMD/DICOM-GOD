/**
 * App state store using React Context + Reducer
 * No external dependencies (no Redux/Zustand)
 */

import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from 'react';
import type { FileEntry, AppError, Study, Series, IndexProgress, FileRegistry } from '../core/types';

// Preferences shape
export interface UserPreferences {
    pauseCineOnMeasure: boolean;
}

const DEFAULT_PREFS: UserPreferences = {
    pauseCineOnMeasure: false,
};

// Safe localStorage init
function getInitialPrefs(): UserPreferences {
    try {
        const stored = localStorage.getItem('dicom_god_prefs');
        if (stored) {
            return { ...DEFAULT_PREFS, ...JSON.parse(stored) };
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
}

const initialState: AppState = {
    files: [],
    localModeEnabled: false,
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
    | { type: 'SET_PREFERENCE'; key: keyof UserPreferences; value: boolean };

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
