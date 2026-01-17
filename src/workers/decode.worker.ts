/**
 * Decode Worker
 * Handles pixel data decoding off the main thread
 */

import { decodePixelData, UnsupportedTransferSyntaxError } from '../core/pixelDecoder';
import { computeMosaicTileRect, extractPixelRegion } from '../core/mosaic';
import type {
    DecodeWorkerRequest,
    DecodeWorkerResponse,
    DecodedFrame,
    DecodeMosaicTileRequest
} from '../core/types';

// Track current request for cancellation
let currentRequestId: string | null = null;

const FULL_FRAME_CACHE_MAX = 2;
const fullFrameCache = new Map<string, DecodedFrame>();

function frameCacheKey(instanceUid: string, frameNumber: number): string {
    return `${instanceUid}:${frameNumber}`;
}

function getCachedFrame(instanceUid: string, frameNumber: number): DecodedFrame | null {
    const key = frameCacheKey(instanceUid, frameNumber);
    const cached = fullFrameCache.get(key);
    if (!cached) return null;
    // Refresh LRU order
    fullFrameCache.delete(key);
    fullFrameCache.set(key, cached);
    return cached;
}

function setCachedFrame(instanceUid: string, frameNumber: number, frame: DecodedFrame): void {
    const key = frameCacheKey(instanceUid, frameNumber);
    if (fullFrameCache.has(key)) {
        fullFrameCache.delete(key);
    } else if (fullFrameCache.size >= FULL_FRAME_CACHE_MAX) {
        const oldestKey = fullFrameCache.keys().next().value;
        if (oldestKey) {
            fullFrameCache.delete(oldestKey);
        }
    }
    fullFrameCache.set(key, frame);
}

self.onmessage = async (event: MessageEvent<DecodeWorkerRequest>) => {
    const msg = event.data;

    switch (msg.type) {
        case 'DECODE':
            await handleDecode(msg);
            break;
        case 'DECODE_MOSAIC_TILE':
            await handleDecodeMosaicTile(msg);
            break;
        case 'CANCEL':
            if (msg.requestId === currentRequestId) {
                currentRequestId = null;
                sendResponse({ type: 'CANCELLED', requestId: msg.requestId });
            }
            break;
    }
};

function sendResponse(msg: DecodeWorkerResponse) {
    self.postMessage(msg);
}

async function handleDecode(msg: DecodeWorkerRequest & { type: 'DECODE' }) {
    const { requestId, file, instanceUid, frameNumber } = msg;
    currentRequestId = requestId;

    try {
        let frame = getCachedFrame(instanceUid, frameNumber);
        if (!frame) {
            frame = await decodePixelData(file, frameNumber);
            setCachedFrame(instanceUid, frameNumber, frame);
        }

        // Check if cancelled
        if (currentRequestId !== requestId) {
            return;
        }



        sendResponse({
            type: 'DECODED',
            requestId,
            instanceUid,
            frameNumber,
            frame,
        });
    } catch (err) {
        if (currentRequestId !== requestId) return;

        const isUnsupported = err instanceof UnsupportedTransferSyntaxError;
        const errorMsg = err instanceof Error ? err.message : 'Decode failed';



        sendResponse({
            type: 'ERROR',
            requestId,
            instanceUid,
            error: errorMsg,
            isUnsupported,
        });
    } finally {
        if (currentRequestId === requestId) {
            currentRequestId = null;
        }
    }
}

async function handleDecodeMosaicTile(msg: DecodeMosaicTileRequest) {
    const { requestId, file, instanceUid, frameNumber, tileIndex, rows, cols, tileCount } = msg;
    currentRequestId = requestId;

    try {
        let frame = getCachedFrame(instanceUid, frameNumber);
        if (!frame) {
            frame = await decodePixelData(file, frameNumber);
            setCachedFrame(instanceUid, frameNumber, frame);
        }

        if (currentRequestId !== requestId) {
            return;
        }

        const safeTileIndex = Math.max(0, Math.min(tileIndex, Math.max(0, tileCount - 1)));
        const rect = computeMosaicTileRect(frame.width, frame.height, rows, cols, safeTileIndex);
        const region = extractPixelRegion(
            frame.pixelData,
            frame.width,
            frame.height,
            frame.samplesPerPixel,
            rect
        );

        const tileFrame: DecodedFrame = {
            pixelData: region.pixelData,
            width: region.width,
            height: region.height,
            bitsStored: frame.bitsStored,
            isSigned: frame.isSigned,
            minValue: region.minValue,
            maxValue: region.maxValue,
            rescaleSlope: frame.rescaleSlope,
            rescaleIntercept: frame.rescaleIntercept,
            windowCenter: frame.windowCenter,
            windowWidth: frame.windowWidth,
            windowProvided: frame.windowProvided,
            photometricInterpretation: frame.photometricInterpretation,
            samplesPerPixel: frame.samplesPerPixel,
        };

        sendResponse({
            type: 'DECODED_MOSAIC_TILE',
            requestId,
            instanceUid,
            frameNumber,
            tileIndex: safeTileIndex,
            frame: tileFrame,
        });
    } catch (err) {
        if (currentRequestId !== requestId) return;

        const isUnsupported = err instanceof UnsupportedTransferSyntaxError;
        const errorMsg = err instanceof Error ? err.message : 'Decode failed';

        sendResponse({
            type: 'ERROR',
            requestId,
            instanceUid,
            error: errorMsg,
            isUnsupported,
        });
    } finally {
        if (currentRequestId === requestId) {
            currentRequestId = null;
        }
    }
}
