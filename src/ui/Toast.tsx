/**
 * Toast notification component for errors and messages
 */

import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { Button } from './Button';
import './Toast.css';

interface ToastProps {
    id: string;
    message: string;
    stack?: string;
    type?: 'error' | 'warning' | 'info';
    onDismiss: (id: string) => void;
    autoDismiss?: number; // ms, 0 = no auto dismiss
}

export function Toast({
    id,
    message,
    stack,
    type = 'error',
    onDismiss,
    autoDismiss = 0,
}: ToastProps) {
    const [showStack, setShowStack] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (autoDismiss > 0) {
            const timer = setTimeout(() => onDismiss(id), autoDismiss);
            return () => clearTimeout(timer);
        }
    }, [id, autoDismiss, onDismiss]);

    const handleCopy = async () => {
        const text = stack ? `${message}\n\n${stack}` : message;
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard API not available
        }
    };

    const iconName = type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info';

    return (
        <div className={`toast toast--${type}`} role="alert">
            <Icon name={iconName} size={20} className="toast__icon" />
            <div className="toast__content">
                <p className="toast__message">{message}</p>
                {stack && showStack && <pre className="toast__stack">{stack}</pre>}
            </div>
            <div className="toast__actions">
                {stack && (
                    <>
                        <Button variant="ghost" size="sm" onClick={() => setShowStack(!showStack)}>
                            {showStack ? 'Hide' : 'Stack'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={handleCopy}>
                            <Icon name={copied ? 'check' : 'copy'} size={14} />
                        </Button>
                    </>
                )}
                <Button variant="ghost" size="sm" onClick={() => onDismiss(id)} aria-label="Dismiss">
                    <Icon name="close" size={14} />
                </Button>
            </div>
        </div>
    );
}

interface ToastContainerProps {
    toasts: Array<{
        id: string;
        message: string;
        stack?: string;
        type?: 'error' | 'warning' | 'info';
    }>;
    onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
    if (toasts.length === 0) return null;

    return (
        <div className="toast-container">
            {toasts.map((toast) => (
                <Toast key={toast.id} {...toast} onDismiss={onDismiss} />
            ))}
        </div>
    );
}
