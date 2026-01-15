/**
 * FolderPicker component - uses File System Access API if available
 * Persists folder handle in IndexedDB for restore on reload
 */

import { useState, useCallback, useEffect } from 'react';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { createLogger } from '../core/logger';
import {
    storeFolderHandle,
    getStoredFolderHandle,
    clearStoredFolderHandle,
    verifyFolderPermission,
    isIndexedDBSupported,
} from '../core/folderStorage';
import { useAppDispatch } from '../state/store';
import type { FileEntry } from '../core/types';
import './FolderPicker.css';

const log = createLogger('FolderPicker');

interface FolderPickerProps {
    onFilesSelected: (files: FileEntry[]) => void;
    disabled?: boolean;
}

// Check if File System Access API is available
const isFileSystemAccessSupported = 'showDirectoryPicker' in window;

// Extensions to skip (obvious non-DICOM images)
const SKIP_EXTENSIONS = /\.(jpe?g|png|gif|bmp|webp|tiff?|heic|svg|ico|pdf|txt|json|xml|html?|css|js|ts|md|log)$/i;

export function FolderPicker({ onFilesSelected, disabled }: FolderPickerProps) {
    const [showUnsupportedModal, setShowUnsupportedModal] = useState(false);
    const [showPermissionModal, setShowPermissionModal] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [pendingHandle, setPendingHandle] = useState<FileSystemDirectoryHandle | null>(null);
    const dispatch = useAppDispatch();

    // Check for stored folder on mount
    useEffect(() => {
        checkStoredFolder();
    }, []);

    const checkStoredFolder = async () => {
        if (!isFileSystemAccessSupported || !isIndexedDBSupported()) {
            return;
        }

        try {
            const stored = await getStoredFolderHandle();
            if (stored) {
                log.info(`Found stored folder: ${stored.name}`);
                dispatch({
                    type: 'SET_STORED_FOLDER',
                    hasFolder: true,
                    name: stored.name
                });

                // Check if we still have permission (without prompting)
                const verifiedHandle = await verifyFolderPermission(stored.handle, false);
                if (verifiedHandle) {
                    log.info('Permission still granted, auto-loading folder');
                    await scanFolder(verifiedHandle);
                } else {
                    log.info('Permission not granted, will prompt on user action');
                    setPendingHandle(stored.handle);
                }
            }
        } catch (err) {
            log.error('Error checking stored folder:', err);
        }
    };

    const scanFolder = async (handle: FileSystemDirectoryHandle) => {
        setIsLoading(true);

        try {
            const files: FileEntry[] = [];

            async function readDir(dirHandle: FileSystemDirectoryHandle, path = '') {
                for await (const entry of dirHandle.values()) {
                    const entryPath = path ? `${path}/${entry.name}` : entry.name;
                    if (entry.kind === 'file') {
                        // Skip obvious non-DICOM files by extension
                        if (SKIP_EXTENSIONS.test(entry.name)) continue;
                        const fileHandle = entry as FileSystemFileHandle;
                        const file = await fileHandle.getFile();
                        files.push({
                            name: entry.name,
                            size: file.size,
                            path: entryPath,
                            file,
                            fileKey: entryPath, // Use path as unique key for folder mode
                            handle: fileHandle,
                        });
                    } else if (entry.kind === 'directory') {
                        await readDir(entry as FileSystemDirectoryHandle, entryPath);
                    }
                }
            }

            await readDir(handle);
            log.info(`Scanned folder with ${files.length} files`);

            // Store the handle for future sessions
            await storeFolderHandle(handle);
            dispatch({
                type: 'SET_STORED_FOLDER',
                hasFolder: true,
                name: handle.name
            });

            onFilesSelected(files);
        } catch (err) {
            log.error('Folder scan error:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleClick = useCallback(async () => {
        // If we have a pending handle that needs permission
        if (pendingHandle) {
            setShowPermissionModal(true);
            return;
        }

        if (!isFileSystemAccessSupported) {
            setShowUnsupportedModal(true);
            return;
        }

        setIsLoading(true);
        try {
            const dirHandle = await window.showDirectoryPicker({
                mode: 'read',
            });

            await scanFolder(dirHandle);
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                log.debug('Folder picker cancelled');
            } else {
                log.error('Folder picker error:', err);
            }
        } finally {
            setIsLoading(false);
        }
    }, [pendingHandle, onFilesSelected]);

    const handleRequestPermission = async () => {
        if (!pendingHandle) return;

        setShowPermissionModal(false);
        setIsLoading(true);

        try {
            const verifiedHandle = await verifyFolderPermission(pendingHandle, true);
            if (verifiedHandle) {
                await scanFolder(verifiedHandle);
                setPendingHandle(null);
            } else {
                log.warn('Permission denied for stored folder');
                // Clear the stored handle since we can't use it
                await clearStoredFolderHandle();
                dispatch({
                    type: 'SET_STORED_FOLDER',
                    hasFolder: false,
                    name: null
                });
                setPendingHandle(null);
            }
        } catch (err) {
            log.error('Permission request error:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleForgetFolder = async () => {
        try {
            await clearStoredFolderHandle();
            dispatch({
                type: 'SET_STORED_FOLDER',
                hasFolder: false,
                name: null
            });
            setPendingHandle(null);
            log.info('Cleared stored folder');
        } catch (err) {
            log.error('Error clearing folder:', err);
        }
        setShowPermissionModal(false);
    };

    return (
        <>
            <Button
                onClick={handleClick}
                disabled={disabled || isLoading}
                className="folder-picker-btn"
            >
                <Icon name="folder" size={18} />
                {isLoading ? 'Reading...' : pendingHandle ? 'Restore Folder' : 'Open Folder'}
            </Button>

            <Modal
                isOpen={showUnsupportedModal}
                onClose={() => setShowUnsupportedModal(false)}
                title="Folder Picker Not Supported"
            >
                <p>
                    Your browser does not support the File System Access API required for the folder picker.
                </p>
                <p>
                    <strong>Alternatives:</strong>
                </p>
                <ul>
                    <li>Use Chrome, Edge, or another Chromium-based browser</li>
                    <li>Drag and drop DICOM files directly onto the app</li>
                </ul>
                <p className="modal-note">
                    Note: For security reasons, web apps cannot automatically access files on your computer.
                    You must manually select or drop files.
                </p>
            </Modal>

            <Modal
                isOpen={showPermissionModal}
                onClose={() => setShowPermissionModal(false)}
                title="Restore Previous Folder?"
            >
                <p>
                    You previously opened a folder in this app. Would you like to restore access to it?
                </p>
                <p className="modal-note">
                    Your browser will ask for permission to access the folder.
                </p>
                <div className="modal-actions">
                    <Button variant="primary" onClick={handleRequestPermission}>
                        Grant Access
                    </Button>
                    <Button variant="secondary" onClick={handleForgetFolder}>
                        Forget Folder
                    </Button>
                </div>
            </Modal>
        </>
    );
}
