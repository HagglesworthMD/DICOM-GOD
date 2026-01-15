/**
 * Tiny Button component
 */

import type { ButtonHTMLAttributes } from 'react';
import './Button.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
}

export function Button({
    variant = 'primary',
    size = 'md',
    className = '',
    children,
    ...props
}: ButtonProps) {
    return (
        <button
            className={`btn btn--${variant} btn--${size} ${className}`}
            {...props}
        >
            {children}
        </button>
    );
}
