/**
 * WL Presets tests
 */

import { describe, it, expect } from 'vitest';
import {
    WL_PRESETS,
    PRESET_LIST,
    getDefaultPresetForModality,
    getPresetById,
    getAllPresets,
    formatWl,
    findMatchingPreset,
} from '../core/wlPresets';

describe('wlPresets', () => {
    describe('WL_PRESETS', () => {
        it('contains all expected presets', () => {
            expect(WL_PRESETS.soft_tissue).toBeDefined();
            expect(WL_PRESETS.lung).toBeDefined();
            expect(WL_PRESETS.bone).toBeDefined();
            expect(WL_PRESETS.brain).toBeDefined();
            expect(WL_PRESETS.abdomen).toBeDefined();
        });

        it('each preset has required fields', () => {
            for (const preset of Object.values(WL_PRESETS)) {
                expect(preset.id).toBeDefined();
                expect(preset.name).toBeDefined();
                expect(preset.label).toBeDefined();
                expect(typeof preset.wc).toBe('number');
                expect(typeof preset.ww).toBe('number');
            }
        });

        it('each preset has reasonable WC/WW values', () => {
            for (const preset of Object.values(WL_PRESETS)) {
                expect(preset.ww).toBeGreaterThan(0);
            }
        });
    });

    describe('getDefaultPresetForModality', () => {
        it('returns soft_tissue for CT', () => {
            expect(getDefaultPresetForModality('CT')).toBe('soft_tissue');
        });

        it('returns brain for MR', () => {
            expect(getDefaultPresetForModality('MR')).toBe('brain');
            expect(getDefaultPresetForModality('MRI')).toBe('brain');
        });

        it('returns null for CR/DX (use DICOM default)', () => {
            expect(getDefaultPresetForModality('CR')).toBeNull();
            expect(getDefaultPresetForModality('DX')).toBeNull();
            expect(getDefaultPresetForModality('DR')).toBeNull();
        });

        it('returns null for US (preserve original)', () => {
            expect(getDefaultPresetForModality('US')).toBeNull();
        });

        it('returns null for PT/NM (nuclear)', () => {
            expect(getDefaultPresetForModality('PT')).toBeNull();
            expect(getDefaultPresetForModality('NM')).toBeNull();
        });

        it('returns null for unknown modality', () => {
            expect(getDefaultPresetForModality('UNKNOWN')).toBeNull();
            expect(getDefaultPresetForModality('')).toBeNull();
        });

        it('is case insensitive', () => {
            expect(getDefaultPresetForModality('ct')).toBe('soft_tissue');
            expect(getDefaultPresetForModality('Ct')).toBe('soft_tissue');
        });
    });

    describe('getPresetById', () => {
        it('returns preset by ID', () => {
            const preset = getPresetById('soft_tissue');
            expect(preset).not.toBeNull();
            expect(preset!.name).toBe('Soft Tissue');
        });

        it('returns dicom_default for that ID', () => {
            const preset = getPresetById('dicom_default');
            expect(preset).not.toBeNull();
            expect(preset!.isDicomDefault).toBe(true);
        });

        it('returns null for unknown ID', () => {
            expect(getPresetById('unknown')).toBeNull();
        });
    });

    describe('getAllPresets', () => {
        it('returns array of all presets', () => {
            const presets = getAllPresets();
            expect(Array.isArray(presets)).toBe(true);
            expect(presets.length).toBe(5);
        });

        it('returns same presets as PRESET_LIST', () => {
            const presets = getAllPresets();
            expect(presets.length).toBe(PRESET_LIST.length);
        });
    });

    describe('formatWl', () => {
        it('formats WC/WW correctly', () => {
            expect(formatWl(40, 400)).toBe('WC: 40 / WW: 400');
            expect(formatWl(-600, 1500)).toBe('WC: -600 / WW: 1500');
        });

        it('rounds decimal values', () => {
            expect(formatWl(40.7, 400.3)).toBe('WC: 41 / WW: 400');
        });
    });

    describe('findMatchingPreset', () => {
        it('finds exact match', () => {
            const preset = findMatchingPreset(40, 400);
            expect(preset).not.toBeNull();
            expect(preset!.id).toBe('soft_tissue');
        });

        it('finds match within tolerance', () => {
            const preset = findMatchingPreset(40.5, 400.5, 1);
            expect(preset).not.toBeNull();
            expect(preset!.id).toBe('soft_tissue');
        });

        it('returns null for no match', () => {
            expect(findMatchingPreset(123, 456)).toBeNull();
        });

        it('finds lung preset', () => {
            const preset = findMatchingPreset(-600, 1500);
            expect(preset).not.toBeNull();
            expect(preset!.id).toBe('lung');
        });
    });
});
