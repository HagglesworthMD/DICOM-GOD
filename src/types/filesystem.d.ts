/**
 * Type definitions for File System Access API
 * These are not fully included in lib.dom.d.ts yet
 */

interface FileSystemHandle {
    readonly kind: 'file' | 'directory';
    readonly name: string;
    queryPermission?(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
    requestPermission?(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
}

interface FileSystemFileHandle extends FileSystemHandle {
    readonly kind: 'file';
    getFile(): Promise<File>;
}

interface FileSystemDirectoryHandle extends FileSystemHandle {
    readonly kind: 'directory';
    values(): AsyncIterableIterator<FileSystemHandle>;
    getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
    getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
}

interface Window {
    showDirectoryPicker(options?: {
        mode?: 'read' | 'readwrite';
    }): Promise<FileSystemDirectoryHandle>;
}

interface DataTransferItem {
    getAsFileSystemHandle?(): Promise<FileSystemHandle>;
}
