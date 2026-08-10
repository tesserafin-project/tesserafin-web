/**
 * The ID-object contract detector (#226).
 *
 * `unwrapIdSchemas` in scripts/generate-tesserafin-sdk.mjs used to silently rewrite an opaque
 * identifier described as `{ Value: uuid }` into the scalar the wire actually carries. That
 * workaround is why the #226 defect survived unnoticed on this side for so long: the generated
 * client looked correct while the published contract stayed wrong for every other consumer.
 *
 * The corrected contract makes the transform match nothing. It is kept, inverted, as a detector —
 * so these tests pin BOTH halves: it must be a no-op on the contract this repository pins, and it
 * must fail loudly rather than normalize if a future contract reintroduces the defect.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { unwrapIdSchemas } from '../../../scripts/generate-tesserafin-sdk.mjs';

// Resolved from the vitest working directory (the repository root) rather than from
// `import.meta.url`: under the jsdom environment that is not a `file:` URL.
const PINNED_SPEC = resolve(
    process.cwd(),
    'src/lib/tesserafin-sdk/spec/openapi.json'
);

function pinnedSpec() {
    return JSON.parse(readFileSync(PINNED_SPEC, 'utf-8'));
}

describe('ID-object contract detector', () => {
    it('finds nothing to correct in the pinned contract', () => {
        const offenders = unwrapIdSchemas(pinnedSpec());
        expect(offenders).toEqual([]);
    });

    it('leaves the pinned contract byte-identical — it normalizes nothing', () => {
        const before = readFileSync(PINNED_SPEC, 'utf-8');
        const spec = JSON.parse(before);
        unwrapIdSchemas(spec);
        // The detector must not mutate the document it inspects.
        expect(JSON.stringify(spec)).toBe(JSON.stringify(JSON.parse(before)));
    });

    it('refuses, rather than silently unwrapping, if an ID-object reappears', () => {
        const spec = pinnedSpec();
        spec.components.schemas.SomeFutureId = {
            type: 'object',
            description: 'Opaque identifier for something.',
            properties: { Value: { type: 'string', format: 'uuid' } }
        };

        expect(() => unwrapIdSchemas(spec)).toThrowError(/SomeFutureId/);
        expect(() => unwrapIdSchemas(spec)).toThrowError(/contract defect/i);
    });

    it('names every offender, not just the first', () => {
        const spec = pinnedSpec();
        spec.components.schemas.FirstId = {
            type: 'object',
            properties: { Value: { type: 'string', format: 'uuid' } }
        };
        spec.components.schemas.SecondId = {
            type: 'object',
            properties: { Value: { type: 'integer' } }
        };

        expect(() => unwrapIdSchemas(spec)).toThrowError(/FirstId/);
        expect(() => unwrapIdSchemas(spec)).toThrowError(/SecondId/);
    });

    it('does not mistake a legitimate single-property DTO for an identifier', () => {
        const spec = pinnedSpec();
        // The pinned contract carries ~30 of these; their sole property is not named `Value`.
        expect(spec.components.schemas.PingRequestDto).toBeDefined();
        expect(
            Object.keys(spec.components.schemas.PingRequestDto.properties)
        ).toEqual(['Ping']);

        expect(() => unwrapIdSchemas(spec)).not.toThrow();
    });
});
