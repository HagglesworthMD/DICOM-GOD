/**
 * Inline SVG icon helper
 * Uses inline SVG for zero network requests
 */

export type IconName =
    | 'folder'
    | 'close'
    | 'warning'
    | 'error'
    | 'info'
    | 'copy'
    | 'keyboard'
    | 'lock'
    | 'unlock'
    | 'file'
    | 'check';

interface IconProps {
    name: IconName;
    size?: number;
    className?: string;
}

const icons: Record<IconName, string> = {
    folder:
        '<path d="M4 4h5l2 2h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="2" fill="none"/>',
    close:
        '<path d="M6 6l12 12M6 18L18 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    warning:
        '<path d="M12 2L2 20h20L12 2z" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 9v4M12 16v1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    error:
        '<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 7v5M12 15v1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    info: '<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 11v5M12 8v1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="1" stroke="currentColor" stroke-width="2" fill="none"/><path d="M16 4H6a2 2 0 0 0-2 2v10" stroke="currentColor" stroke-width="2" fill="none"/>',
    keyboard:
        '<rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M8 13h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="1" stroke="currentColor" stroke-width="2" fill="none"/><path d="M8 11V7a4 4 0 1 1 8 0v4" stroke="currentColor" stroke-width="2" fill="none"/>',
    unlock:
        '<rect x="5" y="11" width="14" height="10" rx="1" stroke="currentColor" stroke-width="2" fill="none"/><path d="M8 11V7a4 4 0 0 1 8 0" stroke="currentColor" stroke-width="2" fill="none"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" stroke="currentColor" stroke-width="2" fill="none"/><path d="M14 2v6h6" stroke="currentColor" stroke-width="2" fill="none"/>',
    check:
        '<path d="M5 12l5 5L20 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
};

export function Icon({ name, size = 24, className = '' }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            className={`icon icon--${name} ${className}`}
            dangerouslySetInnerHTML={{ __html: icons[name] }}
            aria-hidden="true"
        />
    );
}
