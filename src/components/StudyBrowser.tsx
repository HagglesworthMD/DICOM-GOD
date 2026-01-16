/**
 * StudyBrowser - shows study/series tree with loading progress
 */

import { useState } from 'react';
import { Icon } from '../ui/Icon';
import { useAppState, useAppDispatch } from '../state/store';
import type { Study, Series } from '../core/types';
import './StudyBrowser.css';

function formatDate(dateStr?: string): string {
    if (!dateStr || dateStr.length !== 8) return '';
    return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
}

interface StudyItemProps {
    study: Study;
    selectedSeriesUid: string | null;
    onSelectSeries: (series: Series) => void;
}

function StudyItem({ study, selectedSeriesUid, onSelectSeries }: StudyItemProps) {
    const [expanded, setExpanded] = useState(true);

    const totalInstances = study.series.reduce((sum, s) => sum + s.instances.length, 0);

    return (
        <li className="study-item">
            <button
                className="study-item__header"
                onClick={() => setExpanded(!expanded)}
                aria-expanded={expanded}
            >
                <span className={`study-item__chevron ${expanded ? 'study-item__chevron--open' : ''}`}>
                    ▶
                </span>
                <div className="study-item__info">
                    <span className="study-item__title">
                        {study.patientName || 'Unknown Patient'}
                    </span>
                    <span className="study-item__meta">
                        {formatDate(study.date)} · {study.series.length} series · {totalInstances} images
                    </span>
                    <span className="study-item__desc">{study.description}</span>
                </div>
            </button>

            {expanded && (
                <ul className="series-list">
                    {study.series.map(series => (
                        <SeriesItem
                            key={series.seriesInstanceUid}
                            series={series}
                            isSelected={series.seriesInstanceUid === selectedSeriesUid}
                            onSelect={() => onSelectSeries(series)}
                        />
                    ))}
                </ul>
            )}
        </li>
    );
}

interface SeriesItemProps {
    series: Series;
    isSelected: boolean;
    onSelect: () => void;
}

/** Get badge emoji for trust level */
function getTrustBadge(level: Series['geometryTrust']): string {
    switch (level) {
        case 'verified': return '🟢';
        case 'trusted': return '🟡';
        case 'untrusted': return '🔴';
        default: return '⚪';
    }
}

/** Build tooltip text from trust info */
function getTrustTooltip(series: Series): string {
    const info = series.geometryTrustInfo;
    if (!info) return `Geometry: ${series.geometryTrust}`;

    const lines = [
        `Geometry: ${info.level}`,
        `Spacing: ${info.spacingSource}`,
        '',
        ...info.reasons
    ];
    return lines.join('\n');
}

/** Get badge label for series kind */
function getKindBadge(kind: Series['kind']): { text: string; color: string } {
    switch (kind) {
        case 'stack':
            // Note: 'stack' just means scrollable. UI should check cineEligible for 'SHORT' label if needed, 
            // but here we just return basic STACK. 
            // Actually, let's inject logic to return SHORT if needed, but getKindBadge only takes `kind`.
            // We need to change the function signature or logic in the component. 
            // Wait, I can't access `series` here. 
            // I will update the function signature in the next step or do it inline.
            return { text: 'STACK', color: '#4a9' };
        case 'multiframe': return { text: 'CINE', color: '#49f' };
        case 'unsafe': return { text: 'UNSAFE', color: '#f44' };
        case 'single':
        default: return { text: 'SINGLE', color: '#666' };
    }
}

function SeriesItem({ series, isSelected, onSelect }: SeriesItemProps) {
    const trustBadge = getTrustBadge(series.geometryTrust);
    const trustTooltip = getTrustTooltip(series);
    let kindBadge = getKindBadge(series.kind);
    if (series.kind === 'stack' && !series.cineEligible) {
        kindBadge = { text: 'SHORT', color: '#977' }; // Muted reddish-gray
    }

    // Build kind tooltip
    let kindTooltip = `Type: ${series.kind}`;
    if (series.cineEligible) {
        kindTooltip += '\nCine: enabled';
    } else {
        kindTooltip += `\nCine: disabled${series.cineReason ? ` (${series.cineReason})` : ''}`;
    }
    if (series.hasMultiframe) {
        kindTooltip += '\nMulti-frame DICOM';
    }

    // De-emphasize single-image series
    const isSingle = series.kind === 'single';
    const opacity = isSingle ? 0.6 : 1;

    return (
        <li className="series-item">
            <button
                className={`series-item__btn ${isSelected ? 'series-item__btn--selected' : ''}`}
                onClick={onSelect}
                style={{ opacity }}
            >
                <span className="series-item__modality">{series.modality}</span>
                <div className="series-item__info">
                    <span className="series-item__title">
                        {series.seriesNumber !== null ? `[${series.seriesNumber}] ` : ''}
                        {series.description}
                    </span>
                    <span className="series-item__count">
                        {series.instances.length} {series.instances.length === 1 ? 'image' : 'images'}
                    </span>
                </div>
                <span
                    className="series-item__kind"
                    title={kindTooltip}
                    style={{
                        fontSize: '0.65em',
                        fontWeight: 'bold',
                        color: kindBadge.color,
                        background: 'rgba(0,0,0,0.3)',
                        padding: '2px 4px',
                        borderRadius: '3px',
                        marginLeft: '4px',
                        cursor: 'help'
                    }}
                >
                    {kindBadge.text}
                </span>
                <span
                    className="series-item__trust"
                    title={trustTooltip}
                    style={{ fontSize: '0.9em', cursor: 'help', marginLeft: '4px', paddingLeft: '4px' }}
                >
                    {trustBadge}
                </span>
            </button>
        </li>
    );
}

function ProgressIndicator() {
    const { indexProgress } = useAppState();

    if (!indexProgress || indexProgress.phase === 'complete' || indexProgress.phase === 'idle') {
        return null;
    }

    const percent = indexProgress.totalFiles > 0
        ? Math.round((indexProgress.processedFiles / indexProgress.totalFiles) * 100)
        : 0;

    return (
        <div className="index-progress">
            <div className="index-progress__bar">
                <div className="index-progress__fill" style={{ width: `${percent}%` }} />
            </div>
            <div className="index-progress__text">
                <span className="index-progress__phase">
                    {indexProgress.phase === 'scanning' ? 'Scanning...' : 'Parsing...'}
                </span>
                <span className="index-progress__count">
                    {indexProgress.processedFiles} / {indexProgress.totalFiles}
                </span>
            </div>
            {indexProgress.currentFile && (
                <div className="index-progress__file" title={indexProgress.currentFile}>
                    {indexProgress.currentFile.split('/').pop()}
                </div>
            )}
        </div>
    );
}

export function StudyBrowser() {
    const { files, studies, selectedSeries, indexProgress, layoutState } = useAppState();
    const dispatch = useAppDispatch();

    const handleSelectSeries = (series: Series) => {
        // Assign to active viewport slot
        dispatch({ type: 'ASSIGN_SERIES_TO_SLOT', slotId: layoutState.activeSlotId, series });
    };

    const isLoading = indexProgress &&
        (indexProgress.phase === 'scanning' || indexProgress.phase === 'parsing');

    const totalInstances = studies.reduce(
        (sum, s) => sum + s.series.reduce((ss, ser) => ss + ser.instances.length, 0),
        0
    );

    return (
        <aside className="study-browser">
            <header className="study-browser__header">
                <h2 className="study-browser__title">Studies</h2>
                <span className="study-browser__count">
                    {studies.length > 0
                        ? `${studies.length} studies · ${totalInstances} images`
                        : `${files.length} files`}
                </span>
            </header>

            <ProgressIndicator />

            <div className="study-browser__content">
                {studies.length === 0 && !isLoading ? (
                    <div className="study-browser__empty">
                        <Icon name="folder" size={32} />
                        <p>No studies loaded</p>
                        <p className="study-browser__hint">
                            Use &quot;Open Folder&quot; or drag files here
                        </p>
                    </div>
                ) : studies.length === 0 && isLoading ? (
                    <div className="study-browser__empty">
                        <div className="study-browser__spinner" />
                        <p>Scanning files...</p>
                    </div>
                ) : (
                    <ul className="study-list">
                        {studies.map(study => (
                            <StudyItem
                                key={study.studyInstanceUid}
                                study={study}
                                selectedSeriesUid={selectedSeries?.seriesInstanceUid ?? null}
                                onSelectSeries={handleSelectSeries}
                            />
                        ))}
                    </ul>
                )}
            </div>

            <footer className="study-browser__footer">
                {indexProgress && indexProgress.phase === 'complete' && (
                    <p className="study-browser__stats">
                        {indexProgress.dicomFiles} DICOM · {indexProgress.skippedFiles} skipped
                        {indexProgress.errorFiles > 0 && ` · ${indexProgress.errorFiles} errors`}
                    </p>
                )}
            </footer>
        </aside>
    );
}
