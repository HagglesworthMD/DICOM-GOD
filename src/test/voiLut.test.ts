/**
 * Tests for VOI LUT helpers
 */

import { describe, it, expect } from 'vitest';
import {
    applyWindow,
    parseWindowMultiValue,
    parseWindowValue,
    selectWindowValue,
    toModalityValue
} from '../core/voiLut';

describe('voiLut helpers', () => {
    it('parses multi-valued window strings', () => {
        expect(parseWindowValue('100\\200')).toBe(100);
        expect(parseWindowMultiValue('100\\200')).toEqual([100, 200]);
    });

    it('selects per-frame window values when available', () => {
        const values = [10, 20, 30];
        expect(selectWindowValue(values, 1, 3)).toBe(20);
        expect(selectWindowValue(values, 5, 10)).toBe(10);
    });

    it('handles signed vs unsigned stored values', () => {
        const unsigned = toModalityValue(0x0fff, {
            slope: 1,
            intercept: 0,
            bitsStored: 12,
            pixelRepresentation: 0,
        });
        const signed = toModalityValue(0x0fff, {
            slope: 1,
            intercept: 0,
            bitsStored: 12,
            pixelRepresentation: 1,
        });

        expect(unsigned).toBe(4095);
        expect(signed).toBe(-1);
    });

    it('applies rescale slope and intercept', () => {
        const value = toModalityValue(1000, {
            slope: 2,
            intercept: -1024,
            bitsStored: 16,
            pixelRepresentation: 0,
        });

        expect(value).toBe(976);
    });

    it('clamps windowed values to display range', () => {
        expect(applyWindow(-200, 40, 400)).toBe(0);
        expect(applyWindow(300, 40, 400)).toBe(255);
    });
});
