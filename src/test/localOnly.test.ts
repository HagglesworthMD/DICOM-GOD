/**
 * LocalOnly tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    enableLocalOnlyMode,
    disableLocalOnlyMode,
    isLocalOnlyMode,
} from '../core/localOnly';

describe('localOnly', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        disableLocalOnlyMode(); // Ensure clean state
    });

    afterEach(() => {
        disableLocalOnlyMode();
        globalThis.fetch = originalFetch;
    });

    it('starts with local mode disabled', () => {
        expect(isLocalOnlyMode()).toBe(false);
    });

    it('enables local mode', () => {
        enableLocalOnlyMode();
        expect(isLocalOnlyMode()).toBe(true);
    });

    it('disables local mode', () => {
        enableLocalOnlyMode();
        disableLocalOnlyMode();
        expect(isLocalOnlyMode()).toBe(false);
    });

    it('blocks fetch when enabled', async () => {
        enableLocalOnlyMode();

        await expect(fetch('https://example.com')).rejects.toThrow(
            'Network request blocked: Local-only mode is enabled'
        );
    });

    it('restores fetch when disabled', async () => {
        const mockFetch = vi.fn().mockResolvedValue(new Response('ok'));
        globalThis.fetch = mockFetch;

        enableLocalOnlyMode();
        disableLocalOnlyMode();

        await fetch('https://example.com');
        expect(mockFetch).toHaveBeenCalled();
    });
});
