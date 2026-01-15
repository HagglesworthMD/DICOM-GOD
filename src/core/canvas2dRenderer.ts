/**
 * Canvas2D Renderer
 * Renders decoded DICOM frames to canvas with VOI windowing
 */

import { applyWindowToRGBA } from './voi';
import type { DecodedFrame, ViewportState } from './types';

export interface RenderResult {
    success: boolean;
    error?: string;
}

/**
 * Render a decoded frame to a canvas
 */
export function renderFrame(
    canvas: HTMLCanvasElement,
    frame: DecodedFrame,
    state: ViewportState
): RenderResult {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return { success: false, error: 'Failed to get 2D context' };
    }

    try {
        // Create image data
        const imageData = ctx.createImageData(frame.width, frame.height);

        // Apply windowing
        applyWindowToRGBA(
            frame.pixelData,
            imageData.data,
            frame.width,
            frame.height,
            state.windowCenter,
            state.windowWidth,
            frame.rescaleSlope,
            frame.rescaleIntercept,
            state.invert,
            frame.samplesPerPixel
        );

        // Calculate display transform
        const canvasWidth = canvas.width;
        const canvasHeight = canvas.height;

        // Fit to canvas while maintaining aspect ratio
        const imageAspect = frame.width / frame.height;
        const canvasAspect = canvasWidth / canvasHeight;

        let displayWidth: number;
        let displayHeight: number;

        if (imageAspect > canvasAspect) {
            displayWidth = canvasWidth;
            displayHeight = canvasWidth / imageAspect;
        } else {
            displayHeight = canvasHeight;
            displayWidth = canvasHeight * imageAspect;
        }

        // Apply zoom
        displayWidth *= state.zoom;
        displayHeight *= state.zoom;

        // Center with pan offset
        const x = (canvasWidth - displayWidth) / 2 + state.panX;
        const y = (canvasHeight - displayHeight) / 2 + state.panY;

        // Clear canvas
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        // Create temporary canvas for the image
        const tempCanvas = new OffscreenCanvas(frame.width, frame.height);
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) {
            return { success: false, error: 'Failed to create temp context' };
        }

        tempCtx.putImageData(imageData, 0, 0);

        // Draw scaled image
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(tempCanvas, x, y, displayWidth, displayHeight);

        return { success: true };
    } catch (err) {
        return {
            success: false,
            error: err instanceof Error ? err.message : 'Render failed'
        };
    }
}

/**
 * Render loading state
 */
export function renderLoading(canvas: HTMLCanvasElement, message = 'Loading...'): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#888';
    ctx.font = '16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(message, w / 2, h / 2);
}

/**
 * Render error state
 */
export function renderError(
    canvas: HTMLCanvasElement,
    message: string,
    isUnsupported = false
): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);

    // Icon
    ctx.font = '32px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(isUnsupported ? '⚠️' : '❌', w / 2, h / 2 - 30);

    // Message
    ctx.fillStyle = isUnsupported ? '#f59e0b' : '#ef4444';
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText(message, w / 2, h / 2 + 10);

    if (isUnsupported) {
        ctx.fillStyle = '#666';
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillText('This transfer syntax is not yet supported', w / 2, h / 2 + 35);
    }
}

/**
 * Draw overlay info on canvas
 */
export function drawOverlay(
    canvas: HTMLCanvasElement,
    info: {
        frameIndex: number;
        totalFrames: number;
        windowCenter: number;
        windowWidth: number;
        zoom: number;
        dimensions?: { width: number; height: number };
    }
): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const padding = 10;

    ctx.save();

    // Semi-transparent background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.font = '12px monospace';

    // Top-left: Frame info
    const frameText = `${info.frameIndex + 1} / ${info.totalFrames}`;
    const frameWidth = ctx.measureText(frameText).width + padding * 2;
    ctx.fillRect(padding, padding, frameWidth, 20);
    ctx.fillStyle = '#fff';
    ctx.fillText(frameText, padding * 2, padding + 14);

    // Top-right: Window info
    const wcText = `WC: ${Math.round(info.windowCenter)}`;
    const wwText = `WW: ${Math.round(info.windowWidth)}`;
    const windowWidth = Math.max(ctx.measureText(wcText).width, ctx.measureText(wwText).width) + padding * 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(canvas.width - windowWidth - padding, padding, windowWidth, 40);
    ctx.fillStyle = '#fff';
    ctx.fillText(wcText, canvas.width - windowWidth, padding + 14);
    ctx.fillText(wwText, canvas.width - windowWidth, padding + 28);

    // Bottom-left: Zoom
    const zoomText = `Zoom: ${Math.round(info.zoom * 100)}%`;
    const zoomWidth = ctx.measureText(zoomText).width + padding * 2;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(padding, canvas.height - 30, zoomWidth, 20);
    ctx.fillStyle = '#fff';
    ctx.fillText(zoomText, padding * 2, canvas.height - 16);

    // Bottom-right: Dimensions
    if (info.dimensions) {
        const dimText = `${info.dimensions.width} × ${info.dimensions.height}`;
        const dimWidth = ctx.measureText(dimText).width + padding * 2;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(canvas.width - dimWidth - padding, canvas.height - 30, dimWidth, 20);
        ctx.fillStyle = '#fff';
        ctx.fillText(dimText, canvas.width - dimWidth, canvas.height - 16);
    }

    ctx.restore();
}
