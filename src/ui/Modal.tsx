/**
 * Simple Modal component
 */

import { useEffect, useCallback, type ReactNode } from 'react';
import { Icon } from './Icon';
import { Button } from './Button';
import './Modal.css';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
}

export function Modal({ isOpen, onClose, title, children }: ModalProps) {
    const handleKeyDown = useCallback(
        (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        },
        [onClose]
    );

    useEffect(() => {
        if (isOpen) {
            document.addEventListener('keydown', handleKeyDown);
            document.body.style.overflow = 'hidden';
        }
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = '';
        };
    }, [isOpen, handleKeyDown]);

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="modal"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="modal-title"
            >
                <header className="modal__header">
                    <h2 id="modal-title" className="modal__title">
                        {title}
                    </h2>
                    <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close modal">
                        <Icon name="close" size={18} />
                    </Button>
                </header>
                <div className="modal__content">{children}</div>
            </div>
        </div>
    );
}
