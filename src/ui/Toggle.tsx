/**
 * Tiny Toggle switch component
 */

import type { InputHTMLAttributes } from 'react';
import './Toggle.css';

export interface ToggleProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
    label?: string;
}

export function Toggle({ label, id, className = '', ...props }: ToggleProps) {
    const toggleId = id ?? `toggle-${Math.random().toString(36).slice(2, 9)}`;

    return (
        <label htmlFor={toggleId} className={`toggle ${className}`}>
            <input type="checkbox" id={toggleId} className="toggle__input" {...props} />
            <span className="toggle__track">
                <span className="toggle__thumb" />
            </span>
            {label && <span className="toggle__label">{label}</span>}
        </label>
    );
}
