/**
 * LRU Cache for decoded frames
 * Keeps most recently used frames in memory
 */

import type { DecodedFrame } from './types';

export interface CacheEntry {
    frame: DecodedFrame;
    key: string;
    byteSize: number;
}

export class FrameCache {
    private cache = new Map<string, CacheEntry>();
    private order: string[] = [];
    private currentSize = 0;
    private readonly maxSize: number;

    constructor(maxSizeMB = 256) {
        this.maxSize = maxSizeMB * 1024 * 1024;
    }

    /**
     * Generate cache key for instance + frame
     */
    static key(instanceUid: string, frameNumber: number): string {
        return `${instanceUid}:${frameNumber}`;
    }

    /**
     * Get a cached frame
     */
    get(instanceUid: string, frameNumber: number): DecodedFrame | null {
        const key = FrameCache.key(instanceUid, frameNumber);
        const entry = this.cache.get(key);

        if (!entry) return null;

        // Move to end (most recently used)
        const idx = this.order.indexOf(key);
        if (idx !== -1) {
            this.order.splice(idx, 1);
            this.order.push(key);
        }

        return entry.frame;
    }

    /**
     * Add a frame to cache
     */
    set(instanceUid: string, frameNumber: number, frame: DecodedFrame): void {
        const key = FrameCache.key(instanceUid, frameNumber);

        // Calculate size
        const byteSize = frame.pixelData.byteLength;

        // If already cached, update it
        if (this.cache.has(key)) {
            const existing = this.cache.get(key)!;
            this.currentSize -= existing.byteSize;
            this.cache.delete(key);
            const idx = this.order.indexOf(key);
            if (idx !== -1) this.order.splice(idx, 1);
        }

        // Evict old entries if needed
        while (this.currentSize + byteSize > this.maxSize && this.order.length > 0) {
            const oldest = this.order.shift()!;
            const entry = this.cache.get(oldest);
            if (entry) {
                this.currentSize -= entry.byteSize;
                this.cache.delete(oldest);
            }
        }

        // Add new entry
        this.cache.set(key, { frame, key, byteSize });
        this.order.push(key);
        this.currentSize += byteSize;
    }

    /**
     * Check if frame is cached
     */
    has(instanceUid: string, frameNumber: number): boolean {
        return this.cache.has(FrameCache.key(instanceUid, frameNumber));
    }

    /**
     * Clear all cached frames
     */
    clear(): void {
        this.cache.clear();
        this.order = [];
        this.currentSize = 0;
    }

    /**
     * Clear frames for a specific series
     * TODO: Implement when we have series->instance mapping
     */
    clearSeries(_seriesInstanceUid: string): void {
        // For now, this is a no-op
        // Keys are instanceUid:frameNumber, we'd need series info
        // Could be implemented by storing series->instance mapping
    }

    /**
     * Get current cache stats
     */
    stats(): { entries: number; sizeMB: number; maxMB: number } {
        return {
            entries: this.cache.size,
            sizeMB: this.currentSize / (1024 * 1024),
            maxMB: this.maxSize / (1024 * 1024),
        };
    }
}

// Global cache instance
let globalCache: FrameCache | null = null;

export function getFrameCache(): FrameCache {
    if (!globalCache) {
        globalCache = new FrameCache(256);
    }
    return globalCache;
}
