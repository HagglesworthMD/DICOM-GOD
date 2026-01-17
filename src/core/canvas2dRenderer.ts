/**
 * Canvas2D Renderer
 * Renders decoded DICOM frames to canvas with VOI windowing
 */

import { applyWindowToRGBA } from './voi';
import type { DecodedFrame, ViewportState, LengthMeasurement, GeometryTrustInfo, ContactSheetTile } from './types';

export interface RenderResult {
    success: boolean;
    error?: string;
}

/** Optional crop rectangle for tile mode rendering */
export interface CropRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/**
 * Render a decoded frame to a canvas
 * @param cropRect Optional crop region for tile mode (renders only this portion)
 */
export function renderFrame(
    canvas: HTMLCanvasElement,
    frame: DecodedFrame,
    state: ViewportState,
    cropRect?: CropRect | ContactSheetTile | null
): RenderResult {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return { success: false, error: 'Failed to get 2D context' };
    }

    try {
        // Create image data for full frame
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

        // Source region (full frame or crop)
        const srcX = cropRect?.x ?? 0;
        const srcY = cropRect?.y ?? 0;
        const srcW = cropRect?.w ?? frame.width;
        const srcH = cropRect?.h ?? frame.height;

        // Fit to canvas while maintaining aspect ratio
        const imageAspect = srcW / srcH;
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

        // Draw scaled image (with optional cropping)
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Use drawImage with source rect for cropping
        ctx.drawImage(
            tempCanvas,
            srcX, srcY, srcW, srcH,  // Source rectangle (crop region)
            x, y, displayWidth, displayHeight  // Destination rectangle
        );

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
        pixelSpacing?: number[]; // [rowSpacing, colSpacing] in mm
        geometryTrust?: GeometryTrustInfo;
        measurements?: LengthMeasurement[];
        inProgressMeasurement?: { startX: number; startY: number; endX: number; endY: number } | null;
        imageToCanvasTransform?: {
            scale: number;
            offsetX: number;
            offsetY: number;
        };
        cineInfo?: {
            isPlaying: boolean;
            fps: number;
            canCine: boolean;
            isBuffering?: boolean;
            cineReason?: string;
        };
        activePresetName?: string;
        tileInfo?: {
            tileIndex: number;
            tileCount: number;
            grid: { cols: number; rows: number };
            kind: 'usRegions' | 'heuristic';
        };
    }
): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const padding = 10;

    ctx.save();

    // Semi-transparent background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.font = '12px monospace';

    // Top-left: Frame info + Tile info + Cine status
    let frameText = `${info.frameIndex + 1} / ${info.totalFrames}`;
    let cineColor = '#fff';

    // Add tile info if in tile mode
    if (info.tileInfo) {
        const trustIcon = info.tileInfo.kind === 'usRegions' ? '🟢' : '🟡';
        frameText += ` | Tile ${info.tileInfo.tileIndex + 1}/${info.tileInfo.tileCount} ${trustIcon} ${info.tileInfo.grid.cols}×${info.tileInfo.grid.rows}`;
    }

    if (info.cineInfo) {
        if (info.cineInfo.isPlaying) {
            if (info.cineInfo.isBuffering) {
                frameText += ` ⏳ buffering (hold)`;
                cineColor = '#ff4'; // Yellow when buffering
            } else {
                frameText += ` ▶ CINE ${info.cineInfo.fps}fps`;
                cineColor = '#4f4'; // Green when playing
            }
        } else if (!info.cineInfo.canCine) {
            frameText += ` ⊘ CINE disabled`;
            cineColor = '#888'; // Gray when disabled
        }
    }

    const frameWidth = ctx.measureText(frameText).width + padding * 2;
    ctx.fillRect(padding, padding, frameWidth, 20);
    ctx.fillStyle = cineColor;
    ctx.fillText(frameText, padding * 2, padding + 14);

    // Top-right: Window info (WL + Preset)
    let presetText = null;
    if (info.activePresetName) {
        presetText = `WL: ${info.activePresetName}`;
    }

    const wcText = `WC: ${Math.round(info.windowCenter)}`;
    const wwText = `WW: ${Math.round(info.windowWidth)}`;

    // Calculate width needed
    const maxWidth = Math.max(
        ctx.measureText(wcText).width,
        ctx.measureText(wwText).width,
        presetText ? ctx.measureText(presetText).width : 0
    );
    const windowWidth = maxWidth + padding * 2;
    const windowHeight = presetText ? 60 : 40;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(canvas.width - windowWidth - padding, padding, windowWidth, windowHeight);

    ctx.fillStyle = '#fff';

    let y = padding + 14;
    if (presetText) {
        ctx.fillStyle = '#0f0'; // Active preset in green
        ctx.fillText(presetText, canvas.width - windowWidth, y);
        ctx.fillStyle = '#fff'; // Reset for numbers
        y += 14;
    }

    ctx.fillText(wcText, canvas.width - windowWidth, y);
    ctx.fillText(wwText, canvas.width - windowWidth, y + 14);

    // Bottom-left: Zoom + Spacing source
    let bottomLeftText = `Zoom: ${Math.round(info.zoom * 100)}%`;
    if (info.geometryTrust?.spacingSource) {
        bottomLeftText += ` | Spacing: ${info.geometryTrust.spacingSource}`;
    }
    const zoomWidth = ctx.measureText(bottomLeftText).width + padding * 2;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(padding, canvas.height - 30, zoomWidth, 20);
    ctx.fillStyle = '#fff';
    ctx.fillText(bottomLeftText, padding * 2, canvas.height - 16);

    // Bottom-right: Dimensions
    if (info.dimensions) {
        const dimText = `${info.dimensions.width} × ${info.dimensions.height}`;
        const dimWidth = ctx.measureText(dimText).width + padding * 2;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(canvas.width - dimWidth - padding, canvas.height - 30, dimWidth, 20);
        ctx.fillStyle = '#fff';
        ctx.fillText(dimText, canvas.width - dimWidth, canvas.height - 16);
    }

    // Draw measurements
    const transform = info.imageToCanvasTransform;
    if (transform) {
        const allMeasurements = [
            ...(info.measurements || []),
            ...(info.inProgressMeasurement ? [info.inProgressMeasurement] : [])
        ];

        for (const m of allMeasurements) {
            // Convert image coords to canvas coords
            const x1 = m.startX * transform.scale + transform.offsetX;
            const y1 = m.startY * transform.scale + transform.offsetY;
            const x2 = m.endX * transform.scale + transform.offsetX;
            const y2 = m.endY * transform.scale + transform.offsetY;

            // Draw line
            ctx.strokeStyle = '#00ff00';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();

            // Draw endpoints
            ctx.fillStyle = '#00ff00';
            ctx.beginPath();
            ctx.arc(x1, y1, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(x2, y2, 4, 0, Math.PI * 2);
            ctx.fill();

            // Calculate distance
            const dxPx = m.endX - m.startX;
            const dyPx = m.endY - m.startY;
            const distPx = Math.sqrt(dxPx * dxPx + dyPx * dyPx);

            // Build label
            let label = `${distPx.toFixed(1)} px`;
            let warning = '';

            // Calculate mm if spacing available
            if (info.pixelSpacing && info.pixelSpacing.length >= 2) {
                const rowSpacing = info.pixelSpacing[0];
                const colSpacing = info.pixelSpacing[1];
                const dxMm = dxPx * colSpacing;
                const dyMm = dyPx * rowSpacing;
                const distMm = Math.sqrt(dxMm * dxMm + dyMm * dyMm);

                const trustLevel = info.geometryTrust?.level;
                const spacingSource = info.geometryTrust?.spacingSource;

                if (trustLevel === 'untrusted') {
                    // Unsafe geometry - show px only with warning
                    warning = '⚠️ unsafe geometry';
                } else if (spacingSource === 'ImagerPixelSpacing') {
                    // ImagerPixelSpacing - show mm with warning
                    label = `${distMm.toFixed(1)} mm (${distPx.toFixed(0)} px)`;
                    warning = '⚠️ ImagerPixelSpacing';
                } else if (spacingSource === 'PixelSpacing') {
                    // Good PixelSpacing - show mm
                    label = `${distMm.toFixed(1)} mm`;
                } else {
                    // Unknown spacing
                    warning = '? unknown spacing';
                }
            } else {
                warning = 'no spacing data';
            }

            // Draw label background
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;
            const fullLabel = warning ? `${label} ${warning}` : label;

            ctx.font = '11px monospace';
            const labelWidth = ctx.measureText(fullLabel).width + 8;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
            ctx.fillRect(midX - labelWidth / 2, midY - 18, labelWidth, 16);

            // Draw label text
            ctx.fillStyle = warning ? '#ffcc00' : '#00ff00';
            ctx.textAlign = 'center';
            ctx.fillText(fullLabel, midX, midY - 6);
            ctx.textAlign = 'left';
        }
    }

    ctx.restore();
}
