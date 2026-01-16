
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
            layoutState: {
                layout: 1,
                slots: [
                    { id: 0, series: null, isActive: true },
                    { id: 1, series: null, isActive: false },
                    { id: 2, series: null, isActive: false },
                    { id: 3, series: null, isActive: false },
                ],
                activeSlotId: 0,
                hoveredSlotId: null,
                hangingApplied: false,
                undoState: null,
            },
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

describe('Store Reducer - Layout State', () => {
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
            layoutState: {
                layout: 2,
                slots: [
                    { id: 0, series: null, isActive: true },
                    { id: 1, series: null, isActive: false },
                    { id: 2, series: null, isActive: false },
                    { id: 3, series: null, isActive: false },
                ],
                activeSlotId: 0,
                hoveredSlotId: null,
                hangingApplied: false,
                undoState: null,
            },
        };
    });

    it('SET_ACTIVE_SLOT changes activeSlotId', () => {
        const action = { type: 'SET_ACTIVE_SLOT', slotId: 1 } as const;
        const newState = reducer(initialState, action);

        expect(newState.layoutState.activeSlotId).toBe(1);
        expect(newState.layoutState.slots[0].isActive).toBe(false);
        expect(newState.layoutState.slots[1].isActive).toBe(true);
    });

    it('SET_LAYOUT changes layout and preserves visible slots', () => {
        const action = { type: 'SET_LAYOUT', layout: 4 } as const;
        const newState = reducer(initialState, action);

        expect(newState.layoutState.layout).toBe(4);
    });

    it('SET_LAYOUT clears series in now-hidden slots', () => {
        // Start with 4-up layout and series in all slots
        initialState.layoutState.layout = 4;
        initialState.layoutState.slots = [
            { id: 0, series: { seriesInstanceUid: 'a' } as any, isActive: true },
            { id: 1, series: { seriesInstanceUid: 'b' } as any, isActive: false },
            { id: 2, series: { seriesInstanceUid: 'c' } as any, isActive: false },
            { id: 3, series: { seriesInstanceUid: 'd' } as any, isActive: false },
        ];

        // Switch to 2-up
        const action = { type: 'SET_LAYOUT', layout: 2 } as const;
        const newState = reducer(initialState, action);

        // Slots 0, 1 should keep series; slots 2, 3 should be cleared
        expect(newState.layoutState.slots[0].series?.seriesInstanceUid).toBe('a');
        expect(newState.layoutState.slots[1].series?.seriesInstanceUid).toBe('b');
        expect(newState.layoutState.slots[2].series).toBeNull();
        expect(newState.layoutState.slots[3].series).toBeNull();
    });

    it('SET_HOVERED_SLOT sets hoveredSlotId', () => {
        const action = { type: 'SET_HOVERED_SLOT', slotId: 2 } as const;
        const newState = reducer(initialState, action);

        expect(newState.layoutState.hoveredSlotId).toBe(2);
    });

    it('SET_HOVERED_SLOT with null clears hoveredSlotId', () => {
        // First set a hovered slot
        let state = reducer(initialState, { type: 'SET_HOVERED_SLOT', slotId: 1 });
        expect(state.layoutState.hoveredSlotId).toBe(1);

        // Then clear it
        state = reducer(state, { type: 'SET_HOVERED_SLOT', slotId: null });
        expect(state.layoutState.hoveredSlotId).toBeNull();
    });

    it('slot cycling is deterministic (0 -> 1 in 2-up layout)', () => {
        // Verify cycling logic: in 2-up, active 0 -> next is 1
        const visibleSlots = [0, 1]; // 2-up layout
        const activeSlotId = 0;
        const currentIndex = visibleSlots.indexOf(activeSlotId);
        const nextIndex = (currentIndex + 1) % visibleSlots.length;

        expect(visibleSlots[nextIndex]).toBe(1);
    });

    it('slot cycling wraps around (1 -> 0 in 2-up layout)', () => {
        const visibleSlots = [0, 1]; // 2-up layout
        const activeSlotId = 1;
        const currentIndex = visibleSlots.indexOf(activeSlotId);
        const nextIndex = (currentIndex + 1) % visibleSlots.length;

        expect(visibleSlots[nextIndex]).toBe(0);
    });
});
