
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
    | 'PRESET_1'
    | 'PRESET_2'
    | 'PRESET_3'
    | 'PRESET_4'
    | 'TOGGLE_CINE'
    | 'TOGGLE_HELP'
    | null;

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

        case 'Escape':
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

        case '1': return 'PRESET_1';
        case '2': return 'PRESET_2';
        case '3': return 'PRESET_3';
        case '4': return 'PRESET_4';
    }

    return null;
}
