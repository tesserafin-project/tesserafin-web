/**
 * `theme.schema.json#/$defs/tokensPartial` claims to be a deep-partial of `tokens.schema.json`.
 * Nothing structural enforces that — they are two hand-written documents — so this test does.
 *
 * The failure it prevents is specific and quiet: add a token group to `tokens.schema.json`, forget
 * `tokensPartial`, and every interaction-profile override of that group is silently rejected as an
 * unexpected property. The theme still validates. The profile just stops working.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = join(__dirname, '..', 'schema');

function readSchema(name: string) {
    return JSON.parse(readFileSync(join(SCHEMA_DIR, name), 'utf8'));
}

const tokensSchema = readSchema('tokens.schema.json');
const themeSchema = readSchema('theme.schema.json');
const tokensPartial = themeSchema.$defs.tokensPartial;

describe('tokensPartial mirrors tokens.schema.json', () => {
    it('covers exactly the same top-level token groups', () => {
        expect(Object.keys(tokensPartial.properties).sort()).toEqual(
            Object.keys(tokensSchema.properties).sort()
        );
    });

    it('requires nothing — that is what makes it a partial', () => {
        expect(tokensPartial.required).toBeUndefined();
        for (const group of Object.values<Record<string, unknown>>(
            tokensPartial.properties
        )) {
            expect(group.required).toBeUndefined();
        }
    });

    it('stays closed at every level, so a profile cannot smuggle an unknown key', () => {
        const closedEverywhere = (node: unknown): boolean => {
            if (typeof node !== 'object' || node === null) return true;
            const record = node as Record<string, unknown>;
            if (record.properties !== undefined) {
                if (record.additionalProperties !== false) return false;
                return Object.values(
                    record.properties as Record<string, unknown>
                ).every(closedEverywhere);
            }
            if (record.additionalProperties !== undefined) {
                // A map node (e.g. spacing): open keys, but every VALUE is constrained.
                return typeof record.additionalProperties === 'object';
            }
            return true;
        };
        expect(closedEverywhere(tokensPartial)).toBe(true);
    });

    it('covers the same colour roles as the full colour group', () => {
        expect(
            Object.keys(themeSchema.$defs.colorGroupPartial.properties).sort()
        ).toEqual(Object.keys(tokensSchema.$defs.colorGroup.properties).sort());
    });

    it('reuses identical leaf constraints for the shared value types', () => {
        for (const def of ['colorValue', 'cssLength', 'cssDuration']) {
            expect(themeSchema.$defs[def].pattern).toEqual(
                tokensSchema.$defs[def].pattern
            );
        }
    });
});
