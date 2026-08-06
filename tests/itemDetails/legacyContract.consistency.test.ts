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
import { readFileSync } from 'node:fs';
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
    it('records the platform default exactly as the platform declares it', () => {
        expect(contract.platformDefault.hero).toBe(
            PLATFORM_DEFAULT_PRESENTATION.page.itemDetails.hero
        );
        expect(contract.platformDefault.sections).toEqual(
            PLATFORM_DEFAULT_PRESENTATION.page.itemDetails.sections
        );
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

    it('the route still does not read the presentation it is being compared against', () => {
        // Step 1a compares; it does not bind. If `presentation.page.itemDetails` ever appears in
        // WEB_RENDERER_CAPABILITIES, the comparison above stops being hypothetical and this
        // document's §13 has to be revisited before the binding lands.
        expect(contract.platformDefault.boundByRoute).toBe(false);
        expect(WEB_RENDERER_CAPABILITIES as readonly string[]).not.toContain(
            'presentation.page.itemDetails'
        );
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
