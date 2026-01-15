/**
 * Core types for DICOM God viewer
 * Step 3: Pixel decoding and rendering types
 */

// ============================================================================
// File Entry (raw file before parsing)
// ============================================================================

/** Represents a dropped/selected file (not yet parsed) */
export interface FileEntry {
    name: string;
    size: number;
    path?: string;
    file: File;
    /** Unique key for file registry lookup */
    fileKey: FileKey;
    handle?: FileSystemFileHandle;
}

// ============================================================================
// File Registry (first-class file mapping)
// ============================================================================

/** Stable key for file registry lookup */
export type FileKey = string;

/** Registry entry - either a handle (folder mode) or File (drag/drop mode) */
export type FileRegistryEntry =
    | { kind: 'handle'; handle: FileSystemFileHandle; name: string; size?: number }
    | { kind: 'file'; file: File; name: string; size: number };

/** Map of fileKey -> actual file/handle */
export type FileRegistry = Map<FileKey, FileRegistryEntry>;

// ============================================================================
// DICOM Data Model
// ============================================================================

/** Geometry trust level with reasons */
export type GeometryTrust = 'unknown' | 'untrusted' | 'trusted' | 'verified';

export interface GeometryTrustInfo {
    level: GeometryTrust;
    reasons: string[];
}

/** DICOM Study - top level grouping */
export interface Study {
    studyInstanceUid: string;
    description: string;
    date?: string;
    time?: string;
    patientName?: string;
    patientId?: string;
    accessionNumber?: string;
    series: Series[];
}

/** DICOM Series - group of related instances */
export interface Series {
    seriesInstanceUid: string;
    studyInstanceUid: string;
    description: string;
    seriesNumber: number | null;
    modality: string;
    instances: Instance[];
    geometryTrust: GeometryTrust;
    geometryTrustInfo?: GeometryTrustInfo;
}

/** DICOM Instance - single image/object */
export interface Instance {
    sopInstanceUid: string;
    seriesInstanceUid: string;
    instanceNumber: number | null;

    /** Stable key for resolving to actual File via FileRegistry */
    fileKey: FileKey;

    /** Original file path (for display only, not for lookup) */
    filePath: string;
    fileSize: number;

    // Geometry
    imageOrientationPatient?: string;
    imagePositionPatient?: string;
    pixelSpacing?: string;
    rows?: number;
    columns?: number;

    // Pixel format
    bitsAllocated?: number;
    bitsStored?: number;
    highBit?: number;
    pixelRepresentation?: number;
    transferSyntaxUid?: string;
    photometricInterpretation?: string;

    // Windowing defaults
    windowCenter?: number;
    windowWidth?: number;
    rescaleSlope?: number;
    rescaleIntercept?: number;

    // Multi-frame
    samplesPerPixel?: number;
    numberOfFrames?: number;
}

// ============================================================================
// Pixel Data Types (Step 3)
// ============================================================================

/** Decoded frame with pixel data ready for display */
export interface DecodedFrame {
    /** Raw pixel values (after decoding, before VOI) */
    pixelData: Int16Array | Uint16Array | Uint8Array;
    /** Image width */
    width: number;
    /** Image height */
    height: number;
    /** Bits stored per pixel */
    bitsStored: number;
    /** Whether pixels are signed */
    isSigned: boolean;
    /** Min value in pixel data */
    minValue: number;
    /** Max value in pixel data */
    maxValue: number;
    /** Rescale slope for Hounsfield/real values */
    rescaleSlope: number;
    /** Rescale intercept */
    rescaleIntercept: number;
    /** Default window center */
    windowCenter: number;
    /** Default window width */
    windowWidth: number;
    /** Photometric interpretation */
    photometricInterpretation: string;
    /** Samples per pixel (1=grayscale, 3=RGB) */
    samplesPerPixel: number;
}

/** Supported transfer syntaxes */
export const SUPPORTED_TRANSFER_SYNTAXES = {
    IMPLICIT_VR_LE: '1.2.840.10008.1.2',
    EXPLICIT_VR_LE: '1.2.840.10008.1.2.1',
    RLE_LOSSLESS: '1.2.840.10008.1.2.5',
} as const;

export type SupportedTransferSyntax = typeof SUPPORTED_TRANSFER_SYNTAXES[keyof typeof SUPPORTED_TRANSFER_SYNTAXES];

export function isTransferSyntaxSupported(ts?: string): ts is SupportedTransferSyntax {
    if (!ts) return false;
    return Object.values(SUPPORTED_TRANSFER_SYNTAXES).includes(ts as SupportedTransferSyntax);
}

// ============================================================================
// Viewport State
// ============================================================================

export interface ViewportState {
    /** Current frame index in series */
    frameIndex: number;
    /** Window center (Hounsfield or raw) */
    windowCenter: number;
    /** Window width */
    windowWidth: number;
    /** Zoom factor (1 = fit to viewport) */
    zoom: number;
    /** Pan offset X */
    panX: number;
    /** Pan offset Y */
    panY: number;
    /** Invert grayscale */
    invert: boolean;
    /** Is cine playing */
    isPlaying: boolean;
    /** Cine FPS */
    cineFrameRate: number;
}

export const DEFAULT_VIEWPORT_STATE: ViewportState = {
    frameIndex: 0,
    windowCenter: 40,
    windowWidth: 400,
    zoom: 1,
    panX: 0,
    panY: 0,
    invert: false,
    isPlaying: false,
    cineFrameRate: 15,
};

// ============================================================================
// Decode Worker Messages
// ============================================================================

/** Request to decode a frame */
export interface DecodeRequest {
    type: 'DECODE';
    requestId: string;
    file: File;
    instanceUid: string;
    frameNumber: number;
}

/** Cancel decode request */
export interface CancelDecodeRequest {
    type: 'CANCEL';
    requestId: string;
}

export type DecodeWorkerRequest = DecodeRequest | CancelDecodeRequest;

export interface DecodeSuccess {
    type: 'DECODED';
    requestId: string;
    instanceUid: string;
    frameNumber: number;
    frame: DecodedFrame;
}

export interface DecodeError {
    type: 'ERROR';
    requestId: string;
    instanceUid: string;
    error: string;
    isUnsupported?: boolean;
}

export interface DecodeCancelled {
    type: 'CANCELLED';
    requestId: string;
}

export type DecodeWorkerResponse = DecodeSuccess | DecodeError | DecodeCancelled;

// ============================================================================
// Indexing Progress
// ============================================================================

export type IndexingPhase = 'idle' | 'scanning' | 'parsing' | 'complete' | 'error' | 'cancelled';

export interface IndexProgress {
    phase: IndexingPhase;
    totalFiles: number;
    processedFiles: number;
    dicomFiles: number;
    skippedFiles: number;
    errorFiles: number;
    currentFile?: string;
    errorMessage?: string;
}

// ============================================================================
// Metadata Worker IPC Messages
// ============================================================================

export type WorkerRequest =
    | { type: 'START_INDEX'; requestId: string; files: FileEntry[] }
    | { type: 'CANCEL'; requestId: string };

export type WorkerResponse =
    | { type: 'PROGRESS'; requestId: string; progress: IndexProgress }
    | { type: 'STUDY_UPDATE'; requestId: string; study: Study }
    | { type: 'COMPLETE'; requestId: string; studies: Study[]; progress: IndexProgress }
    | { type: 'ERROR'; requestId: string; error: string }
    | { type: 'CANCELLED'; requestId: string };

// ============================================================================
// IndexedDB Types
// ============================================================================

export interface StoredFolderHandle {
    id: string;
    handle: FileSystemDirectoryHandle;
    name: string;
    lastAccessed: number;
}

// ============================================================================
// App-wide Types
// ============================================================================

export interface AppError {
    id: string;
    message: string;
    stack?: string;
    timestamp: number;
}

export interface Shortcut {
    key: string;
    description: string;
    modifier?: 'ctrl' | 'shift' | 'alt' | 'meta';
}
