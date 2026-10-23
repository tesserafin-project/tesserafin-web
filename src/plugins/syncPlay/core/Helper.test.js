import { describe, expect, it } from 'vitest';

import { stringToGuid } from './Helper';

describe('stringToGuid', () => {
    it('formats a 32-character hex id as a dashed GUID', () => {
        expect(stringToGuid('7f1d3e9a4b2c4d5e8f0a1b2c3d4e5f60')).toBe(
            '7f1d3e9a-4b2c-4d5e-8f0a-1b2c3d4e5f60'
        );
        expect(stringToGuid('7F1D3E9A4B2C4D5E8F0A1B2C3D4E5F60')).toBe(
            '7F1D3E9A-4B2C-4D5E-8F0A-1B2C3D4E5F60'
        );
    });

    it('leaves an already dashed GUID unchanged', () => {
        const guid = '7f1d3e9a-4b2c-4d5e-8f0a-1b2c3d4e5f60';
        expect(stringToGuid(guid)).toBe(guid);
    });

    it('does not treat punctuation between 0 and z as id characters', () => {
        // The old [0-z] range also matched :;<=>?@[\]^_` — such input is not an id.
        const input = '7f1d3e9a_4b2c:4d5e@8f0a^1b2c3d4e5f60';
        expect(stringToGuid(input)).toBe(input);
    });
});
