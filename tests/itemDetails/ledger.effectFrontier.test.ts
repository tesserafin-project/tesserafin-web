/**
 * #129 Step 1c, requirement 4: the effect frontier is classified, and it cannot grow silently.
 *
 * The bidirectional runtime proof in `itemDetails.ledger.test.tsx` can only judge surfaces the
 * suite already knows to observe. A new `import` of some other service would be invisible to it —
 * the route would gain an outward effect and every ledger assertion would stay green.
 *
 * So this reads the slice's imports from SOURCE and holds them to the ledger's `effectFrontier`
 * table, in both directions: an unclassified dependency fails, and a classification for a module
 * nothing imports any more fails too.
 *
 * This is additive. `tests/boundary/presentationBoundary.ratchet.test.ts` is the P6 gate on
 * PROHIBITED dependencies and is untouched; this one classifies the PERMITTED ones.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LEDGER } from './support/ledger';

const REPO_ROOT = resolve(__dirname, '..', '..');
const SLICE = resolve(REPO_ROOT, 'src/apps/modern/features/details');
const ROUTE_MODULE = resolve(REPO_ROOT, 'src/apps/modern/routes/details.tsx');

function sourceFiles(): string[] {
    const files: string[] = [ROUTE_MODULE];
    const walk = (target: string) => {
        if (statSync(target).isFile()) {
            if (/\.tsx?$/.test(target)) files.push(target);
            return;
        }
        for (const entry of readdirSync(target)) walk(join(target, entry));
    };
    walk(SLICE);
    return files;
}

/** Every module specifier the slice imports, static or dynamic, excluding its own files. */
function importedSpecifiers(): Map<string, string[]> {
    const found = new Map<string, string[]>();
    for (const file of sourceFiles()) {
        const source = readFileSync(file, 'utf8');
        const specifiers = [
            ...source.matchAll(/(?:^|\s)(?:from|import)\s*\(?\s*'([^']+)'/gm),
            ...source.matchAll(/\brequire\(\s*'([^']+)'/g)
        ].map((match) => match[1]);
        for (const specifier of specifiers) {
            if (specifier.startsWith('.')) continue;
            if (specifier.endsWith('.scss') || specifier.endsWith('.css'))
                continue;
            const relative = file.slice(REPO_ROOT.length + 1);
            found.set(specifier, [...(found.get(specifier) ?? []), relative]);
        }
    }
    return found;
}

const CLASSIFICATIONS = [
    'OUTWARD_API',
    'OUTWARD_MUTATION',
    'OUTWARD_SERVICE',
    'OUTWARD_NAVIGATION',
    'DELEGATED_WIDGET',
    'CACHE',
    'CAPABILITY',
    'PURE',
    'UI'
];

describe('migrated Item Details ledger — the effect frontier is classified', () => {
    const imported = importedSpecifiers();
    const classified = new Map(
        LEDGER.effectFrontier.map((entry) => [entry.module, entry])
    );

    it('the slice was found', () => {
        expect(imported.size).toBeGreaterThan(10);
    });

    it('every imported module carries a ledger classification', () => {
        const unclassified = [...imported.entries()]
            .filter(([specifier]) => !classified.has(specifier))
            .map(
                ([specifier, files]) =>
                    `${specifier}  (imported by ${files.join(', ')})`
            );

        expect(
            unclassified,
            '[item-details ledger] the Item Details slice imports module(s) the ledger does not ' +
                'classify. Adding an API or service dependency without extending ' +
                'tests/fixtures/item-details/migrated-request-action-ledger.json is exactly what this ' +
                'gate exists to stop:\n' +
                unclassified.map((entry) => `  ${entry}`).join('\n')
        ).toEqual([]);
    });

    it('every ledger classification names a module the slice still imports', () => {
        const stale = LEDGER.effectFrontier
            .map((entry) => entry.module)
            .filter((module) => !imported.has(module));

        expect(
            stale,
            '[item-details ledger] the ledger classifies module(s) nothing imports any more. ' +
                'A stale classification is a claim about a dependency that no longer exists:\n' +
                stale.map((entry) => `  ${entry}`).join('\n')
        ).toEqual([]);
    });

    it('uses only the permitted classifications', () => {
        for (const entry of LEDGER.effectFrontier) {
            expect(CLASSIFICATIONS, `module "${entry.module}"`).toContain(
                entry.classification
            );
        }
    });

    it('every outward classification names a declared surface', () => {
        const surfaces = new Set(LEDGER.surfaces.map((entry) => entry.id));
        for (const entry of LEDGER.effectFrontier) {
            if (
                !entry.classification.startsWith('OUTWARD') &&
                entry.classification !== 'DELEGATED_WIDGET'
            ) {
                expect(
                    entry.surface,
                    `module "${entry.module}" is not outward`
                ).toBeNull();
                continue;
            }
            expect(entry.surface, `module "${entry.module}"`).not.toBeNull();
            expect(
                surfaces,
                `module "${entry.module}" names surface "${entry.surface}"`
            ).toContain(entry.surface as string);
        }
    });

    /**
     * The two API surfaces are reachable from exactly one file.
     *
     * Phase 3 requirement 10 of the migration: the rendering components stay away from the legacy
     * API client. If a component started importing it directly the ledger's fail-closed proxy would
     * still see the call, but the narrow adapter would have stopped being narrow — and the next
     * request would be one nobody had to declare.
     */
    it('the legacy API client is reached from the adapter and nowhere else', () => {
        const reachedFrom = imported.get('lib/jellyfin-apiclient') ?? [];
        expect(reachedFrom).toEqual([
            'src/apps/modern/features/details/adapters/itemDetailsApi.ts'
        ]);
    });

    it('the SDK library API is reached from the adapter and nowhere else', () => {
        const reachedFrom =
            imported.get('@jellyfin/sdk/lib/utils/api/library-api') ?? [];
        expect(reachedFrom).toEqual([
            'src/apps/modern/features/details/adapters/itemDetailsApi.ts'
        ]);
    });

    /**
     * The presentation boundary, restated at the effect frontier.
     *
     * Step 1c asserted this list was EMPTY, because it froze behaviour without binding. Step 2
     * binds, so the list is now enumerated instead: exactly these four specifiers, no more. The
     * gate is the same strength — a fifth presentation import still fails — and it additionally
     * pins WHICH modules the binding is allowed to reach.
     *
     * `validateManifest`, `theme.schema.json` and the Theme Studio are the ones that must never
     * appear: they are the authoring layer, and pulling them in here would put the schema validator
     * into the Item Details async chunk.
     */
    it('imports exactly the four presentation modules the binding needs', () => {
        const presentation = [...imported.keys()]
            .filter((specifier) =>
                /presentation|themes\/platform|settings\/userSettings/i.test(
                    specifier
                )
            )
            .sort();

        expect(presentation).toEqual([
            'scripts/settings/userSettings',
            'themes/platform/contract',
            'themes/platform/resolvePresentation',
            'ui/presentation/PresentationContext'
        ]);
    });

    it('never reaches the authoring, validation or Studio layer', () => {
        const authoring = [...imported.keys()].filter((specifier) =>
            /validateManifest|theme\.schema|themeStudio|localPresentation|manifests/i.test(
                specifier
            )
        );
        expect(
            authoring,
            'the Item Details chunk must not carry the schema validator or the Studio'
        ).toEqual([]);
    });
});
