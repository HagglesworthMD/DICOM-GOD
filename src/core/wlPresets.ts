/**
 * Window/Level Presets
 * Modality-aware VOI presets for DICOM viewing
 */

export interface WlPreset {
    /** Unique preset ID */
    id: string;
    /** Display name */
    name: string;
    /** Short label for HUD */
    label: string;
    /** Window Center */
    wc: number;
    /** Window Width */
    ww: number;
    /** Keyboard shortcut (for display) */
    shortcut?: string;
    /** Whether this is a DICOM-provided value */
    isDicomDefault?: boolean;
}

/** Standard presets for CT/general imaging */
export const WL_PRESETS: Record<string, WlPreset> = {
    soft_tissue: {
        id: 'soft_tissue',
        name: 'Soft Tissue',
        label: 'Soft',
        wc: 40,
        ww: 400,
        shortcut: 'F1',
    },
    lung: {
        id: 'lung',
        name: 'Lung',
        label: 'Lung',
        wc: -600,
        ww: 1500,
        shortcut: 'F2',
    },
    bone: {
        id: 'bone',
        name: 'Bone',
        label: 'Bone',
        wc: 400,
        ww: 2000,
        shortcut: 'F3',
    },
    brain: {
        id: 'brain',
        name: 'Brain',
        label: 'Brain',
        wc: 40,
        ww: 80,
        shortcut: 'F4',
    },
    abdomen: {
        id: 'abdomen',
        name: 'Abdomen',
        label: 'Abdo',
        wc: 60,
        ww: 400,
        shortcut: 'F5',
    },
};

/** Ordered list of presets for UI */
export const PRESET_LIST: WlPreset[] = [
    WL_PRESETS.soft_tissue,
    WL_PRESETS.lung,
    WL_PRESETS.bone,
    WL_PRESETS.brain,
    WL_PRESETS.abdomen,
];

/** Default preset for DICOM-provided values */
export const DICOM_DEFAULT_PRESET: WlPreset = {
    id: 'dicom_default',
    name: 'DICOM Default',
    label: 'DICOM',
    wc: 0, // Placeholder - actual values come from DICOM
    ww: 0,
    shortcut: 'F6',
    isDicomDefault: true,
};

/**
 * Get default preset ID for a modality
 */
export function getDefaultPresetForModality(modality: string): string | null {
    const mod = modality.toUpperCase();

    switch (mod) {
        case 'CT':
            return 'soft_tissue';
        case 'MR':
        case 'MRI':
            return 'brain'; // Default brain for MR
        case 'CR':
        case 'DX':
        case 'DR':
            // Radiographs: wide window
            return null; // Use DICOM default (broad range)
        case 'US':
            // Ultrasound: preserve original
            return null;
        case 'PT':
        case 'NM':
            // Nuclear: no preset
            return null;
        default:
            return null;
    }
}

/**
 * Get preset by ID
 */
export function getPresetById(id: string): WlPreset | null {
    if (id === 'dicom_default') {
        return DICOM_DEFAULT_PRESET;
    }
    return WL_PRESETS[id] || null;
}

/**
 * Get all presets as array (for UI dropdowns)
 */
export function getAllPresets(): WlPreset[] {
    return [...PRESET_LIST];
}

/**
 * Format WL for display
 */
export function formatWl(wc: number, ww: number): string {
    return `WC: ${Math.round(wc)} / WW: ${Math.round(ww)}`;
}

/**
 * Check if current WL matches a preset
 */
export function findMatchingPreset(wc: number, ww: number, tolerance = 1): WlPreset | null {
    for (const preset of PRESET_LIST) {
        if (
            Math.abs(preset.wc - wc) <= tolerance &&
            Math.abs(preset.ww - ww) <= tolerance
        ) {
            return preset;
        }
    }
    return null;
}
