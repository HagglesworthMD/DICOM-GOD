/**
 * VOI (Value of Interest) Windowing
 * Maps pixel values to display values using window center/width
 */

/**
 * Apply linear VOI LUT to a single value
 * Returns 0-255 for display
 */
export function applyVOI(
    value: number,
    windowCenter: number,
    windowWidth: number,
    invert = false
): number {
    const halfWidth = windowWidth / 2;
    const minVal = windowCenter - halfWidth;
    const maxVal = windowCenter + halfWidth;

    let output: number;
    if (value <= minVal) {
        output = 0;
    } else if (value >= maxVal) {
        output = 255;
    } else {
        output = ((value - minVal) / windowWidth) * 255;
    }

    if (invert) {
        output = 255 - output;
    }

    return Math.round(output);
}

/**
 * Create a lookup table for fast windowing
 * For 16-bit data with known min/max
 */
export function createWindowLUT(
    minPixel: number,
    maxPixel: number,
    windowCenter: number,
    windowWidth: number,
    rescaleSlope: number,
    rescaleIntercept: number,
    invert = false
): Uint8Array {
    const range = maxPixel - minPixel + 1;
    const lut = new Uint8Array(range);

    for (let i = 0; i < range; i++) {
        const storedValue = minPixel + i;
        const rescaled = storedValue * rescaleSlope + rescaleIntercept;
        lut[i] = applyVOI(rescaled, windowCenter, windowWidth, invert);
    }

    return lut;
}

/**
 * Apply VOI windowing to pixel data and output to RGBA canvas buffer
 */
export function applyWindowToRGBA(
    pixelData: Int16Array | Uint16Array | Uint8Array,
    output: Uint8ClampedArray,
    width: number,
    height: number,
    windowCenter: number,
    windowWidth: number,
    rescaleSlope: number,
    rescaleIntercept: number,
    invert: boolean,
    samplesPerPixel: number
): void {
    const numPixels = width * height;

    if (samplesPerPixel === 3) {
        // RGB - just copy with optional invert
        for (let i = 0; i < numPixels; i++) {
            const srcIdx = i * 3;
            const dstIdx = i * 4;

            let r = pixelData[srcIdx] ?? 0;
            let g = pixelData[srcIdx + 1] ?? 0;
            let b = pixelData[srcIdx + 2] ?? 0;

            if (invert) {
                r = 255 - r;
                g = 255 - g;
                b = 255 - b;
            }

            output[dstIdx] = r;
            output[dstIdx + 1] = g;
            output[dstIdx + 2] = b;
            output[dstIdx + 3] = 255;
        }
        return;
    }

    // Grayscale - apply windowing
    const halfWidth = windowWidth / 2;
    const minVal = windowCenter - halfWidth;
    const scale = 255 / windowWidth;

    for (let i = 0; i < numPixels; i++) {
        const stored = pixelData[i] ?? 0;
        const rescaled = stored * rescaleSlope + rescaleIntercept;

        let display: number;
        if (rescaled <= minVal) {
            display = 0;
        } else if (rescaled >= minVal + windowWidth) {
            display = 255;
        } else {
            display = (rescaled - minVal) * scale;
        }

        if (invert) {
            display = 255 - display;
        }

        const clamped = Math.max(0, Math.min(255, Math.round(display)));
        const dstIdx = i * 4;
        output[dstIdx] = clamped;
        output[dstIdx + 1] = clamped;
        output[dstIdx + 2] = clamped;
        output[dstIdx + 3] = 255;
    }
}

/**
 * Calculate default window from pixel statistics
 */
export function calculateDefaultWindow(
    minValue: number,
    maxValue: number,
    rescaleSlope: number,
    rescaleIntercept: number
): { center: number; width: number } {
    const min = minValue * rescaleSlope + rescaleIntercept;
    const max = maxValue * rescaleSlope + rescaleIntercept;
    const range = max - min;

    return {
        center: min + range / 2,
        width: Math.max(1, range),
    };
}
