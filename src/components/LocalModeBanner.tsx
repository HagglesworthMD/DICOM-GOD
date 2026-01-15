/**
 * LocalModeBanner - visible indicator when local-only mode is enabled
 */

import { useAppState, useAppDispatch } from '../state/store';
import { disableLocalOnlyMode } from '../core/localOnly';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Button';
import './LocalModeBanner.css';

export function LocalModeBanner() {
    const { localModeEnabled } = useAppState();
    const dispatch = useAppDispatch();

    if (!localModeEnabled) return null;

    const handleReset = () => {
        disableLocalOnlyMode();
        dispatch({ type: 'SET_LOCAL_MODE', enabled: false, warnings: [] });
    };

    return (
        <div className="local-mode-banner" role="alert">
            <Icon name="lock" size={16} />
            <span className="local-mode-banner__text">
                <strong>LOCAL MODE</strong> — Network requests are blocked
            </span>
            {import.meta.env.DEV && (
                <Button variant="ghost" size="sm" onClick={handleReset}>
                    Reset
                </Button>
            )}
        </div>
    );
}
