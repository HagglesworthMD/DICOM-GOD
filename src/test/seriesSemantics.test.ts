/**
 * Tests for series semantics classification
 */

import { describe, it, expect } from 'vitest';
import { classifySeriesSemantics } from '../core/seriesSemantics';
import type { Instance } from '../core/types';

function makeInstance(options: Partial<Instance> = {}): Instance {
    return {
        sopInstanceUid: `uid-${Math.random()}`,
        seriesInstanceUid: 'series-1',
        instanceNumber: null,
        fileKey: 'file-key',
        filePath: 'file.dcm',
        fileSize: 1,
        ...options,
    } as Instance;
}

describe('classifySeriesSemantics', () => {
    it('treats multiple instances as stack-like', () => {
        const instances = Array.from({ length: 43 }, () => makeInstance({ numberOfFrames: 1 }));
        const result = classifySeriesSemantics(instances);
        expect(result.stackLike).toBe(true);
        expect(result.hasMultiframe).toBe(false);
        expect(result.semanticKind).toBe('stack');
    });

    it('treats multi-frame single instance as stack-like', () => {
        const instances = [makeInstance({ numberOfFrames: 43 })];
        const result = classifySeriesSemantics(instances, 'US');
        expect(result.stackLike).toBe(true);
        expect(result.hasMultiframe).toBe(true);
        expect(result.semanticKind).toBe('multiframe');
    });

    it('treats single-instance single-frame as single', () => {
        const instances = [makeInstance({ numberOfFrames: 1 })];
        const result = classifySeriesSemantics(instances);
        expect(result.stackLike).toBe(false);
        expect(result.hasMultiframe).toBe(false);
        expect(result.documentLike).toBe(false);
        expect(result.semanticKind).toBe('single');
    });

    it('flags document SOP classes', () => {
        const instances = [makeInstance({ numberOfFrames: 1, sopClassUid: '1.2.840.10008.5.1.4.1.1.104.1' })];
        const result = classifySeriesSemantics(instances);
        expect(result.documentLike).toBe(true);
    });

    it('keeps doc-like multi-frame as multiframe', () => {
        const instances = [makeInstance({ numberOfFrames: 12, sopClassUid: '1.2.840.10008.5.1.4.1.1.7' })];
        const result = classifySeriesSemantics(instances);
        expect(result.documentLike).toBe(true);
        expect(result.semanticKind).toBe('multiframe');
        expect(result.mosaicEvidence).toBe(false);
    });

    it('keeps doc-like multi-instance as stack (layout unchanged)', () => {
        const instances = [
            makeInstance({ numberOfFrames: 1, sopClassUid: '1.2.840.10008.5.1.4.1.1.7' }),
            makeInstance({ numberOfFrames: 1 }),
        ];
        const result = classifySeriesSemantics(instances);
        expect(result.documentLike).toBe(true);
        expect(result.semanticKind).toBe('stack');
        expect(result.mosaicEvidence).toBe(false);
    });

    it('treats US multi-frame with regions as multiframe (not mosaic)', () => {
        const instances = [makeInstance({ numberOfFrames: 25, ultrasoundRegionSequence: true })];
        const result = classifySeriesSemantics(instances, 'US');
        expect(result.semanticKind).toBe('multiframe');
        expect(result.mosaicEvidence).toBe(false);
    });

    it('requires explicit mosaic evidence to mark mosaic', () => {
        const withoutEvidence = classifySeriesSemantics([makeInstance({ numberOfFrames: 1 })]);
        expect(withoutEvidence.semanticKind).toBe('single');
        expect(withoutEvidence.mosaicEvidence).toBe(false);

        const withEvidence = classifySeriesSemantics([
            makeInstance({ numberOfFrames: 1, mosaicEvidenceTags: ['Private0019,100A_NumberOfImagesInMosaic'] })
        ]);
        expect(withEvidence.semanticKind).toBe('mosaic');
        expect(withEvidence.mosaicEvidence).toBe(true);
    });

    it('does not let documentLike alone trigger mosaic or override semantics', () => {
        const docSingle = classifySeriesSemantics([
            makeInstance({ numberOfFrames: 1, sopClassUid: '1.2.840.10008.5.1.4.1.1.7' })
        ]);
        expect(docSingle.documentLike).toBe(true);
        expect(docSingle.semanticKind).toBe('single');
        expect(docSingle.mosaicEvidence).toBe(false);
    });
});
