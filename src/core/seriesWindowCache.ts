export interface SeriesWindowDefault {
    center: number;
    width: number;
    low: number;
    high: number;
    method: 'percentile';
}

const seriesWindowCache = new Map<string, SeriesWindowDefault>();

export function getSeriesWindowDefault(seriesUid: string): SeriesWindowDefault | undefined {
    return seriesWindowCache.get(seriesUid);
}

export function setSeriesWindowDefault(seriesUid: string, entry: SeriesWindowDefault): void {
    seriesWindowCache.set(seriesUid, entry);
}
