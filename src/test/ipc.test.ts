/**
 * Tests for IPC message types and worker protocol
 */

import { describe, it, expect } from 'vitest';
import type { WorkerRequest, WorkerResponse, IndexProgress, Study } from '../core/types';

describe('IPC Message Types', () => {
    describe('WorkerRequest', () => {
        it('START_INDEX has required fields', () => {
            const msg: WorkerRequest = {
                type: 'START_INDEX',
                requestId: 'test-123',
                files: [{ name: 'test.dcm', size: 1000, file: new File([], 'test.dcm') }],
            };

            expect(msg.type).toBe('START_INDEX');
            expect(msg.requestId).toBeDefined();
            expect(msg.files).toBeInstanceOf(Array);
        });

        it('CANCEL has required fields', () => {
            const msg: WorkerRequest = {
                type: 'CANCEL',
                requestId: 'test-123',
            };

            expect(msg.type).toBe('CANCEL');
            expect(msg.requestId).toBeDefined();
        });
    });

    describe('WorkerResponse', () => {
        it('PROGRESS has required fields', () => {
            const progress: IndexProgress = {
                phase: 'scanning',
                totalFiles: 100,
                processedFiles: 50,
                dicomFiles: 40,
                skippedFiles: 10,
                errorFiles: 0,
            };

            const msg: WorkerResponse = {
                type: 'PROGRESS',
                requestId: 'test-123',
                progress,
            };

            expect(msg.type).toBe('PROGRESS');
            expect(msg.progress.phase).toBe('scanning');
            expect(msg.progress.totalFiles).toBe(100);
        });

        it('STUDY_UPDATE has required fields', () => {
            const study: Study = {
                studyInstanceUid: '1.2.3',
                description: 'Test Study',
                series: [],
            };

            const msg: WorkerResponse = {
                type: 'STUDY_UPDATE',
                requestId: 'test-123',
                study,
            };

            expect(msg.type).toBe('STUDY_UPDATE');
            expect(msg.study.studyInstanceUid).toBeDefined();
        });

        it('COMPLETE has required fields', () => {
            const progress: IndexProgress = {
                phase: 'complete',
                totalFiles: 100,
                processedFiles: 100,
                dicomFiles: 90,
                skippedFiles: 10,
                errorFiles: 0,
            };

            const msg: WorkerResponse = {
                type: 'COMPLETE',
                requestId: 'test-123',
                studies: [],
                progress,
            };

            expect(msg.type).toBe('COMPLETE');
            expect(msg.studies).toBeInstanceOf(Array);
            expect(msg.progress.phase).toBe('complete');
        });

        it('ERROR has required fields', () => {
            const msg: WorkerResponse = {
                type: 'ERROR',
                requestId: 'test-123',
                error: 'Something went wrong',
            };

            expect(msg.type).toBe('ERROR');
            expect(msg.error).toBeDefined();
        });

        it('CANCELLED has required fields', () => {
            const msg: WorkerResponse = {
                type: 'CANCELLED',
                requestId: 'test-123',
            };

            expect(msg.type).toBe('CANCELLED');
            expect(msg.requestId).toBeDefined();
        });
    });

    describe('IndexProgress phases', () => {
        it('supports all expected phases', () => {
            const phases: IndexProgress['phase'][] = [
                'idle',
                'scanning',
                'parsing',
                'complete',
                'error',
                'cancelled',
            ];

            phases.forEach(phase => {
                const progress: IndexProgress = {
                    phase,
                    totalFiles: 0,
                    processedFiles: 0,
                    dicomFiles: 0,
                    skippedFiles: 0,
                    errorFiles: 0,
                };

                expect(progress.phase).toBe(phase);
            });
        });
    });
});
