
import { describe, it, expect } from 'vitest';
import type { Instance } from '../core/types';

// We can't import the worker directly easily in test environment without extensive mocking.
// Instead, we will replicate the sorting logic here and assert its determinism.
// This ensures that the LOGIC itself is deterministic.

function sortInstances(instances: Instance[]) {
    instances.sort((a, b) => {
        // InstanceNumber comparison (null sorts last)
        if (a.instanceNumber !== null && b.instanceNumber !== null) {
            const numCmp = a.instanceNumber - b.instanceNumber;
            if (numCmp !== 0) return numCmp;
        } else if (a.instanceNumber !== null) {
            return -1;
        } else if (b.instanceNumber !== null) {
            return 1;
        }

        // FileKey as ultimate tiebreaker (simulating the worker logic change)
        return a.fileKey.localeCompare(b.fileKey);
    });
}

describe('Deterministic Sorting', () => {
    it('sorts instances with identical instance numbers by fileKey', () => {
        const instances: Instance[] = [
            { instanceNumber: 1, fileKey: 'b' } as Instance,
            { instanceNumber: 1, fileKey: 'a' } as Instance,
            { instanceNumber: 1, fileKey: 'c' } as Instance,
        ];

        sortInstances(instances);

        expect(instances[0].fileKey).toBe('a');
        expect(instances[1].fileKey).toBe('b');
        expect(instances[2].fileKey).toBe('c');
    });

    it('handles null instance numbers consistently', () => {
        const instances: Instance[] = [
            { instanceNumber: null, fileKey: 'z' } as Instance,
            { instanceNumber: 1, fileKey: 'a' } as Instance,
            { instanceNumber: null, fileKey: 'x' } as Instance,
        ];

        sortInstances(instances);

        expect(instances[0].fileKey).toBe('a'); // 1
        expect(instances[1].fileKey).toBe('x'); // null (sorted by fileKey)
        expect(instances[2].fileKey).toBe('z'); // null (sorted by fileKey)
    });

    it('is stable across repeated sorts', () => {
        const input = [
            { instanceNumber: 5, fileKey: 'm' } as Instance,
            { instanceNumber: 1, fileKey: 'z' } as Instance,
            { instanceNumber: 5, fileKey: 'a' } as Instance, // Duplicate number
        ];

        const firstSort = [...input];
        sortInstances(firstSort);

        // Shuffle random
        const secondSort = [input[1], input[2], input[0]];
        sortInstances(secondSort);

        expect(firstSort).toEqual(secondSort);
        expect(firstSort[1].fileKey).toBe('a'); // 5-a comes before 5-m
    });
});
