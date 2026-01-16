/**
 * ShortcutsHelp - keyboard shortcuts overlay
 * Uses centralized SHORTCUT_DEFINITIONS for single source of truth
 */

import { useEffect, useCallback } from 'react';
import { Modal } from '../ui/Modal';
import { useAppState, useAppDispatch } from '../state/store';
import { getShortcutsByCategory, getCategoryDisplayName } from '../core/shortcuts';
import './ShortcutsHelp.css';

export function ShortcutsHelp() {
    const { shortcutsHelpVisible } = useAppState();
    const dispatch = useAppDispatch();

    const close = useCallback(() => {
        dispatch({ type: 'SET_SHORTCUTS_VISIBLE', visible: false });
    }, [dispatch]);

    // Listen for ? key to toggle and Escape to close
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === '?' && !e.ctrlKey && !e.altKey && !e.metaKey) {
                dispatch({ type: 'SET_SHORTCUTS_VISIBLE', visible: !shortcutsHelpVisible });
            } else if (e.key === 'Escape' && shortcutsHelpVisible) {
                dispatch({ type: 'SET_SHORTCUTS_VISIBLE', visible: false });
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [dispatch, shortcutsHelpVisible]);

    // Get shortcuts grouped by category
    const shortcutsByCategory = getShortcutsByCategory();

    return (
        <Modal isOpen={shortcutsHelpVisible} onClose={close} title="Keyboard Shortcuts">
            <div className="shortcuts-help">
                {Array.from(shortcutsByCategory.entries()).map(([category, shortcuts]) => (
                    shortcuts.length > 0 && (
                        <div key={category} className="shortcuts-help__category">
                            <h3 className="shortcuts-help__category-title">
                                {getCategoryDisplayName(category)}
                            </h3>
                            <table className="shortcuts-table">
                                <tbody>
                                    {shortcuts.map((s, i) => (
                                        <tr key={`${s.key}-${i}`}>
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
                        </div>
                    )
                ))}
            </div>
        </Modal>
    );
}
