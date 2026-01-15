/**
 * IndexedDB wrapper for persisting folder handles
 * Handles storage and retrieval of FileSystemDirectoryHandle
 */

import { createLogger } from './logger';
import type { StoredFolderHandle } from './types';

const log = createLogger('FolderStorage');

const DB_NAME = 'dicom-god-db';
const DB_VERSION = 1;
const STORE_NAME = 'folder-handles';
const LAST_FOLDER_KEY = 'last-folder';

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Open/create the IndexedDB database
 */
function openDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            log.error('Failed to open IndexedDB:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            log.debug('IndexedDB opened successfully');
            resolve(request.result);
        };

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;

            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                log.info('Created folder-handles object store');
            }
        };
    });

    return dbPromise;
}

/**
 * Store a folder handle in IndexedDB
 */
export async function storeFolderHandle(
    handle: FileSystemDirectoryHandle
): Promise<void> {
    try {
        const db = await openDB();

        const stored: StoredFolderHandle = {
            id: LAST_FOLDER_KEY,
            handle,
            name: handle.name,
            lastAccessed: Date.now(),
        };

        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.put(stored);

            request.onsuccess = () => {
                log.info(`Stored folder handle: ${handle.name}`);
                resolve();
            };

            request.onerror = () => {
                log.error('Failed to store folder handle:', request.error);
                reject(request.error);
            };
        });
    } catch (err) {
        log.error('Error storing folder handle:', err);
        throw err;
    }
}

/**
 * Retrieve the last stored folder handle
 */
export async function getStoredFolderHandle(): Promise<StoredFolderHandle | null> {
    try {
        const db = await openDB();

        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.get(LAST_FOLDER_KEY);

            request.onsuccess = () => {
                const result = request.result as StoredFolderHandle | undefined;
                if (result) {
                    log.debug(`Retrieved stored folder: ${result.name}`);
                } else {
                    log.debug('No stored folder handle found');
                }
                resolve(result ?? null);
            };

            request.onerror = () => {
                log.error('Failed to retrieve folder handle:', request.error);
                reject(request.error);
            };
        });
    } catch (err) {
        log.error('Error retrieving folder handle:', err);
        return null;
    }
}

/**
 * Clear the stored folder handle
 */
export async function clearStoredFolderHandle(): Promise<void> {
    try {
        const db = await openDB();

        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.delete(LAST_FOLDER_KEY);

            request.onsuccess = () => {
                log.info('Cleared stored folder handle');
                resolve();
            };

            request.onerror = () => {
                log.error('Failed to clear folder handle:', request.error);
                reject(request.error);
            };
        });
    } catch (err) {
        log.error('Error clearing folder handle:', err);
        throw err;
    }
}

/**
 * Check if we have permission to access a stored handle
 * Returns the handle if permission granted, null otherwise
 */
export async function verifyFolderPermission(
    handle: FileSystemDirectoryHandle,
    requestPermission = false
): Promise<FileSystemDirectoryHandle | null> {
    try {
        // Query current permission state
        const opts = { mode: 'read' as const };
        let permission = await handle.queryPermission?.(opts);

        if (permission === 'granted') {
            log.debug('Permission already granted for folder');
            return handle;
        }

        if (requestPermission && permission === 'prompt') {
            // Request permission - requires user gesture
            permission = await handle.requestPermission?.(opts);

            if (permission === 'granted') {
                log.info('Permission granted for folder');
                return handle;
            }
        }

        log.info(`Permission not granted: ${permission}`);
        return null;
    } catch (err) {
        log.error('Error checking folder permission:', err);
        return null;
    }
}

/**
 * Check if IndexedDB is available
 */
export function isIndexedDBSupported(): boolean {
    return typeof indexedDB !== 'undefined';
}
