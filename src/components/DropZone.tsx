/**
 * DropZone component - crash-safe drag and drop
 * Does not freeze UI - handles large file lists gracefully
 */

import { useState, useCallback, useRef, type DragEvent } from 'react';
import { createLogger } from '../core/logger';
import type { FileEntry } from '../core/types';
import './DropZone.css';

const log = createLogger('DropZone');

// Extensions to skip (obvious non-DICOM files: images, videos, documents, archives, code)
const SKIP_EXTENSIONS = /\.(jpe?g|png|gif|bmp|webp|tiff?|heic|svg|ico|pdf|txt|json|xml|html?|css|js|ts|md|log|mp4|avi|mov|mkv|wmv|flv|webm|mp3|wav|ogg|aac|zip|tar|gz|rar|7z|exe|dll|so|dylib|py|rb|java|class|jar)$/i;

interface DropZoneProps {
    onFiles: (files: FileEntry[]) => void;
    disabled?: boolean;
    children: React.ReactNode;
    className?: string;
}

export function DropZone({ onFiles, disabled, children, className = '' }: DropZoneProps) {
    const [isDragOver, setIsDragOver] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const dragCounter = useRef(0);

    const handleDragEnter = useCallback(
        (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (disabled) return;
            dragCounter.current++;
            if (e.dataTransfer?.items?.length) {
                setIsDragOver(true);
            }
        },
        [disabled]
    );

    const handleDragLeave = useCallback((e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter.current--;
        if (dragCounter.current === 0) {
            setIsDragOver(false);
        }
    }, []);

    const handleDragOver = useCallback((e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const handleDrop = useCallback(
        async (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            dragCounter.current = 0;
            setIsDragOver(false);

            if (disabled) return;

            const items = e.dataTransfer?.items;
            if (!items?.length) return;

            setIsProcessing(true);
            log.info(`Processing ${items.length} dropped items`);

            try {
                const files: FileEntry[] = [];

                // Process items in chunks to avoid UI freeze
                const processItem = async (item: DataTransferItem): Promise<void> => {
                    if (item.kind !== 'file') return;

                    // Try to get as FileSystemHandle for folder support
                    if ('getAsFileSystemHandle' in item) {
                        try {
                            // @ts-expect-error - getAsFileSystemHandle not in types
                            const handle = await item.getAsFileSystemHandle();
                            if (handle.kind === 'directory') {
                                await processDirectory(handle as FileSystemDirectoryHandle, files);
                                return;
                            }
                        } catch {
                            // Fall back to getAsFile
                        }
                    }

                    const file = item.getAsFile();
                    if (file) {
                        // Skip obvious non-DICOM files by extension
                        if (SKIP_EXTENSIONS.test(file.name)) return;
                        files.push({
                            name: file.name,
                            size: file.size,
                            file,
                            fileKey: crypto.randomUUID(),
                        });
                    }
                };

                // Process recursively with yielding to main thread
                async function processDirectory(
                    handle: FileSystemDirectoryHandle,
                    results: FileEntry[],
                    path = ''
                ) {
                    for await (const entry of handle.values()) {
                        // Yield to main thread every 100 files
                        if (results.length % 100 === 0) {
                            await new Promise((r) => setTimeout(r, 0));
                        }

                        const entryPath = path ? `${path}/${entry.name}` : entry.name;
                        if (entry.kind === 'file') {
                            // Skip obvious non-DICOM files by extension
                            if (SKIP_EXTENSIONS.test(entry.name)) continue;
                            const fileHandle = entry as FileSystemFileHandle;
                            const file = await fileHandle.getFile();
                            results.push({
                                name: entry.name,
                                size: file.size,
                                path: entryPath,
                                file,
                                fileKey: entryPath,
                            });
                        } else if (entry.kind === 'directory') {
                            await processDirectory(entry as FileSystemDirectoryHandle, results, entryPath);
                        }
                    }
                }

                // Process items
                const itemArray = Array.from(items);
                for (const item of itemArray) {
                    await processItem(item);
                    // Yield between items
                    await new Promise((r) => setTimeout(r, 0));
                }

                log.info(`Processed ${files.length} files`);
                onFiles(files);
            } catch (err) {
                log.error('Drop processing error:', err);
            } finally {
                setIsProcessing(false);
            }
        },
        [disabled, onFiles]
    );

    return (
        <div
            className={`dropzone ${isDragOver ? 'dropzone--active' : ''} ${isProcessing ? 'dropzone--processing' : ''
                } ${disabled ? 'dropzone--disabled' : ''} ${className}`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            {children}
            {isDragOver && (
                <div className="dropzone__overlay">
                    <div className="dropzone__overlay-content">
                        <span className="dropzone__overlay-icon">📁</span>
                        <span>Drop files or folders here</span>
                    </div>
                </div>
            )}
            {isProcessing && (
                <div className="dropzone__overlay dropzone__overlay--processing">
                    <div className="dropzone__overlay-content">
                        <span className="dropzone__spinner" />
                        <span>Processing files...</span>
                    </div>
                </div>
            )}
        </div>
    );
}
