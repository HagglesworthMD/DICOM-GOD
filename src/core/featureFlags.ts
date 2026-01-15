/**
 * Feature flags for progressive feature rollout
 * All flags default to enabled unless explicitly disabled
 */

export interface FeatureFlags {
    /** Whether the Viewport component should render (allows stubbing out viewer) */
    viewerEnabled: boolean;
    /** Whether to show the keyboard shortcuts overlay */
    shortcutsHelpEnabled: boolean;
    /** Whether drag and drop is enabled */
    dropZoneEnabled: boolean;
    /** Whether folder picker is enabled */
    folderPickerEnabled: boolean;
}

const defaults: FeatureFlags = {
    viewerEnabled: true,
    shortcutsHelpEnabled: true,
    dropZoneEnabled: true,
    folderPickerEnabled: true,
};

// Read from localStorage if available (for dev toggling)
function loadFlags(): FeatureFlags {
    if (typeof window === 'undefined') return defaults;

    try {
        const stored = localStorage.getItem('dicom-god-flags');
        if (stored) {
            return { ...defaults, ...JSON.parse(stored) };
        }
    } catch {
        // Ignore parse errors
    }
    return defaults;
}

let flags = loadFlags();

export function getFlag<K extends keyof FeatureFlags>(key: K): FeatureFlags[K] {
    return flags[key];
}

export function setFlag<K extends keyof FeatureFlags>(key: K, value: FeatureFlags[K]): void {
    flags = { ...flags, [key]: value };
    try {
        localStorage.setItem('dicom-god-flags', JSON.stringify(flags));
    } catch {
        // Storage full or unavailable
    }
}

export function getAllFlags(): FeatureFlags {
    return { ...flags };
}

export function resetFlags(): void {
    flags = { ...defaults };
    try {
        localStorage.removeItem('dicom-god-flags');
    } catch {
        // Ignore
    }
}
