import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The ratchet behind `docs/tesserafin/presentation-boundary.md`.
 *
 * The inventory document is only worth writing if it cannot quietly go stale, and the way it goes
 * stale is that a modern route regains an inherited dependency nobody notices. So this test reads
 * each route slice's own source and asserts the prohibited dependencies it declares against a
 * RECORDED BASELINE.
 *
 * Two directions, both deliberate:
 *
 *   - a route that gains a prohibited dependency fails, because the found set must be a subset of
 *     the baseline;
 *   - a baseline entry that no longer occurs ALSO fails, so the baseline can only shrink and cannot
 *     accumulate stale permissions. Removing a dependency is a two-line change here, which is the
 *     right cost; leaving a lie in the document is free, which is the wrong one.
 *
 * The Home vertical has an empty baseline and must keep it. That is the claim the page-composition
 * work rests on: a theme composes Home through published `src/ui` primitives and the resolved
 * recipe, and there is no legacy selector or generated MUI class it could target instead.
 *
 * ## Why this scans a SLICE and not a transitive closure
 *
 * The first version of this test walked the full transitive import graph. Every route failed, on
 * the same chain:
 *
 *   HomeSection → lib/globalize → scripts/settings/userSettings → lib/jellyfin-apiclient
 *   → utils/dashboard → components/router/appRouter → RootAppRouter → routes → AppLayout
 *   → … → utils/sections → components/cardbuilder/utils/shape
 *
 * The module graph is cyclic through the app shell: importing the translation helper reaches the
 * router, and the router reaches every route in the application. Transitive reachability therefore
 * says nothing at all about any individual route, and a gate that says nothing is worse than none,
 * because it looks like it says something.
 *
 * What a THEMING boundary actually asks is narrower and answerable: does this route's own code
 * depend on a legacy presentation mechanism? So the scan is the slice's own source files and their
 * DIRECT import specifiers. Regaining a prohibited dependency means writing that import inside the
 * slice, which is exactly the event this must catch. Bundle-graph reachability is a separate
 * concern with a separate gate (`verify:bundle-budget`), and the inventory document says so rather
 * than implying this test covers it.
 */

/*
 * Lives under `tests/` and not beside the routes it maps, which would have read better. It cannot:
 * webpack builds a lazy context over `src/apps/modern/routes/` (`./apps/modern/routes/ lazy
 * ^\.\/.*$`) to code-split the route modules, so EVERY file in that directory is pulled into the
 * production bundle — including a test. This file imports `node:fs`, which webpack cannot resolve
 * for the browser, and `npm run build:production` failed with three `Module not found` errors while
 * `npm run test` stayed green. `tests/` is outside every webpack context and still collected by
 * vitest (`vite.config.ts` excludes only the Playwright suites and `scripts/`).
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../../src');

/**
 * The dependencies a modern, theme-composable route must not have.
 *
 * Each is on this list because it would leak into the THEME CONTRACT if a route relied on it — a
 * theme would end up having to target a Jellyfin class, an undocumented DOM shape or a generated
 * MUI class name to shape that route. Inherited dependencies that cannot leak that way (the app
 * shell's `components/Page`, `libraryMenu.setTitle`, the `.skinHeader` class toggle) are recorded
 * in the inventory document and deliberately NOT here: they are not theming surfaces, and widening
 * this list to cover them would turn a bounded gate into whole-application modernisation.
 */
const PROHIBITED: readonly {
    id: string;
    why: string;
    match: (specifier: string, source: string) => boolean;
}[] = [
    {
        id: 'cardbuilder',
        why: 'legacy imperative card builder; its DOM and classes are not a published theming surface',
        match: (specifier) => specifier.startsWith('components/cardbuilder')
    },
    {
        id: 'renderComponent',
        why: 'nested React roots make the composition tree unobservable to the presentation context',
        match: (_specifier, source) => /\brenderComponent\b/.test(source)
    },
    {
        id: 'jellyfin-ux-web',
        why: 'inherited third-party asset package; not a Tesserafin theming surface',
        match: (specifier) => specifier.includes('@jellyfin/ux-web')
    },
    {
        id: 'legacy-theme-stylesheet',
        why: 'a route reaching a theme stylesheet directly bypasses the token pipeline',
        match: (specifier) => /themes\/[a-z.]+\/theme\.scss$/.test(specifier)
    },
    {
        id: 'mui-internals',
        why: 'generated MUI class names are not a stable public theming API',
        match: (specifier) =>
            specifier.startsWith('@mui/material/styles') ||
            specifier.includes('@mui/private') ||
            specifier.includes('@mui/base')
    },
    {
        id: 'legacy-theme-event-bus',
        why: 'the legacy themeManager event path predates PresentationContext and cannot report fallbacks',
        match: (specifier) => specifier.includes('scripts/themeManager')
    }
];

const IMPORT_PATTERN =
    /(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;

function everySourceFileUnder(directory: string): string[] {
    if (!existsSync(directory)) return [];
    const out: string[] = [];
    for (const entry of readdirSync(directory)) {
        const full = join(directory, entry);
        if (statSync(full).isDirectory()) {
            out.push(...everySourceFileUnder(full));
        } else if (
            /\.(ts|tsx|js|jsx)$/.test(entry) &&
            !entry.includes('.test.') &&
            !entry.includes('.a11y.')
        ) {
            out.push(full);
        }
    }
    return out;
}

/** Source with comments removed. */
function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Every prohibited dependency a slice's own code declares, as a sorted list of ids. */
function scanSlice(directory: string): string[] {
    const found = new Set<string>();

    for (const file of everySourceFileUnder(directory)) {
        // Comments stripped first. `home/utils/mediaCardProps.ts` names
        // `components/cardbuilder/utils/url.ts` five times — every one of them in prose explaining
        // why it reimplements that helper INSTEAD of importing it. A gate that a doc comment can
        // trip is a gate that gets weakened until it passes, and the honest fix is to read code.
        const source = stripComments(readFileSync(file, 'utf8'));
        for (const rule of PROHIBITED) {
            if (rule.match('', source)) found.add(rule.id);
        }

        IMPORT_PATTERN.lastIndex = 0;
        let match = IMPORT_PATTERN.exec(source);
        while (match) {
            const specifier = match[1] ?? match[2] ?? match[3];
            if (specifier) {
                for (const rule of PROHIBITED) {
                    if (rule.match(specifier, '')) found.add(rule.id);
                }
            }
            match = IMPORT_PATTERN.exec(source);
        }
    }

    return [...found].sort();
}

/**
 * The recorded state of the boundary, one entry per modern route family.
 *
 * These are the exact findings `docs/tesserafin/presentation-boundary.md` reports. When one
 * changes, both change together — that is the whole point of keeping the inventory next to a test.
 */
const BASELINE: Readonly<Record<string, readonly string[]>> = {
    // The bound page-composition vertical. Empty, and it must stay empty: this is the claim that
    // a theme can compose Home entirely through published `src/ui` primitives.
    'apps/modern/features/home': [],
    // The design system itself. If a primitive reached one of these, every route that uses it
    // would inherit the leak.
    ui: [],
    // The theme platform: contract, resolver, manifests, applied-presentation record.
    'themes/platform': [],
    // Bound but not composed: these read `PresentationContext` and are theme-platform ready.
    'apps/modern/features/themeStudio': [],
    // The second bound page-composition vertical, and empty for the same reason Home's is: a theme
    // composes `/library/:libraryId` through published `src/ui` primitives and the resolved recipe.
    // The `filters: 'drawer'` surface is `ui/components/FilterDrawer`, deliberately not MUI's
    // `Drawer`, so no generated class name became the only thing a theme could target.
    'apps/modern/features/library': [],
    'apps/modern/features/libraries': ['cardbuilder', 'mui-internals'],
    // The third page vertical, and MIGRATED rather than bound (#129 Step 1b). Empty from the day
    // it exists: the route that replaced `itemDetails/index.js` composes through published
    // `src/ui` primitives, so there is no `cardbuilder` DOM, no nested React root and no generated
    // MUI class name a theme could be forced to target. Step 2 binds a recipe onto this; it must
    // find the boundary already clean.
    'apps/modern/features/details': []
};

describe('the modern/legacy presentation boundary — ratchet', () => {
    it.each(Object.entries(BASELINE))(
        '%s declares no prohibited dependency beyond its recorded baseline',
        (relative, baseline) => {
            const found = scanSlice(join(SRC, relative));
            for (const id of found) {
                expect(
                    baseline,
                    `${relative} declares "${id}" — ${
                        PROHIBITED.find((rule) => rule.id === id)?.why
                    }`
                ).toContain(id);
            }
        }
    );

    it.each(Object.entries(BASELINE))(
        '%s does not carry a stale baseline entry',
        (relative, baseline) => {
            // The ratchet direction. A baseline that outlives the dependency it excused is how a
            // boundary document turns back into a wish list.
            const found = new Set(scanSlice(join(SRC, relative)));
            for (const id of baseline) {
                expect(
                    found,
                    `${relative} no longer declares "${id}"; remove it from BASELINE`
                ).toContain(id);
            }
        }
    );
});

function code(file: string): string {
    return stripComments(readFileSync(file, 'utf8'));
}

describe('no component knows a theme', () => {
    /*
     * The coupling RFC-0007 §4.6 exists to prevent. The moment a component can branch on a theme id,
     * adding a theme means editing components — and every theme after the first becomes a diff
     * across the design system rather than a manifest.
     *
     * Scoped to the places it would actually appear: the design system, and every page vertical
     * that consumes a resolved recipe. `themes/` itself is excluded on purpose — the registry and
     * the manifest lookup exist precisely to know theme ids in one place.
     *
     * `apps/modern/features/library` joined this list with its binding. Classic and Glass declare
     * materially different Library recipes, and no file in that slice may name either of them.
     */
    const SCOPES = [
        'ui',
        'apps/modern/features/home',
        'apps/modern/features/library',
        // Not bound yet, and listed anyway: the migration is what makes a later binding possible,
        // so a theme id must never reach this slice in the first place.
        'apps/modern/features/details'
    ];

    it.each(SCOPES)('%s names no official theme id', (scope) => {
        for (const file of everySourceFileUnder(join(SRC, scope))) {
            expect(code(file), `${file} names a theme id`).not.toMatch(
                /['"]official\./
            );
        }
    });

    it.each(SCOPES)('%s never branches on a theme id', (scope) => {
        for (const file of everySourceFileUnder(join(SRC, scope))) {
            expect(code(file), `${file} branches on a theme id`).not.toMatch(
                /themeId\s*[=!]==/
            );
        }
    });
});
