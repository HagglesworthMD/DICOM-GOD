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

function SeriesItem({ series, isSelected, onSelect }: SeriesItemProps) {
    return (
        <li className="series-item">
            <button
                className={`series-item__btn ${isSelected ? 'series-item__btn--selected' : ''}`}
                onClick={onSelect}
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
    const { files, studies, selectedSeries, indexProgress } = useAppState();
    const dispatch = useAppDispatch();

    const handleSelectSeries = (series: Series) => {
        dispatch({ type: 'SELECT_SERIES', series });
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
