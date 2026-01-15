/**
 * Local-only mode: best-effort network kill switch
 * Patches global fetch, WebSocket, EventSource, navigator.sendBeacon
 */

import { createLogger } from './logger';

const log = createLogger('LocalOnly');

interface OriginalAPIs {
    fetch: typeof globalThis.fetch;
    WebSocket: typeof globalThis.WebSocket;
    EventSource: typeof globalThis.EventSource | undefined;
    sendBeacon: typeof navigator.sendBeacon | undefined;
}

let originals: OriginalAPIs | null = null;
let isLocked = false;
let patchWarnings: string[] = [];

function blockedFetch(): Promise<Response> {
    const err = new Error('Network request blocked: Local-only mode is enabled');
    log.warn('Blocked fetch request');
    return Promise.reject(err);
}

class BlockedWebSocket {
    constructor() {
        throw new Error('WebSocket blocked: Local-only mode is enabled');
    }
}

class BlockedEventSource {
    constructor() {
        throw new Error('EventSource blocked: Local-only mode is enabled');
    }
}

function blockedSendBeacon(): boolean {
    log.warn('Blocked sendBeacon request');
    return false;
}

export function enableLocalOnlyMode(): string[] {
    if (isLocked) {
        log.info('Local-only mode already enabled');
        return patchWarnings;
    }

    patchWarnings = [];

    // Save originals
    originals = {
        fetch: globalThis.fetch,
        WebSocket: globalThis.WebSocket,
        EventSource: globalThis.EventSource,
        sendBeacon: navigator.sendBeacon?.bind(navigator),
    };

    // Patch fetch
    try {
        globalThis.fetch = blockedFetch;
    } catch {
        patchWarnings.push('Could not patch fetch');
    }

    // Patch WebSocket
    try {
        // @ts-expect-error - intentionally replacing with blocking class
        globalThis.WebSocket = BlockedWebSocket;
    } catch {
        patchWarnings.push('Could not patch WebSocket');
    }

    // Patch EventSource
    try {
        if (globalThis.EventSource) {
            // @ts-expect-error - intentionally replacing with blocking class
            globalThis.EventSource = BlockedEventSource;
        }
    } catch {
        patchWarnings.push('Could not patch EventSource');
    }

    // Patch sendBeacon
    try {
        if (navigator.sendBeacon) {
            navigator.sendBeacon = blockedSendBeacon;
        }
    } catch {
        patchWarnings.push('Could not patch sendBeacon');
    }

    isLocked = true;
    log.info('Local-only mode enabled', { warnings: patchWarnings });

    return patchWarnings;
}

export function disableLocalOnlyMode(): void {
    if (!isLocked || !originals) {
        log.info('Local-only mode not enabled');
        return;
    }

    // Restore originals
    try {
        globalThis.fetch = originals.fetch;
    } catch {
        log.warn('Could not restore fetch');
    }

    try {
        globalThis.WebSocket = originals.WebSocket;
    } catch {
        log.warn('Could not restore WebSocket');
    }

    try {
        if (originals.EventSource) {
            globalThis.EventSource = originals.EventSource;
        }
    } catch {
        log.warn('Could not restore EventSource');
    }

    try {
        if (originals.sendBeacon) {
            navigator.sendBeacon = originals.sendBeacon;
        }
    } catch {
        log.warn('Could not restore sendBeacon');
    }

    originals = null;
    isLocked = false;
    patchWarnings = [];
    log.info('Local-only mode disabled');
}

export function isLocalOnlyMode(): boolean {
    return isLocked;
}

export function getLocalModeWarnings(): string[] {
    return [...patchWarnings];
}
