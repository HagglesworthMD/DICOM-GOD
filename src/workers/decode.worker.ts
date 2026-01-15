/**
 * Decode Worker
 * Handles pixel data decoding off the main thread
 */

import { decodePixelData, UnsupportedTransferSyntaxError } from '../core/pixelDecoder';
import type {
    DecodeWorkerRequest,
    DecodeWorkerResponse
} from '../core/types';

// Track current request for cancellation
let currentRequestId: string | null = null;

self.onmessage = async (event: MessageEvent<DecodeWorkerRequest>) => {
    const msg = event.data;

    switch (msg.type) {
        case 'DECODE':
            await handleDecode(msg);
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
        const frame = await decodePixelData(file, frameNumber);

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
