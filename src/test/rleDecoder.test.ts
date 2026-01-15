/**
 * Tests for RLE Decoder
 */

import { describe, it, expect } from 'vitest';
import { decodeRLE, rleToTypedArray } from '../core/rleDecoder';

describe('RLE Decoder', () => {
    describe('decodeRLE', () => {
        it('decodes literal run', () => {
            // Header: 1 segment at offset 64
            // Segment: literal run of 4 bytes [0x03, 0x01, 0x02, 0x03, 0x04]
            const header = new Uint32Array([1, 64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            const data = new Uint8Array([
                ...new Uint8Array(header.buffer),
                0x03, 0x01, 0x02, 0x03, 0x04, // n=3 means copy 4 bytes
            ]);

            const result = decodeRLE(data.buffer, 2, 2, 8, 1);
            expect(result[0]).toBe(0x01);
            expect(result[1]).toBe(0x02);
            expect(result[2]).toBe(0x03);
            expect(result[3]).toBe(0x04);
        });

        it('decodes replicate run', () => {
            // Header: 1 segment at offset 64
            // Segment: replicate run [-3, 0xAB] means repeat 0xAB 4 times
            const header = new Uint32Array([1, 64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            const data = new Uint8Array([
                ...new Uint8Array(header.buffer),
                0xFD, 0xAB, // n=-3 (0xFD signed) means repeat 4 times
            ]);

            const result = decodeRLE(data.buffer, 2, 2, 8, 1);
            expect(result[0]).toBe(0xAB);
            expect(result[1]).toBe(0xAB);
            expect(result[2]).toBe(0xAB);
            expect(result[3]).toBe(0xAB);
        });

        it('decodes mixed runs', () => {
            // Header: 1 segment at offset 64
            const header = new Uint32Array([1, 64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            const data = new Uint8Array([
                ...new Uint8Array(header.buffer),
                0x01, 0xAA, 0xBB, // literal: copy 2 bytes
                0xFE, 0xCC, // replicate: repeat 0xCC 3 times
            ]);

            const result = decodeRLE(data.buffer, 5, 1, 8, 1);
            expect(result[0]).toBe(0xAA);
            expect(result[1]).toBe(0xBB);
            expect(result[2]).toBe(0xCC);
            expect(result[3]).toBe(0xCC);
            expect(result[4]).toBe(0xCC);
        });

        it('throws on invalid segment count', () => {
            const header = new Uint32Array([0, 64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            expect(() => decodeRLE(header.buffer, 2, 2, 8, 1)).toThrow();
        });

        it('throws on too many segments', () => {
            const header = new Uint32Array([16, 64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            expect(() => decodeRLE(header.buffer, 2, 2, 8, 1)).toThrow();
        });
    });

    describe('rleToTypedArray', () => {
        it('returns Uint8Array for 8-bit data', () => {
            const input = new Uint8Array([1, 2, 3, 4]);
            const result = rleToTypedArray(input, 8, 0);
            expect(result).toBeInstanceOf(Uint8Array);
            expect(result[0]).toBe(1);
        });

        it('returns Uint16Array for 16-bit unsigned', () => {
            const input = new Uint8Array([0x00, 0x01, 0x00, 0x02]);
            const result = rleToTypedArray(input, 16, 0);
            expect(result).toBeInstanceOf(Uint16Array);
        });

        it('returns Int16Array for 16-bit signed', () => {
            const input = new Uint8Array([0x00, 0x01, 0x00, 0x02]);
            const result = rleToTypedArray(input, 16, 1);
            expect(result).toBeInstanceOf(Int16Array);
        });

        it('throws for unsupported bits allocated', () => {
            const input = new Uint8Array([1, 2, 3, 4]);
            expect(() => rleToTypedArray(input, 32, 0)).toThrow();
        });
    });
});
