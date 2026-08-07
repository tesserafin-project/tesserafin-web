/**
 * Keeps the three records of the legacy Item Details contract from disagreeing.
 *
 *   docs/tesserafin/item-details-legacy-contract.md  — the prose record a human reads
 *   tests/fixtures/item-details/legacy-contract.json — the executable record the suite asserts
 *   tests/fixtures/item-details/cases.ts             — the inputs that produce it
 *
 * A frozen contract that lives in two places drifts. This suite makes drift a failing test rather
 * than a discovery made during the migration.
 *
 * It also pins the platform-default comparison. The verdicts in the fixture are an INPUT to the
 * later binding step (#129 Step 2), so changing one has to be a deliberate edit to both the fixture
 * and the document, not a quiet change to a JSON field.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PLATFORM_DEFAULT_PRESENTATION } from '../../src/themes/platform/resolvePresentation';
import { WEB_RENDERER_CAPABILITIES } from '../../src/themes/platform/contract';
import { ITEM_DETAILS_CASES } from '../fixtures/item-details/cases';
import contract from '../fixtures/item-details/legacy-contract.json';

const REPO_ROOT = resolve(__dirname, '..', '..');
const DOCUMENT_PATH = join(
    REPO_ROOT,
    'docs',
    'tesserafin',
    'item-details-legacy-contract.md'
);
const DOCUMENT = readFileSync(DOCUMENT_PATH, 'utf8');

const VERDICTS = ['MATCH', 'MISMATCH', 'NOT APPLICABLE', 'AMBIGUOUS'];

interface ContractClass {
    id: string;
    description: string;
    itemTypes: string[];
    routeParams: Record<string, string>;
    sections: string[];
    headings: string[];
    actions: string[];
    trackSelectors: string[];
    userDataControls: string[];
    reads: { legacy: string[]; sdk: string[] };
    nestedReactRoots: number;
    nestedReactRootsUnmounted: number;
    platformDefaultComparison: string;
}

const CLASSES = contract.classes as ContractClass[];

describe('legacy Item Details contract — fixture and document agree', () => {
    it('every equivalence class has a case fixture, and vice versa', () => {
        const fromContract = CLASSES.map((entry) => entry.id).sort();
        const fromCases = ITEM_DETAILS_CASES.map((entry) => entry.id).sort();
        expect(fromCases).toEqual(fromContract);
    });

    it('class ids are unique', () => {
        const ids = CLASSES.map((entry) => entry.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('every class is named in the document', () => {
        for (const entry of CLASSES) {
            expect(
                DOCUMENT,
                `class "${entry.id}" is in the fixture but not in ${DOCUMENT_PATH}`
            ).toContain(`\`${entry.id}\``);
        }
    });

    it('every class route parameter is one the route actually resolves', () => {
        for (const entry of CLASSES) {
            const parameters = Object.keys(entry.routeParams);
            expect(parameters).toHaveLength(1);
            expect(
                contract.route.parameterResolutionOrder as string[]
            ).toContain(parameters[0]);
        }
    });

    it('the case fixture uses the route parameter the contract records', () => {
        for (const entry of CLASSES) {
            const testCase = ITEM_DETAILS_CASES.find(
                (candidate) => candidate.id === entry.id
            );
            expect(Object.keys(testCase?.params ?? {})).toEqual(
                Object.keys(entry.routeParams)
            );
        }
    });

    it('the document repeats each recorded platform-default verdict', () => {
        // Scoped to §2's matrix: §1's parameter table has rows whose first cell is also a bare
        // identifier (`genre`, `musicgenre`), and matching those would compare the wrong row.
        const matrix = DOCUMENT.slice(
            DOCUMENT.indexOf('## 2. Behavioural equivalence-class matrix'),
            DOCUMENT.indexOf('## 3. Ordered pre-migration composition')
        );
        expect(matrix.length).toBeGreaterThan(0);

        for (const entry of CLASSES) {
            const row = matrix
                .split('\n')
                .find((line) => line.startsWith(`| \`${entry.id}\` |`));
            expect(
                row,
                `no matrix row for class "${entry.id}" in ${DOCUMENT_PATH}`
            ).toBeDefined();
            expect(
                row,
                `the document's verdict for "${entry.id}" does not match the fixture`
            ).toContain(`\`${entry.platformDefaultComparison}\``);
        }
    });

    it('every class records a section list and a read inventory', () => {
        for (const entry of CLASSES) {
            expect(entry.sections.length).toBeGreaterThan(0);
            expect(entry.reads.legacy.length).toBeGreaterThan(0);
            expect(entry.description.length).toBeGreaterThan(0);
        }
    });

    it('every nested React root the route creates is recorded as unmounted', () => {
        for (const entry of CLASSES) {
            expect(entry.nestedReactRootsUnmounted).toBe(
                entry.nestedReactRoots
            );
        }
    });
});

describe('legacy Item Details contract — platform-default comparison', () => {
    /**
     * What this block asserted before #129 Step 2, and why it no longer can.
     *
     * It used to require `contract.platformDefault.sections` to EQUAL the live
     * `PLATFORM_DEFAULT_PRESENTATION`. That was the right assertion for as long as the default was
     * unread: the fixture recorded the declaration so the two could not drift while nobody was
     * looking. Step 2 read it, and the declaration turned out to be wrong — five names in an order
     * no equivalence class rendered, which this very fixture recorded as 13 MISMATCH / 11 NOT
     * APPLICABLE / 0 MATCH. Binding it unchanged would have recomposed the page for every user.
     *
     * The fixture is checksum-frozen (`ledger.consistency.test.ts`) and is not edited. It is now
     * read as HISTORY — the declaration as it stood before the binding — and the live default is
     * asserted against the thing that actually matters instead: the composition the pre-binding
     * route rendered, class by class, in `itemDetails.recipe.test.tsx`.
     */
    it('records the platform default as it stood before the binding', () => {
        expect(contract.platformDefault.boundByRoute).toBe(false);
        expect(contract.platformDefault.hero).toBe('backdrop');
        expect(contract.platformDefault.sections).toEqual([
            'overview',
            'cast',
            'episodes',
            'related',
            'mediaInfo'
        ]);
    });

    it('keeps the hero the historical record declared, and widens only the sections', () => {
        // `hero` needed no correction: the pre-binding route rendered the backdrop layer for every
        // class that may have one, which is what `backdrop` means.
        expect(PLATFORM_DEFAULT_PRESENTATION.page.itemDetails.hero).toBe(
            contract.platformDefault.hero
        );
        // Widened, never narrowed: every name the historical default declared is still published.
        for (const section of contract.platformDefault.sections) {
            expect(
                PLATFORM_DEFAULT_PRESENTATION.page.itemDetails
                    .sections as readonly string[]
            ).toContain(section);
        }
    });

    it('uses only the four permitted verdicts', () => {
        for (const entry of CLASSES) {
            expect(VERDICTS).toContain(entry.platformDefaultComparison);
        }
    });

    it('claims no MATCH, because no class reproduces the declared composition', () => {
        // A MATCH would mean the legacy route already renders the declared `sections` in the
        // declared order. Section 13 of the document explains why none does. If a future edit
        // claims one, it has to change this test too — which is the point.
        expect(
            CLASSES.filter(
                (entry) => entry.platformDefaultComparison === 'MATCH'
            )
        ).toEqual([]);
    });

    /**
     * The binding, asserted in BOTH directions.
     *
     * Until #129 Step 2 this block said the opposite: the capability was off
     * `WEB_RENDERER_CAPABILITIES` and no file in the slice called `usePresentation()`. Those were
     * two halves of one claim, and Step 1c's comment said Step 2 must move both together or
     * neither — because a route that reads a recipe it has not DECLARED lets a theme change the
     * page while `resolvePresentation` cannot report a fallback for it, and a renderer that
     * declares a recipe no route READS is a contract lying about what it implements.
     *
     * So the inverted assertions are kept as a pair, not deleted. Either one alone would let the
     * other half regress silently.
     */
    it('declares the capability the route now reads', () => {
        expect(WEB_RENDERER_CAPABILITIES as readonly string[]).toContain(
            'presentation.page.itemDetails'
        );
    });

    it('reads the recipe exactly once, at the composition boundary', () => {
        const roots = [
            resolve(REPO_ROOT, 'src/apps/modern/features/details'),
            resolve(REPO_ROOT, 'src/apps/modern/routes/details.tsx')
        ];

        const files: string[] = [];
        const walk = (target: string) => {
            if (!existsSync(target)) return;
            if (statSync(target).isFile()) {
                if (/\.(ts|tsx)$/.test(target)) files.push(target);
                return;
            }
            for (const entry of readdirSync(target)) {
                walk(join(target, entry));
            }
        };
        roots.forEach(walk);

        expect(
            files.length,
            'the migrated slice was not found'
        ).toBeGreaterThan(0);

        const readers: string[] = [];
        for (const file of files) {
            const source = readFileSync(file, 'utf8')
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/^\s*\/\/.*$/gm, '');
            if (/\busePresentation\s*\(/.test(source)) readers.push(file);
        }

        // One reader, and it is the composition boundary. A second call site would mean two parts
        // of the page could disagree about the recipe mid-render.
        expect(readers.map((file) => file.replace(`${REPO_ROOT}/`, ''))).toEqual(
            ['src/apps/modern/features/details/components/ItemDetailsView.tsx']
        );
    });

    it('never parses a manifest or persisted record inside the route', () => {
        // The recipe arrives already resolved. A route that validated a manifest or read
        // `localStorage` itself would drag the authoring and schema code into its async chunk —
        // the delivery half of the binding, gated separately by `verify:delivery-budget`.
        const roots = [
            resolve(REPO_ROOT, 'src/apps/modern/features/details'),
            resolve(REPO_ROOT, 'src/apps/modern/routes/details.tsx')
        ];

        const files: string[] = [];
        const walk = (target: string) => {
            if (!existsSync(target)) return;
            if (statSync(target).isFile()) {
                if (/\.(ts|tsx)$/.test(target)) files.push(target);
                return;
            }
            for (const entry of readdirSync(target)) walk(join(target, entry));
        };
        roots.forEach(walk);

        for (const file of files) {
            if (file.includes('.test.')) continue;
            const source = readFileSync(file, 'utf8')
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/^\s*\/\/.*$/gm, '');
            expect(source, `${file} parses a manifest`).not.toMatch(
                /validateManifest|theme\.schema\.json|loadAppliedPresentation|localStorage/
            );
        }
    });
});

describe('legacy Item Details contract — the document states its own limits', () => {
    for (const heading of [
        '## 1. Route inputs and resolution rules',
        '## 2. Behavioural equivalence-class matrix',
        '## 3. Ordered pre-migration composition',
        '## 4. Hero and image rules',
        '## 5. Playback and media-source behaviour',
        '## 6. User-data mutations',
        '## 7. Context menu and administrative actions',
        '## 8. Data-read inventory',
        '## 9. Nested React roots and cleanup ownership',
        '## 10. Loading, empty, error and permission states',
        '## 11. Keyboard and focus behaviour',
        '## 12. Findings',
        '## 13. Platform-default comparison',
        '## 14. Explicit exclusions from the future theme contract',
        '## 15. Known evidence limitations'
    ]) {
        it(`has the section "${heading}"`, () => {
            expect(DOCUMENT).toContain(heading);
        });
    }

    for (const classification of [
        'MUST PRESERVE',
        'MAY CHANGE',
        'MUST RETIRE',
        'SUSPECT'
    ]) {
        it(`classifies findings as ${classification}`, () => {
            expect(DOCUMENT).toContain(`### ${classification}`);
        });
    }
});
