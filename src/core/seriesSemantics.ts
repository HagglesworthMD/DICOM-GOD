import type { Instance } from './types';

export type SemanticKind = 'stack' | 'single' | 'multiframe' | 'mosaic';

export interface SeriesSemantics {
    stackLike: boolean;
    hasMultiframe: boolean;
    documentLike: boolean;
    documentReason?: string;
    mosaicEvidence: boolean;
    semanticKind: SemanticKind;
}

const DOCUMENT_SOP_PREFIX = '1.2.840.10008.5.1.4.1.1.104';
const SECONDARY_CAPTURE_PREFIX = '1.2.840.10008.5.1.4.1.1.7';

function isDocumentSopClass(uid?: string): boolean {
    if (!uid) return false;
    const trimmed = uid.trim();
    return trimmed.startsWith(DOCUMENT_SOP_PREFIX) || trimmed.startsWith(SECONDARY_CAPTURE_PREFIX);
}

function normalizeTokens(value?: string): string[] {
    if (!value) return [];
    return value.split('\\').map(token => token.trim().toUpperCase()).filter(Boolean);
}

function hasMosaicTokens(value?: string): boolean {
    const tokens = normalizeTokens(value);
    return tokens.some(token => ['MOSAIC', 'MONTAGE', 'TILED', 'TILE'].includes(token));
}

function hasMosaicText(value?: string): boolean {
    if (!value) return false;
    return /mosaic|montage|tile/i.test(value);
}

function getDocumentReason(instance: Instance): string | null {
    if (isDocumentSopClass(instance.sopClassUid)) {
        return 'SOPClassUID';
    }
    const tokens = normalizeTokens(instance.imageType);
    if (tokens.includes('DERIVED')) {
        return 'ImageType:DERIVED';
    }
    if (tokens.includes('SECONDARY')) {
        return 'ImageType:SECONDARY';
    }
    if (instance.derivationDescription && /secondary|derived|document|report/i.test(instance.derivationDescription)) {
        return 'DerivationDescription';
    }
    return null;
}

function hasExplicitMosaicIndicators(instance: Instance): boolean {
    if (instance.mosaicEvidenceTags && instance.mosaicEvidenceTags.length > 0) {
        return true;
    }
    if (hasMosaicTokens(instance.imageType)) return true;
    if (hasMosaicText(instance.derivationDescription)) return true;
    return false;
}

export function classifySeriesSemantics(instances: Instance[], _modality?: string): SeriesSemantics {
    let maxFrames = 1;
    let documentLike = false;
    let documentReason: string | undefined;
    let mosaicEvidence = false;
    for (const instance of instances) {
        const frames = instance.numberOfFrames ?? 1;
        if (frames > maxFrames) maxFrames = frames;
        if (!documentLike) {
            const reason = getDocumentReason(instance);
            if (reason) {
                documentLike = true;
                documentReason = reason;
            }
        }
        if (!mosaicEvidence && hasExplicitMosaicIndicators(instance)) {
            mosaicEvidence = true;
        }
    }

    const hasMultiframe = maxFrames > 1;
    const stackLike = instances.length > 1 || hasMultiframe;
    const semanticKind: SemanticKind = mosaicEvidence && instances.length === 1 && !hasMultiframe
        ? 'mosaic'
        : instances.length > 1
            ? 'stack'
            : hasMultiframe
                ? 'multiframe'
                : 'single';

    return { stackLike, hasMultiframe, documentLike, documentReason, mosaicEvidence, semanticKind };
}
