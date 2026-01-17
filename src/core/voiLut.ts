export interface ModalityParams {
    slope: number;
    intercept: number;
    bitsStored: number;
    pixelRepresentation: number;
}

export function parseWindowMultiValue(input: string | number | null | undefined): number[] | null {
    if (input === null || input === undefined) return null;
    if (typeof input === 'number') return Number.isFinite(input) ? [input] : null;
    const str = String(input).trim();
    if (!str) return null;

    const parts = str.split('\\');
    const values: number[] = [];
    for (const part of parts) {
        const parsed = parseFloat(part);
        if (Number.isFinite(parsed)) values.push(parsed);
    }

    return values.length > 0 ? values : null;
}

export function parseWindowValue(input: string | number | null | undefined): number | null {
    const values = parseWindowMultiValue(input);
    return values && values.length > 0 ? values[0] : null;
}

export function selectWindowValue(
    values: number[] | null,
    frameNumber: number,
    frameCount: number
): number | null {
    if (!values || values.length === 0) return null;
    if (values.length > 1 && frameCount > 1 && values.length === frameCount) {
        const idx = Math.max(0, Math.min(frameNumber, values.length - 1));
        return values[idx];
    }
    return values[0];
}

export function normalizeStoredValue(
    stored: number,
    bitsStored: number,
    pixelRepresentation: number
): number {
    if (!Number.isFinite(bitsStored) || bitsStored <= 0 || bitsStored > 31) {
        return stored;
    }

    const mask = (1 << bitsStored) - 1;
    const masked = stored & mask;

    if (pixelRepresentation === 1) {
        const signBit = 1 << (bitsStored - 1);
        if (masked & signBit) {
            return masked - (1 << bitsStored);
        }
    }

    return masked;
}

export function toModalityValue(stored: number, params: ModalityParams): number {
    const slope = Number.isFinite(params.slope) ? params.slope : 1;
    const intercept = Number.isFinite(params.intercept) ? params.intercept : 0;
    const normalized = normalizeStoredValue(stored, params.bitsStored, params.pixelRepresentation);
    return normalized * slope + intercept;
}

export function applyWindow(
    modalityValue: number,
    windowCenter: number,
    windowWidth: number,
    invert = false
): number {
    const width = Math.max(1, windowWidth);
    const halfWidth = width / 2;
    const minVal = windowCenter - halfWidth;
    const maxVal = windowCenter + halfWidth;

    let output: number;
    if (modalityValue <= minVal) {
        output = 0;
    } else if (modalityValue >= maxVal) {
        output = 255;
    } else {
        output = ((modalityValue - minVal) / width) * 255;
    }

    if (invert) {
        output = 255 - output;
    }

    return Math.round(Math.max(0, Math.min(255, output)));
}

export function computePercentileWindow(
    samples: number[],
    lowerPercent = 1,
    upperPercent = 99
): { center: number; width: number; low: number; high: number } {
    if (samples.length === 0) {
        return { center: 0, width: 1, low: 0, high: 1 };
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const low = percentile(sorted, lowerPercent);
    const high = percentile(sorted, upperPercent);
    const width = Math.max(1, high - low);

    return {
        center: low + width / 2,
        width,
        low,
        high,
    };
}

function percentile(sorted: number[], percent: number): number {
    if (sorted.length === 1) return sorted[0];
    const clamped = Math.max(0, Math.min(100, percent));
    const idx = Math.floor((clamped / 100) * (sorted.length - 1));
    return sorted[idx] ?? sorted[0];
}
