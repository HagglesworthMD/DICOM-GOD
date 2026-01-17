/**
 * Keyboard Shortcuts
 * Single source of truth for shortcut mapping and help display
 */

export type ShortcutAction =
    | 'PREV_FRAME'
    | 'NEXT_FRAME'
    | 'JUMP_BACK_10'
    | 'JUMP_FWD_10'
    | 'FIRST_FRAME'
    | 'LAST_FRAME'
    | 'RESET'
    | 'INVERT'
    | 'HAND_TOOL'
    | 'WL_TOOL'
    | 'ZOOM_TOOL'
    | 'MEASURE_TOOL'
    | 'WL_PRESET_1'
    | 'WL_PRESET_2'
    | 'WL_PRESET_3'
    | 'WL_PRESET_4'
    | 'WL_PRESET_5'
    | 'WL_DICOM_DEFAULT'
    | 'TOGGLE_CINE'
    | 'TOGGLE_HELP'
    | 'TOGGLE_TILE_MODE'
    | 'PREV_TILE'
    | 'NEXT_TILE'
    | 'CLOSE_DIALOG'
    | null;

/** Shortcut definition for help display */
export interface ShortcutDefinition {
    /** Display key (e.g., "Space", "↑/↓") */
    key: string;
    /** Optional modifier (e.g., "Shift") */
    modifier?: string;
    /** Human-readable description */
    description: string;
    /** Category for grouping */
    category: 'navigation' | 'tools' | 'view' | 'layout' | 'general';
}

/** All implemented shortcuts - single source of truth */
export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
    // Navigation
    { key: '↑ / ↓', description: 'Previous / Next frame', category: 'navigation' },
    { key: '↑ / ↓', modifier: 'Shift', description: 'Jump 10 frames', category: 'navigation' },
    { key: 'Home / End', description: 'First / Last frame', category: 'navigation' },
    { key: 'Space', description: 'Play / Pause cine', category: 'navigation' },
    { key: 'Scroll', modifier: 'Shift', description: 'Fast stack scroll / Cycle tiles', category: 'navigation' },
    { key: 'Right-drag', description: 'Scrub frames (drag up/down)', category: 'navigation' },
    { key: 'Alt+Left-drag', description: 'Scrub frames (trackpad)', category: 'navigation' },
    { key: 'Right-drag', modifier: 'Shift', description: 'Scrub frames 5× faster', category: 'navigation' },
    { key: '[ / ]', description: 'Previous / Next tile (contact sheet)', category: 'navigation' },
    { key: 'T', description: 'Toggle tile mode (contact sheet)', category: 'navigation' },

    // Tools
    { key: 'W', description: 'Window/Level tool', category: 'tools' },
    { key: 'P / H', description: 'Pan tool', category: 'tools' },
    { key: 'Z', description: 'Zoom tool', category: 'tools' },
    { key: 'M', description: 'Measure tool', category: 'tools' },

    // View
    { key: 'R', description: 'Reset view', category: 'view' },
    { key: 'I', description: 'Invert grayscale', category: 'view' },
    { key: 'F1-F5', description: 'WL presets (Soft/Lung/Bone/Brain/Abdo)', category: 'view' },
    { key: 'F6', description: 'DICOM default WL', category: 'view' },

    // Layout
    { key: '1 / 2 / 3 / 4', description: 'Select viewport slot', category: 'layout' },
    { key: 'Tab', description: 'Cycle to next viewport', category: 'layout' },
    { key: 'Tab', modifier: 'Shift', description: 'Cycle to previous viewport', category: 'layout' },

    // General
    { key: '?', description: 'Show keyboard shortcuts', category: 'general' },
    { key: 'Escape', description: 'Close dialogs / Clear selection', category: 'general' },
];

/**
 * Map keyboard event to action
 */
export function mapKeyToAction(e: KeyboardEvent): ShortcutAction {
    // Ignore if input is focused
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return null;

    // Allow Shift, but ignore Ctrl/Alt/Meta to avoid browser conflicts
    if (e.ctrlKey || e.altKey || e.metaKey) return null;

    switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowUp':
            return e.shiftKey ? 'JUMP_BACK_10' : 'PREV_FRAME';

        case 'ArrowRight':
        case 'ArrowDown':
            return e.shiftKey ? 'JUMP_FWD_10' : 'NEXT_FRAME';

        case 'Home': return 'FIRST_FRAME';
        case 'End': return 'LAST_FRAME';

        case 'r':
        case 'R': return 'RESET';

        case 'i':
        case 'I': return 'INVERT';

        case 'Escape': return 'CLOSE_DIALOG';

        case 'h':
        case 'H':
        case 'p':
        case 'P': return 'HAND_TOOL';

        case 'w':
        case 'W': return 'WL_TOOL';

        case 'z':
        case 'Z': return 'ZOOM_TOOL';

        case 'm':
        case 'M': return 'MEASURE_TOOL';

        case ' ': return 'TOGGLE_CINE';

        case '?': return 'TOGGLE_HELP';

        // WL presets via function keys (avoids conflict with slot selection)
        case 'F1': return 'WL_PRESET_1';
        case 'F2': return 'WL_PRESET_2';
        case 'F3': return 'WL_PRESET_3';
        case 'F4': return 'WL_PRESET_4';
        case 'F5': return 'WL_PRESET_5';
        case 'F6': return 'WL_DICOM_DEFAULT';

        // Tile mode shortcuts
        case 't':
        case 'T': return 'TOGGLE_TILE_MODE';
        case '[': return 'PREV_TILE';
        case ']': return 'NEXT_TILE';
    }

    return null;
}

/**
 * Get shortcuts grouped by category for help display
 */
export function getShortcutsByCategory(): Map<string, ShortcutDefinition[]> {
    const groups = new Map<string, ShortcutDefinition[]>();

    const categoryOrder = ['navigation', 'tools', 'view', 'layout', 'general'];
    for (const cat of categoryOrder) {
        groups.set(cat, []);
    }

    for (const shortcut of SHORTCUT_DEFINITIONS) {
        const list = groups.get(shortcut.category)!;
        list.push(shortcut);
    }

    return groups;
}

/**
 * Get category display name
 */
export function getCategoryDisplayName(category: string): string {
    const names: Record<string, string> = {
        navigation: 'Navigation',
        tools: 'Tools',
        view: 'View',
        layout: 'Layout',
        general: 'General',
    };
    return names[category] || category;
}
