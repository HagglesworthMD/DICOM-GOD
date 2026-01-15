/**
 * Tests for LRU Frame Cache
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FrameCache } from '../core/frameCache';
import type { DecodedFrame } from '../core/types';

function createMockFrame(size = 1024): DecodedFrame {
    return {
        pixelData: new Uint16Array(size / 2),
        width: 16,
        height: 16,
        bitsStored: 16,
        isSigned: false,
        minValue: 0,
        maxValue: 4095,
        rescaleSlope: 1,
        rescaleIntercept: 0,
        windowCenter: 2048,
        windowWidth: 4096,
        photometricInterpretation: 'MONOCHROME2',
        samplesPerPixel: 1,
    };
}

describe('FrameCache', () => {
    let cache: FrameCache;

    beforeEach(() => {
        // 1KB max for testing
        cache = new FrameCache(0.001);
    });

    describe('key generation', () => {
        it('generates unique keys', () => {
            const key1 = FrameCache.key('uid1', 0);
            const key2 = FrameCache.key('uid1', 1);
            const key3 = FrameCache.key('uid2', 0);

            expect(key1).toBe('uid1:0');
            expect(key2).toBe('uid1:1');
            expect(key3).toBe('uid2:0');
            expect(key1).not.toBe(key2);
            expect(key1).not.toBe(key3);
        });
    });

    describe('get/set', () => {
        it('returns null for missing frames', () => {
            expect(cache.get('nonexistent', 0)).toBeNull();
        });

        it('stores and retrieves frames', () => {
            const frame = createMockFrame(256);
            cache.set('uid1', 0, frame);

            const retrieved = cache.get('uid1', 0);
            expect(retrieved).toBe(frame);
        });

        it('returns null after eviction', () => {
            const frame1 = createMockFrame(512);
            const frame2 = createMockFrame(512);
            const frame3 = createMockFrame(512);

            cache.set('uid1', 0, frame1);
            cache.set('uid2', 0, frame2);
            cache.set('uid3', 0, frame3);

            // First frame should be evicted
            expect(cache.get('uid1', 0)).toBeNull();
        });
    });

    describe('LRU behavior', () => {
        it('evicts least recently used', () => {
            const frame1 = createMockFrame(400);
            const frame2 = createMockFrame(400);
            const frame3 = createMockFrame(400);

            cache.set('uid1', 0, frame1);
            cache.set('uid2', 0, frame2);

            // Access uid1 to make it recently used
            cache.get('uid1', 0);

            // Add uid3, should evict uid2
            cache.set('uid3', 0, frame3);

            expect(cache.get('uid1', 0)).not.toBeNull();
            expect(cache.get('uid2', 0)).toBeNull();
            expect(cache.get('uid3', 0)).not.toBeNull();
        });
    });

    describe('has', () => {
        it('returns false for missing frames', () => {
            expect(cache.has('nonexistent', 0)).toBe(false);
        });

        it('returns true for cached frames', () => {
            const frame = createMockFrame(256);
            cache.set('uid1', 0, frame);

            expect(cache.has('uid1', 0)).toBe(true);
        });
    });

    describe('clear', () => {
        it('removes all entries', () => {
            const frame = createMockFrame(256);
            cache.set('uid1', 0, frame);
            cache.set('uid2', 0, frame);

            cache.clear();

            expect(cache.has('uid1', 0)).toBe(false);
            expect(cache.has('uid2', 0)).toBe(false);
            expect(cache.stats().entries).toBe(0);
        });
    });

    describe('stats', () => {
        it('reports correct stats', () => {
            const frame = createMockFrame(256);
            cache.set('uid1', 0, frame);

            const stats = cache.stats();
            expect(stats.entries).toBe(1);
            expect(stats.sizeMB).toBeGreaterThan(0);
        });
    });
});
