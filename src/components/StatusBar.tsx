/**
 * StatusBar component - shows app status, indexing progress, and local mode warnings
 */

import { useAppState } from '../state/store';
import './StatusBar.css';

export function StatusBar() {
    const {
        statusMessage,
        localModeEnabled,
        localModeWarnings,
        studies,
        indexProgress,
        hasStoredFolder,
        storedFolderName,
    } = useAppState();

    // Build status text
    let status = statusMessage;
    if (indexProgress) {
        switch (indexProgress.phase) {
            case 'scanning':
                status = `Scanning files (${indexProgress.processedFiles}/${indexProgress.totalFiles})...`;
                break;
            case 'parsing':
                status = `Parsing DICOM (${indexProgress.processedFiles}/${indexProgress.totalFiles})...`;
                break;
            case 'complete':
                status = `Indexed ${indexProgress.dicomFiles} DICOM files`;
                break;
            case 'error':
                status = `Error: ${indexProgress.errorMessage ?? 'Unknown error'}`;
                break;
            case 'cancelled':
                status = 'Indexing cancelled';
                break;
        }
    }

    // Count total instances
    const totalInstances = studies.reduce(
        (sum, s) => sum + s.series.reduce((ss, ser) => ss + ser.instances.length, 0),
        0
    );

    return (
        <footer className="status-bar">
            <div className="status-bar__left">
                <span className="status-bar__message">{status}</span>
            </div>

            <div className="status-bar__center">
                {localModeWarnings.length > 0 && (
                    <span className="status-bar__warning" title={localModeWarnings.join(', ')}>
                        ⚠️ {localModeWarnings.length} API patch warning(s)
                    </span>
                )}
                {hasStoredFolder && storedFolderName && (
                    <span className="status-bar__folder" title={`Stored folder: ${storedFolderName}`}>
                        📁 {storedFolderName}
                    </span>
                )}
            </div>

            <div className="status-bar__right">
                {studies.length > 0 ? (
                    <span className="status-bar__stat">
                        {studies.length} {studies.length === 1 ? 'study' : 'studies'} · {totalInstances} images
                    </span>
                ) : (
                    <span className="status-bar__stat">No data</span>
                )}
                {localModeEnabled && (
                    <span className="status-bar__badge status-bar__badge--local">LOCAL</span>
                )}
            </div>
        </footer>
    );
}
