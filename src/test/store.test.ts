
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reducer, type AppState } from '../state/store';

describe('Store Reducer - Preferences', () => {
    let initialState: AppState;

    beforeEach(() => {
        initialState = {
            preferences: { pauseCineOnMeasure: false, seriesPrefs: {} },
            files: [],
            localModeEnabled: false,
            localModeWarnings: [],
            errors: [],
            shortcutsHelpVisible: false,
            statusMessage: '',
            studies: [],
            indexProgress: null,
            selectedSeries: null,
            hasStoredFolder: false,
            storedFolderName: null,
            fileRegistry: new Map(),
        };

        // Mock localStorage
        vi.stubGlobal('localStorage', {
            getItem: vi.fn(),
            setItem: vi.fn(),
        });
    });

    it('updates preferences state on SET_PREFERENCE', () => {
        const action = { type: 'SET_PREFERENCE', key: 'pauseCineOnMeasure', value: true } as const;
        const newState = reducer(initialState, action);

        expect(newState.preferences.pauseCineOnMeasure).toBe(true);
    });

    it('persists preferences to localStorage', () => {
        const action = { type: 'SET_PREFERENCE', key: 'pauseCineOnMeasure', value: true } as const;
        reducer(initialState, action);

        expect(localStorage.setItem).toHaveBeenCalledWith(
            'dicom_god_prefs',
            JSON.stringify({ pauseCineOnMeasure: true, seriesPrefs: {} })
        );
    });

    it('updates and persists series preferences', () => {
        const action = {
            type: 'UPDATE_SERIES_PREF',
            seriesKey: '1.2.3',
            prefKey: 'stackReverse',
            value: true
        } as const;

        const newState = reducer(initialState, action);
        expect(newState.preferences.seriesPrefs['1.2.3'].stackReverse).toBe(true);

        expect(localStorage.setItem).toHaveBeenCalledWith(
            'dicom_god_prefs',
            expect.stringContaining('"1.2.3":{"stackReverse":true}')
        );
    });
});
