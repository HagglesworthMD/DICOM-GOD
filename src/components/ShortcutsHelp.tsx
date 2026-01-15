/**
 * ShortcutsHelp - keyboard shortcuts overlay stub
 */

import { useEffect, useCallback } from 'react';
import { Modal } from '../ui/Modal';
import { useAppState, useAppDispatch } from '../state/store';
import type { Shortcut } from '../core/types';
import './ShortcutsHelp.css';

const shortcuts: Shortcut[] = [
    { key: '?', description: 'Show this help' },
    { key: 'O', modifier: 'ctrl', description: 'Open folder' },
    { key: 'L', modifier: 'ctrl', description: 'Toggle local-only mode' },
    { key: 'Escape', description: 'Close dialogs / deselect' },
    { key: '↑ / ↓', description: 'Navigate stack (future)' },
    { key: 'W', description: 'Window/Level mode (future)' },
    { key: 'Z', description: 'Zoom mode (future)' },
    { key: 'P', description: 'Pan mode (future)' },
    { key: 'R', description: 'Reset view (future)' },
    { key: 'Space', description: 'Play/Pause cine (future)' },
];

export function ShortcutsHelp() {
    const { shortcutsHelpVisible } = useAppState();
    const dispatch = useAppDispatch();

    const close = useCallback(() => {
        dispatch({ type: 'SET_SHORTCUTS_VISIBLE', visible: false });
    }, [dispatch]);

    // Listen for ? key to toggle
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === '?' && !e.ctrlKey && !e.altKey && !e.metaKey) {
                dispatch({ type: 'SET_SHORTCUTS_VISIBLE', visible: !shortcutsHelpVisible });
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [dispatch, shortcutsHelpVisible]);

    return (
        <Modal isOpen={shortcutsHelpVisible} onClose={close} title="Keyboard Shortcuts">
            <table className="shortcuts-table">
                <tbody>
                    {shortcuts.map((s) => (
                        <tr key={s.key}>
                            <td className="shortcuts-table__key">
                                {s.modifier && <kbd>{s.modifier}</kbd>}
                                {s.modifier && ' + '}
                                <kbd>{s.key}</kbd>
                            </td>
                            <td className="shortcuts-table__desc">{s.description}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <p className="shortcuts-note">
                Note: Most shortcuts are placeholders for future functionality
            </p>
        </Modal>
    );
}
