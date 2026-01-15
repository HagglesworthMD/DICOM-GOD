/**
 * IPC bridge for worker communication
 * Provides type-safe message passing with cancellation support
 */

import { createLogger } from './logger';
import type { WorkerRequest, WorkerResponse, FileEntry, Study, IndexProgress } from './types';

const log = createLogger('IPC');

export interface WorkerBridge {
    /** Start indexing files */
    startIndexing(
        files: FileEntry[],
        callbacks: IndexingCallbacks
    ): IndexingJob;

    /** Terminate the worker */
    terminate(): void;
}

export interface IndexingCallbacks {
    onProgress: (progress: IndexProgress) => void;
    onStudyUpdate: (study: Study) => void;
    onComplete: (studies: Study[], progress: IndexProgress) => void;
    onError: (error: string) => void;
    onCancelled: () => void;
}

export interface IndexingJob {
    requestId: string;
    cancel: () => void;
}

let workerInstance: Worker | null = null;
let activeJobs = new Map<string, IndexingCallbacks>();

/**
 * Create or get the metadata worker instance
 */
function getWorker(): Worker {
    if (!workerInstance) {
        workerInstance = new Worker(
            new URL('../workers/metadata.worker.ts', import.meta.url),
            { type: 'module' }
        );

        workerInstance.onmessage = handleWorkerMessage;
        workerInstance.onerror = handleWorkerError;

        log.info('Metadata worker created');
    }

    return workerInstance;
}

/**
 * Handle messages from the worker
 */
function handleWorkerMessage(event: MessageEvent<WorkerResponse>) {
    const msg = event.data;
    const callbacks = activeJobs.get(msg.requestId);

    if (!callbacks) {
        log.warn(`Received message for unknown job: ${msg.requestId}`);
        return;
    }

    switch (msg.type) {
        case 'PROGRESS':
            callbacks.onProgress(msg.progress);
            break;

        case 'STUDY_UPDATE':
            callbacks.onStudyUpdate(msg.study);
            break;

        case 'COMPLETE':
            callbacks.onComplete(msg.studies, msg.progress);
            activeJobs.delete(msg.requestId);
            log.debug(`Job ${msg.requestId} completed`);
            break;

        case 'ERROR':
            callbacks.onError(msg.error);
            activeJobs.delete(msg.requestId);
            log.error(`Job ${msg.requestId} error:`, msg.error);
            break;

        case 'CANCELLED':
            callbacks.onCancelled();
            activeJobs.delete(msg.requestId);
            log.debug(`Job ${msg.requestId} cancelled`);
            break;
    }
}

/**
 * Handle worker errors
 */
function handleWorkerError(event: ErrorEvent) {
    log.error('Worker error:', event.message);

    // Notify all active jobs
    for (const [requestId, callbacks] of activeJobs) {
        callbacks.onError(`Worker error: ${event.message}`);
        activeJobs.delete(requestId);
    }
}

/**
 * Generate unique request ID
 */
function generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Create the worker bridge
 */
export function createWorkerBridge(): WorkerBridge {
    return {
        startIndexing(files: FileEntry[], callbacks: IndexingCallbacks): IndexingJob {
            const worker = getWorker();
            const requestId = generateRequestId();

            // Cancel any existing jobs first
            for (const [existingId] of activeJobs) {
                log.info(`Cancelling existing job ${existingId} before starting new one`);
                const cancelMsg: WorkerRequest = { type: 'CANCEL', requestId: existingId };
                worker.postMessage(cancelMsg);
            }

            // Register callbacks
            activeJobs.set(requestId, callbacks);

            // Start the job
            const msg: WorkerRequest = {
                type: 'START_INDEX',
                requestId,
                files,
            };

            worker.postMessage(msg);
            log.info(`Started indexing job ${requestId} with ${files.length} files`);

            return {
                requestId,
                cancel: () => {
                    const cancelMsg: WorkerRequest = { type: 'CANCEL', requestId };
                    worker.postMessage(cancelMsg);
                    log.debug(`Sent cancel for job ${requestId}`);
                },
            };
        },

        terminate() {
            if (workerInstance) {
                workerInstance.terminate();
                workerInstance = null;
                activeJobs.clear();
                log.info('Worker terminated');
            }
        },
    };
}

/**
 * Check if workers are supported
 */
export function isWorkerSupported(): boolean {
    return typeof Worker !== 'undefined';
}
