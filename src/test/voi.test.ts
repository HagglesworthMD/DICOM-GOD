/**
 * Tests for VOI windowing
 */

import { describe, it, expect } from 'vitest';
import { applyVOI, calculateDefaultWindow } from '../core/voi';

describe('VOI Windowing', () => {
    describe('applyVOI', () => {
        it('returns 0 for values below window', () => {
            // Window center=40, width=400 => range [-160, 240]
            expect(applyVOI(-200, 40, 400)).toBe(0);
            expect(applyVOI(-160, 40, 400)).toBe(0);
        });

        it('returns 255 for values above window', () => {
            // Window center=40, width=400 => range [-160, 240]
            expect(applyVOI(240, 40, 400)).toBe(255);
            expect(applyVOI(300, 40, 400)).toBe(255);
        });

        it('returns 128 for window center', () => {
            const result = applyVOI(40, 40, 400);
            expect(result).toBeCloseTo(128, 0);
        });

        it('maps linearly within window', () => {
            // Window: center=100, width=100 => range [50, 150]
            expect(applyVOI(50, 100, 100)).toBe(0);
            expect(applyVOI(100, 100, 100)).toBe(128);
            expect(applyVOI(150, 100, 100)).toBe(255);
            expect(applyVOI(75, 100, 100)).toBe(64); // 25% through
        });

        it('inverts when invert=true', () => {
            expect(applyVOI(50, 100, 100, true)).toBe(255);
            expect(applyVOI(150, 100, 100, true)).toBe(0);
            // Center value: 127.5; inverted: 255 - 127.5 = 127.5; rounded = 128
            expect(applyVOI(100, 100, 100, true)).toBe(128);
        });

        it('handles narrow window', () => {
            expect(applyVOI(99, 100, 2)).toBe(0);
            expect(applyVOI(100, 100, 2)).toBe(128);
            expect(applyVOI(101, 100, 2)).toBe(255);
        });

        it('handles negative values (CT Hounsfield)', () => {
            // CT window: center=-600, width=1500 => range [-1350, 150]
            expect(applyVOI(-1400, -600, 1500)).toBe(0);
            expect(applyVOI(-600, -600, 1500)).toBe(128);
            expect(applyVOI(200, -600, 1500)).toBe(255);
        });
    });

    describe('calculateDefaultWindow', () => {
        it('calculates center and width from min/max', () => {
            const result = calculateDefaultWindow(0, 255, 1, 0);
            expect(result.center).toBe(127.5);
            expect(result.width).toBe(255);
        });

        it('applies rescale slope and intercept', () => {
            // CT: slope=1, intercept=-1024
            const result = calculateDefaultWindow(0, 4095, 1, -1024);
            expect(result.center).toBe(-1024 + 2047.5);
            expect(result.width).toBe(4095);
        });

        it('ensures minimum width of 1', () => {
            const result = calculateDefaultWindow(100, 100, 1, 0);
            expect(result.width).toBe(1);
        });
    });
});
