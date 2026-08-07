/**
 * Keeps the ledger's two records from disagreeing, and keeps the historical record intact.
 *
 *   tests/fixtures/item-details/migrated-request-action-ledger.json — AUTHORITATIVE
 *   docs/tesserafin/item-details-request-action-ledger.md           — derived, human-readable
 *
 * A frozen contract that lives in two places drifts. Every count, row identifier and classification
 * the document states is checked against the fixture here, so the document cannot quietly fall
 * behind — and cannot quietly become a second source of truth.
 *
 * It also pins the two things Step 1c is not allowed to touch: the historical P5 fixture, and the
 * fact that `presentation.page.itemDetails` is still unbound.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PLATFORM_DEFAULT_PRESENTATION } from '../../src/themes/platform/resolvePresentation';
import { WEB_RENDERER_CAPABILITIES } from '../../src/themes/platform/contract';
import { ITEM_DETAILS_CASES } from '../fixtures/item-details/cases';
import legacyContract from '../fixtures/item-details/legacy-contract.json';
import { LEDGER } from './support/ledger';

const REPO_ROOT = resolve(__dirname, '..', '..');
const DOCUMENT_PATH = join(
    REPO_ROOT,
    'docs',
    'tesserafin',
    'item-details-request-action-ledger.md'
);
const DOCUMENT = readFileSync(DOCUMENT_PATH, 'utf8');
const LEGACY_FIXTURE_PATH = join(
    REPO_ROOT,
    'tests',
    'fixtures',
    'item-details',
    'legacy-contract.json'
);

const requestRows = LEDGER.classes.flatMap((cls) => cls.requests);
const actionRows = LEDGER.classes.flatMap((cls) => cls.actions);
const signature = (row: { surface: string; member: string; args: unknown[] }) =>
    `${row.surface}.${row.member}#${JSON.stringify(row.args)}`;
const actionSignature = (row: {
    service: string;
    member: string;
    payload: unknown;
}) => `${row.service}#${row.member}#${JSON.stringify(row.payload)}`;

const totals = {
    classes: LEDGER.classes.length,
    requests: requestRows.length,
    uniqueRequestSignatures: new Set(requestRows.map(signature)).size,
    actions: actionRows.length,
    uniqueActionSignatures: new Set(actionRows.map(actionSignature)).size,
    localOnly: LEDGER.classes.reduce((n, cls) => n + cls.localOnly.length, 0),
    disabled: LEDGER.classes.reduce(
        (n, cls) => n + cls.disabledControls.length,
        0
    ),
    delegated: LEDGER.classes.reduce(
        (n, cls) => n + cls.delegatedControls.length,
        0
    ),
    navigation: LEDGER.classes.reduce((n, cls) => n + cls.navigation.length, 0),
    absentRequests: LEDGER.classes.reduce(
        (n, cls) => n + cls.absentRequests.length,
        0
    ),
    absentActions: LEDGER.classes.reduce(
        (n, cls) => n + cls.absentActions.length,
        0
    ),
    variants: LEDGER.classes.reduce((n, cls) => n + cls.variants.length, 0)
};

describe('migrated Item Details ledger — the fixture is well formed', () => {
    it('declares itself authoritative and names its step', () => {
        expect(LEDGER.status).toBe('authoritative');
        expect(LEDGER.step).toBe('#129 Step 1c');
        expect(LEDGER.version).toBe(1);
    });

    it('has one class per case fixture, and vice versa', () => {
        const fromLedger = LEDGER.classes.map((cls) => cls.id).sort();
        const fromCases = ITEM_DETAILS_CASES.map((entry) => entry.id).sort();
        expect(fromLedger).toEqual(fromCases);
    });

    it('gives every row a stable, unique semantic identifier within its class', () => {
        for (const cls of LEDGER.classes) {
            const requestIds = cls.requests.map((row) => row.id);
            expect(
                new Set(requestIds).size,
                `duplicate request id in "${cls.id}"`
            ).toBe(requestIds.length);
            const actionIds = cls.actions.map((row) => row.id);
            expect(
                new Set(actionIds).size,
                `duplicate action id in "${cls.id}"`
            ).toBe(actionIds.length);
            for (const id of [...requestIds, ...actionIds]) {
                expect(id, `empty row id in "${cls.id}"`).toMatch(/\S/);
            }
        }
    });

    it('never declares the same row both present and absent', () => {
        for (const cls of LEDGER.classes) {
            const present = new Set(cls.requests.map((row) => row.id));
            for (const absence of cls.absentRequests) {
                expect(
                    present.has(absence.signature),
                    `"${absence.signature}" in "${cls.id}"`
                ).toBe(false);
            }
            const offered = new Set(cls.actions.map((row) => row.id));
            for (const absence of cls.absentActions) {
                expect(
                    offered.has(absence.id),
                    `"${absence.id}" in "${cls.id}"`
                ).toBe(false);
            }
        }
    });

    it('gives every declared absence a reason', () => {
        for (const cls of LEDGER.classes) {
            for (const absence of [
                ...cls.absentRequests,
                ...cls.absentActions
            ]) {
                expect(
                    absence.reason,
                    `an absence in "${cls.id}" has no reason`
                ).toMatch(/\S/);
            }
        }
    });

    it('resolves every dependsOn to a row in the same class', () => {
        for (const cls of LEDGER.classes) {
            const ids = new Set(cls.requests.map((row) => row.id));
            for (const row of cls.requests) {
                for (const dependency of row.dependsOn) {
                    expect(
                        ids,
                        `"${row.id}" of "${cls.id}" depends on "${dependency}"`
                    ).toContain(dependency);
                }
            }
        }
    });

    it('names only declared phases and declared surfaces', () => {
        const phases = new Set(
            LEDGER.causality.phases.map((phase) => phase.id)
        );
        const surfaces = new Set(LEDGER.surfaces.map((entry) => entry.id));
        for (const row of requestRows) {
            expect(phases, `row "${row.id}" phase`).toContain(row.phase);
            expect(surfaces, `row "${row.id}" surface`).toContain(row.surface);
        }
    });

    it('resolves every identity role a row uses', () => {
        const declared = new Set(
            LEDGER.identityRoles.map((entry) => entry.role.replace(/\.N$/, ''))
        );
        for (const cls of LEDGER.classes) {
            for (const role of Object.keys(cls.identity)) {
                const base = role
                    .replace(/\.\d+$/, '')
                    .replace(/^routeParam\..*/, 'routeParam.X');
                expect(
                    declared.has(base) || declared.has('routeParam.X'),
                    `class "${cls.id}" declares role "${role}", which §5 does not describe`
                ).toBe(true);
            }
        }
    });

    /**
     * Nondeterminism is normalised NARROWLY, and only in the two places it exists.
     *
     * Nothing else may carry a marker. A ledger that relaxed a comparison anywhere it was convenient
     * would stop being a contract.
     */
    it('normalises nondeterminism only where it is declared', () => {
        const serialised = JSON.stringify(LEDGER);
        const markers = [...serialised.matchAll(/@(\w+):/g)].map(
            (match) => match[1]
        );
        expect(new Set(markers)).toEqual(new Set(['path', 'opaque']));
        expect(
            serialised,
            'the ledger must carry no absolute origin'
        ).not.toMatch(/https?:\/\//);
        expect(
            serialised,
            'the ledger must carry no literal timestamp'
        ).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
        expect(serialised, 'the ledger must carry no access token').not.toMatch(
            /AccessToken|Bearer /
        );
    });

    it('keeps every media-source id distinguishable from the class identity it belongs to', () => {
        for (const cls of LEDGER.classes) {
            const sources = Object.entries(cls.identity)
                .filter(([role]) => role.startsWith('mediaSourceId.'))
                .map(([, value]) => value);
            expect(
                new Set(sources).size,
                `class "${cls.id}" repeats a media-source id`
            ).toBe(sources.length);
        }
    });

    it('records every role collision it has', () => {
        for (const cls of LEDGER.classes) {
            const byValue = new Map<string, string[]>();
            for (const [role, value] of Object.entries(cls.identity)) {
                byValue.set(value, [...(byValue.get(value) ?? []), role]);
            }
            const expected = [...byValue.values()]
                .filter((roles) => roles.length > 1)
                .flat()
                .sort();
            expect(
                cls.roleCollisions.map((entry) => entry.role).sort()
            ).toEqual(expected);
        }
    });
});

describe('migrated Item Details ledger — the document is derived from the fixture', () => {
    it('states the same totals', () => {
        expect(DOCUMENT).toContain(
            `| Equivalence classes | ${totals.classes} |`
        );
        expect(DOCUMENT).toContain(
            `Unique request signatures: **${totals.uniqueRequestSignatures}**. ` +
                `Unique action signatures: **${totals.uniqueActionSignatures}**.`
        );
        expect(DOCUMENT).toContain(
            `Declared navigation affordances: **${totals.navigation}**.`
        );
        expect(DOCUMENT).toContain(
            `| **total** | | **${totals.requests}** | **${totals.absentRequests}** | ` +
                `**${totals.actions}** | **${totals.absentActions}** | **${totals.localOnly}** | ` +
                `**${totals.disabled}** | **${totals.delegated}** | **${totals.variants}** |`
        );
    });

    it('states the same per-class counts', () => {
        for (const cls of LEDGER.classes) {
            const row =
                `| \`${cls.id}\` | \`${cls.itemType}\` | ${cls.requests.length} | ` +
                `${cls.absentRequests.length} | ${cls.actions.length} | ${cls.absentActions.length} | ` +
                `${cls.localOnly.length} | ${cls.disabledControls.length} | ` +
                `${cls.delegatedControls.length} | ${cls.variants.length} |`;
            expect(
                DOCUMENT,
                `the coverage matrix row for "${cls.id}" is stale`
            ).toContain(row);
        }
    });

    it('names every request row and every action row', () => {
        for (const cls of LEDGER.classes) {
            for (const row of cls.requests) {
                expect(
                    DOCUMENT,
                    `request row "${cls.id}/${row.id}" is missing from the document`
                ).toContain(
                    `| \`${row.id}\` | \`${row.surface}\` | \`${row.member}\` |`
                );
            }
            for (const row of cls.actions) {
                expect(
                    DOCUMENT,
                    `action row "${cls.id}/${row.id}" is missing from the document`
                ).toContain(`| \`${row.id}\` | ${row.trigger} |`);
            }
        }
    });

    it('names every surface, phase, identity role and effect-frontier module', () => {
        for (const entry of LEDGER.surfaces)
            expect(DOCUMENT).toContain(`| \`${entry.id}\` |`);
        for (const entry of LEDGER.causality.phases)
            expect(DOCUMENT).toContain(`| \`${entry.id}\` |`);
        for (const entry of LEDGER.identityRoles)
            expect(DOCUMENT).toContain(`| \`${entry.role}\` |`);
        for (const entry of LEDGER.effectFrontier) {
            expect(
                DOCUMENT,
                `effect-frontier module "${entry.module}" is missing`
            ).toContain(
                `| \`${entry.module}\` | \`${entry.classification}\` |`
            );
        }
    });

    it('repeats the presentation-binding status the fixture records', () => {
        expect(DOCUMENT).toContain(
            `Today \`${LEDGER.presentationBinding.capability}\` is read by the route: ` +
                `**${LEDGER.presentationBinding.readByRoute}**`
        );
    });

    for (const heading of [
        '## 1. What this record is, and what it is not',
        '## 2. Route inputs',
        '## 3. Outward surfaces',
        '## 4. Causal phases',
        '## 5. Identity roles',
        '## 6. Coverage matrix',
        '## 7. Requests, per class',
        '## 8. Actions, per class',
        '## 9. Local-state variants',
        '## 10. Controls that reach nothing outward',
        '## 11. Navigation affordances',
        '## 12. Effect frontier',
        '## 13. What Step 2 must preserve',
        '## 14. Known limits of this record'
    ]) {
        it(`has the section "${heading}"`, () => {
            expect(DOCUMENT).toContain(heading);
        });
    }
});

describe('migrated Item Details ledger — the historical record is untouched', () => {
    it('the P5 fixture is byte-identical to the one #133 froze', () => {
        const actual = createHash('sha256')
            .update(readFileSync(LEGACY_FIXTURE_PATH))
            .digest('hex');
        expect(
            actual,
            'tests/fixtures/item-details/legacy-contract.json changed. Step 1c freezes the MIGRATED ' +
                'route; rewriting the historical record would destroy the evidence the migration was ' +
                'judged against.'
        ).toBe(LEDGER.historicalContract.sha256);
    });

    it('is labelled historical, and does not claim to supersede it', () => {
        expect(LEDGER.historicalContract.status).toBe('historical');
        expect(LEDGER.historicalContract.unchangedBy).toBe('this ledger');
        expect(DOCUMENT).toContain('It does **not** supersede');
    });

    it('still covers the same 24 equivalence classes', () => {
        const fromLegacy = (legacyContract.classes as { id: string }[])
            .map((entry) => entry.id)
            .sort();
        expect(LEDGER.classes.map((cls) => cls.id).sort()).toEqual(fromLegacy);
        expect(fromLegacy).toHaveLength(24);
    });
});

describe('migrated Item Details ledger — the route is bound', () => {
    /*
     * Inverted by #129 Step 2, as a pair.
     *
     * Step 1c asserted both halves were false and said Step 2 must move them together: a route
     * that reads a recipe it has not DECLARED lets a theme change the page while
     * `resolvePresentation` cannot report a fallback for it, and a renderer that declares a recipe
     * no route READS is a contract lying about what it implements. Keeping both assertions —
     * inverted — is what stops either half regressing on its own.
     */
    it('presentation.page.itemDetails is declared by the Web renderer', () => {
        expect(
            LEDGER.presentationBinding.declaredInWebRendererCapabilities
        ).toBe(true);
        expect(WEB_RENDERER_CAPABILITIES as readonly string[]).toContain(
            'presentation.page.itemDetails'
        );
    });

    it('the ledger records the route as reading a recipe', () => {
        expect(LEDGER.presentationBinding.readByRoute).toBe(true);
    });

    /**
     * The platform default was CORRECTED, not adopted.
     *
     * Step 1c pinned `PLATFORM_DEFAULT_PRESENTATION` to the P5 record's declaration so the Step 2
     * decision surface — the gap between that declaration and the migrated composition — could not
     * be erased by a quiet edit. Step 2 closed the gap the only honest way: the declaration was
     * wrong (0 of 24 classes matched it, by this fixture's own verdicts), so it was widened to name
     * the families the route actually renders, and the P5 fixture was left byte-identical.
     *
     * What replaces the old equality is stronger. The hero is still the P5 value; every section
     * name the P5 default declared is still published, so no manifest that was valid became
     * invalid; and the resulting order is proven against the pre-binding capture, class by class,
     * in `itemDetails.recipe.test.tsx`.
     */
    it('keeps the P5 hero and every P5 section name, and widens rather than replaces', () => {
        expect(PLATFORM_DEFAULT_PRESENTATION.page.itemDetails.hero).toBe(
            legacyContract.platformDefault.hero
        );
        for (const section of legacyContract.platformDefault.sections) {
            expect(
                PLATFORM_DEFAULT_PRESENTATION.page.itemDetails
                    .sections as readonly string[]
            ).toContain(section);
        }
        expect(
            PLATFORM_DEFAULT_PRESENTATION.page.itemDetails.sections.length
        ).toBeGreaterThan(legacyContract.platformDefault.sections.length);
    });

    it('no ledger row mentions a recipe, a theme id or the platform default', () => {
        // Unchanged, and the point of it is unchanged: the REQUEST AND ACTION rows describe what
        // the route does outwardly, and no recipe may appear in that description.
        const serialised = JSON.stringify(LEDGER.classes);
        expect(serialised).not.toMatch(
            /usePresentation|PLATFORM_DEFAULT_PRESENTATION|recipe|themeId/i
        );
    });

    it('the effect frontier gained only non-outward modules', () => {
        // The binding added a context read, a vocabulary, a default and a settings read. If any of
        // them had been outward it would name a surface, and the ledger would be describing an
        // effect a theme could reach.
        const added = [
            'ui/presentation/PresentationContext',
            'themes/platform/contract',
            'themes/platform/resolvePresentation',
            'scripts/settings/userSettings'
        ];
        for (const module of added) {
            const entry = LEDGER.effectFrontier.find(
                (row) => row.module === module
            );
            expect(entry, `${module} is unclassified`).toBeDefined();
            expect(entry?.surface, module).toBeNull();
            expect(['PURE', 'CAPABILITY'], module).toContain(
                entry?.classification
            );
        }
    });
});
