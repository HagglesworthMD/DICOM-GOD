/**
 * Keyboard Shortcuts tests
 */

import { describe, it, expect } from 'vitest';
import {
    mapKeyToAction,
    getShortcutsByCategory,
    getCategoryDisplayName,
    SHORTCUT_DEFINITIONS,
} from '../core/shortcuts';

describe('shortcuts', () => {
    describe('mapKeyToAction', () => {
        const createEvent = (key: string, modifiers: { shift?: boolean; ctrl?: boolean; alt?: boolean } = {}): KeyboardEvent => {
            return {
                key,
                shiftKey: modifiers.shift ?? false,
                ctrlKey: modifiers.ctrl ?? false,
                altKey: modifiers.alt ?? false,
                metaKey: false,
                target: document.body,
            } as unknown as KeyboardEvent;
        };

        it('maps ArrowUp to PREV_FRAME', () => {
            const e = createEvent('ArrowUp');
            expect(mapKeyToAction(e)).toBe('PREV_FRAME');
        });

        it('maps ArrowDown to NEXT_FRAME', () => {
            const e = createEvent('ArrowDown');
            expect(mapKeyToAction(e)).toBe('NEXT_FRAME');
        });

        it('maps Shift+ArrowUp to JUMP_BACK_10', () => {
            const e = createEvent('ArrowUp', { shift: true });
            expect(mapKeyToAction(e)).toBe('JUMP_BACK_10');
        });

        it('maps Shift+ArrowDown to JUMP_FWD_10', () => {
            const e = createEvent('ArrowDown', { shift: true });
            expect(mapKeyToAction(e)).toBe('JUMP_FWD_10');
        });

        it('maps Space to TOGGLE_CINE', () => {
            const e = createEvent(' ');
            expect(mapKeyToAction(e)).toBe('TOGGLE_CINE');
        });

        it('maps R to RESET', () => {
            expect(mapKeyToAction(createEvent('R'))).toBe('RESET');
            expect(mapKeyToAction(createEvent('r'))).toBe('RESET');
        });

        it('maps I to INVERT', () => {
            expect(mapKeyToAction(createEvent('I'))).toBe('INVERT');
            expect(mapKeyToAction(createEvent('i'))).toBe('INVERT');
        });

        it('maps tool keys correctly', () => {
            expect(mapKeyToAction(createEvent('W'))).toBe('WL_TOOL');
            expect(mapKeyToAction(createEvent('P'))).toBe('HAND_TOOL');
            expect(mapKeyToAction(createEvent('H'))).toBe('HAND_TOOL');
            expect(mapKeyToAction(createEvent('Z'))).toBe('ZOOM_TOOL');
            expect(mapKeyToAction(createEvent('M'))).toBe('MEASURE_TOOL');
        });

        it('maps Escape to CLOSE_DIALOG', () => {
            const e = createEvent('Escape');
            expect(mapKeyToAction(e)).toBe('CLOSE_DIALOG');
        });

        it('maps ? to TOGGLE_HELP', () => {
            const e = createEvent('?');
            expect(mapKeyToAction(e)).toBe('TOGGLE_HELP');
        });

        it('maps 1-4 to PRESET_1-4', () => {
            expect(mapKeyToAction(createEvent('1'))).toBe('PRESET_1');
            expect(mapKeyToAction(createEvent('2'))).toBe('PRESET_2');
            expect(mapKeyToAction(createEvent('3'))).toBe('PRESET_3');
            expect(mapKeyToAction(createEvent('4'))).toBe('PRESET_4');
        });

        it('ignores input elements', () => {
            const inputEvent = {
                key: 'r',
                shiftKey: false,
                ctrlKey: false,
                altKey: false,
                metaKey: false,
                target: { tagName: 'INPUT' },
            } as unknown as KeyboardEvent;

            expect(mapKeyToAction(inputEvent)).toBeNull();
        });

        it('ignores Ctrl combinations', () => {
            const e = createEvent('R', { ctrl: true });
            expect(mapKeyToAction(e)).toBeNull();
        });

        it('ignores Alt combinations', () => {
            const e = createEvent('R', { alt: true });
            expect(mapKeyToAction(e)).toBeNull();
        });

        it('returns null for unmapped keys', () => {
            expect(mapKeyToAction(createEvent('x'))).toBeNull();
            expect(mapKeyToAction(createEvent('F1'))).toBeNull();
        });
    });

    describe('getShortcutsByCategory', () => {
        it('returns all categories', () => {
            const grouped = getShortcutsByCategory();
            expect(grouped.has('navigation')).toBe(true);
            expect(grouped.has('tools')).toBe(true);
            expect(grouped.has('view')).toBe(true);
            expect(grouped.has('layout')).toBe(true);
            expect(grouped.has('general')).toBe(true);
        });

        it('contains all shortcuts from SHORTCUT_DEFINITIONS', () => {
            const grouped = getShortcutsByCategory();
            const totalInGroups = Array.from(grouped.values()).reduce((sum, arr) => sum + arr.length, 0);
            expect(totalInGroups).toBe(SHORTCUT_DEFINITIONS.length);
        });
    });

    describe('getCategoryDisplayName', () => {
        it('returns proper display names', () => {
            expect(getCategoryDisplayName('navigation')).toBe('Navigation');
            expect(getCategoryDisplayName('tools')).toBe('Tools');
            expect(getCategoryDisplayName('view')).toBe('View');
            expect(getCategoryDisplayName('layout')).toBe('Layout');
            expect(getCategoryDisplayName('general')).toBe('General');
        });

        it('returns category as fallback for unknown', () => {
            expect(getCategoryDisplayName('unknown')).toBe('unknown');
        });
    });

    describe('SHORTCUT_DEFINITIONS', () => {
        it('has no duplicate entries with same key+modifier', () => {
            const seen = new Set<string>();
            let duplicates = 0;

            for (const def of SHORTCUT_DEFINITIONS) {
                const key = `${def.key}|${def.modifier ?? ''}|${def.description}`;
                if (seen.has(key)) {
                    duplicates++;
                }
                seen.add(key);
            }

            expect(duplicates).toBe(0);
        });

        it('all entries have required fields', () => {
            for (const def of SHORTCUT_DEFINITIONS) {
                expect(def.key).toBeDefined();
                expect(def.description).toBeDefined();
                expect(def.category).toBeDefined();
            }
        });
    });
});
