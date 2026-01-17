/**
 * Decode Bridge
 * Main thread interface for decode worker with cancellation
 */

import { createLogger } from './logger';
import { getFrameCache } from './frameCache';
import type {
    DecodeMosaicTileRequest,
    DecodeWorkerRequest,
    DecodeWorkerResponse,
    DecodedFrame,
    Instance
} from './types';

const log = createLogger('DecodeBridge');

type DecodeCallback = {
    resolve: (frame: DecodedFrame) => void;
    reject: (error: Error) => void;
};

let worker: Worker | null = null;
let pendingRequests = new Map<string, DecodeCallback>();
let requestCounter = 0;

// Track file handles by instance UID
let fileMap = new Map<string, File>();

/**
 * Initialize the decode worker
 */
function getWorker(): Worker {
    if (!worker) {
        worker = new Worker(
            new URL('../workers/decode.worker.ts', import.meta.url),
            { type: 'module' }
        );

        worker.onmessage = handleWorkerMessage;
        worker.onerror = handleWorkerError;

        log.info('Decode worker created');
    }
    return worker;
}

function handleWorkerMessage(event: MessageEvent<DecodeWorkerResponse>) {
    const msg = event.data;
    const pending = pendingRequests.get(msg.requestId);

    if (!pending) {
        log.debug(`Response for unknown request: ${msg.requestId}`);
        return;
    }

    pendingRequests.delete(msg.requestId);

    switch (msg.type) {
        case 'DECODED':
            // Cache the result
            getFrameCache().set(msg.instanceUid, msg.frameNumber, msg.frame);
            pending.resolve(msg.frame);
            break;
        case 'DECODED_MOSAIC_TILE':
            pending.resolve(msg.frame);
            break;

        case 'ERROR':
            pending.reject(new DecodeError(msg.error, msg.isUnsupported));
            break;

        case 'CANCELLED':
            pending.reject(new Error('Decode cancelled'));
            break;
    }
}

function handleWorkerError(event: ErrorEvent) {
    log.error('Worker error:', event.message);

    // Reject all pending requests
    for (const [, pending] of pendingRequests) {
        pending.reject(new Error(`Worker error: ${event.message}`));
    }
    pendingRequests.clear();
}

/**
 * Register file handles for instances
 */
export function registerInstanceFiles(instances: { instance: Instance; file: File }[]): void {
    for (const { instance, file } of instances) {
        fileMap.set(instance.sopInstanceUid, file);
    }
    log.debug(`Registered ${instances.length} instance files`);
}

/**
 * Clear registered files
 */
export function clearInstanceFiles(): void {
    fileMap.clear();
}

/**
 * Clear registered files for specific instances only
 * Used by multi-viewport to avoid clearing files from other viewports
 */
export function clearInstanceFilesForSeries(instanceUids: string[]): void {
    for (const uid of instanceUids) {
        fileMap.delete(uid);
    }
    log.debug(`Cleared ${instanceUids.length} instance files (selective)`);
}

/**
 * Get file for an instance
 */
export function getInstanceFile(instanceUid: string): File | undefined {
    return fileMap.get(instanceUid);
}

/**
 * Decode a frame with caching and cancellation
 */
export function decodeFrame(
    instance: Instance,
    frameNumber = 0
): Promise<DecodedFrame> {
    const cache = getFrameCache();

    // Check cache first
    const cached = cache.get(instance.sopInstanceUid, frameNumber);
    if (cached) {
        return Promise.resolve(cached);
    }

    // Get file
    const file = fileMap.get(instance.sopInstanceUid);
    if (!file) {
        return Promise.reject(new Error('File not found for instance'));
    }

    // Generate request ID
    const requestId = `decode-${++requestCounter}-${Date.now()}`;

    // Cancel previous requests for same instance (newest wins)
    for (const [id,] of pendingRequests) {
        if (id.includes(instance.sopInstanceUid)) {
            cancelRequest(id);
        }
    }

    return new Promise((resolve, reject) => {
        pendingRequests.set(requestId, { resolve, reject });

        const w = getWorker();
        const msg: DecodeWorkerRequest = {
            type: 'DECODE',
            requestId,
            file,
            instanceUid: instance.sopInstanceUid,
            frameNumber,
        };

        w.postMessage(msg);
    });
}

/**
 * Decode a mosaic tile (UI-only, does not affect dataset frame semantics)
 */
export function decodeMosaicTile(
    instance: Instance,
    tileIndex: number,
    rows: number,
    cols: number,
    tileCount: number,
    frameNumber = 0
): { requestId: string; promise: Promise<DecodedFrame> } {
    const file = fileMap.get(instance.sopInstanceUid);
    const requestId = `mosaic-${++requestCounter}-${Date.now()}`;

    if (!file) {
        return {
            requestId,
            promise: Promise.reject(new Error('File not found for instance')),
        };
    }

    const promise = new Promise<DecodedFrame>((resolve, reject) => {
        pendingRequests.set(requestId, { resolve, reject });

        const w = getWorker();
        const msg: DecodeMosaicTileRequest = {
            type: 'DECODE_MOSAIC_TILE',
            requestId,
            file,
            instanceUid: instance.sopInstanceUid,
            frameNumber,
            tileIndex,
            rows,
            cols,
            tileCount,
        };

        w.postMessage(msg);
    });

    return { requestId, promise };
}

/**
 * Cancel a pending decode request
 */
export function cancelRequest(requestId: string): void {
    const pending = pendingRequests.get(requestId);
    if (!pending) return;

    const w = getWorker();
    w.postMessage({ type: 'CANCEL', requestId });

    pending.reject(new Error('Decode cancelled'));
    pendingRequests.delete(requestId);
}

/**
 * Cancel all pending requests
 */
export function cancelAllRequests(): void {
    for (const requestId of pendingRequests.keys()) {
        cancelRequest(requestId);
    }
}

/**
 * Terminate the decode worker
 */
export function terminateDecodeWorker(): void {
    if (worker) {
        worker.terminate();
        worker = null;
        pendingRequests.clear();
        log.info('Decode worker terminated');
    }
}

/**
 * Custom error for decode failures
 */
export class DecodeError extends Error {
    isUnsupported: boolean;

    constructor(message: string, isUnsupported = false) {
        super(message);
        this.name = 'DecodeError';
        this.isUnsupported = isUnsupported;
    }
}
