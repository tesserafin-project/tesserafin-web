/**
 * Builds the fixture page for `../glass-interaction-profiles.spec.ts`.
 *
 * ## Why a fixture page rather than the running app
 *
 * The claim under test is entirely about the CSS bridge: does overriding `blur.md` in a profile
 * partial actually move the **computed `backdrop-filter`** of a Glass surface in a real browser?
 * That question involves the token sources, the generated custom properties, the `_glass-surface`
 * mixin and the browser's style engine — and nothing else. It needs no media library, no session
 * and no router, so it is proved against a page that contains exactly those parts and no app
 * shell. The app-level journey (selecting Glass actually pushes its tokens onto `/home` and
 * `/library`) is already covered by `../theme-glass.spec.ts`, which does require a live server.
 *
 * ## Everything on this page is the real artifact
 *
 * Nothing here is a re-implementation, and in particular **nothing about the CSSOM is mocked** —
 * the assertions read `getComputedStyle` out of Chromium's own style engine:
 *
 *   - the token custom properties are the committed generated files
 *     (`src/ui/tokens/official.{glass,classic}.css`), read from disk verbatim;
 *   - the consuming rule is `src/ui/components/Surface/Surface.scss` compiled by the project's own
 *     `sass` dependency — the real `.rf-surface--glass` rule, which `@include`s the real
 *     `_glass-surface.scss` mixin, so the property it reads is whatever the mixin actually reads;
 *   - the projector is `src/themes/applyProfiles.ts` bundled by esbuild — the same module
 *     `useInteractionProfiles` calls in production, not a copy of its logic.
 *
 * The only thing the fixture supplies is the trigger: the spec calls the projector directly
 * instead of waiting for a low battery or a TV layout. That substitutes a signal *input*, which is
 * the one part of the chain a headless browser cannot produce on demand; every downstream link —
 * resolution, projection, derivation, cascade, computed style — is the production one. Signal
 * wiring and teardown are covered separately, as unit tests, in
 * `src/themes/interactionProfileSignals.test.ts`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import * as esbuild from 'esbuild';
import * as sass from 'sass';

/**
 * Walks up from the current directory to the repo root.
 *
 * Playwright transpiles specs to CommonJS, so `import.meta.url` is not available here; and the
 * runner's working directory is only the repo root by convention. Probing for a file this fixture
 * actually depends on makes the lookup independent of both, and fails loudly rather than reading
 * an empty stylesheet and asserting against nothing.
 */
const findRepoRoot = (): string => {
    let dir = process.cwd();
    for (;;) {
        if (existsSync(resolve(dir, 'reefin-design/web/backdrop-filter.mjs'))) {
            return dir;
        }
        const parent = dirname(dir);
        if (parent === dir) {
            throw new Error(
                `could not locate the reefin-web repo root from ${process.cwd()}`
            );
        }
        dir = parent;
    }
};

const REPO_ROOT = findRepoRoot();

const readRepoFile = (relativePath: string): string =>
    readFileSync(resolve(REPO_ROOT, relativePath), 'utf-8');

/** The global the bundled projector is exposed under, for the spec to drive from `page.evaluate`. */
export const PROJECTOR_GLOBAL = 'RfProfiles';

/** The element the spec measures: the real `Surface` glass variant. */
export const PROBE_SELECTOR = '#probe';

/** The real `FloatingSidebar` rail, for the specs that measure the sidebar's own surface. */
export const SIDEBAR_SELECTOR = '.rf-floating-sidebar';

/** A `FloatingSidebar` entry button, for focus-ring and target-size measurements. */
export const SIDEBAR_ITEM_SELECTOR = '.rf-floating-sidebar__button';

/**
 * Compiles a production stylesheet with the project's own sass compiler.
 *
 * Autoprefixer is not run. It would only add `-webkit-backdrop-filter`, which Chromium neither
 * needs nor reports through `getComputedStyle().backdropFilter`, so its absence cannot mask a
 * difference the spec is looking for.
 */
const compileCss = (relativePath: string): string =>
    sass.compile(resolve(REPO_ROOT, relativePath), {
        loadPaths: [resolve(REPO_ROOT, 'src')]
    }).css;

/**
 * Bundles the production projector for the browser, exposing `applyProfilesToRoot` (and the two
 * attribute names) on `window[PROJECTOR_GLOBAL]`.
 */
const bundleProjector = async (): Promise<string> => {
    const result = await esbuild.build({
        entryPoints: [resolve(REPO_ROOT, 'src/themes/applyProfiles.ts')],
        bundle: true,
        format: 'iife',
        globalName: PROJECTOR_GLOBAL,
        platform: 'browser',
        target: 'es2020',
        write: false
    });

    return result.outputFiles[0].text;
};

/**
 * The fixture page: both themes' generated tokens, the real compiled `Surface` and
 * `FloatingSidebar` rules, the real projector, and the probe elements.
 *
 * `<html>` carries `data-rf-theme`/`data-rf-mode` exactly as `useAppTheme` sets them, so the
 * generated stylesheets' `[data-rf-theme="…"]`/`[data-rf-mode="…"]` tiers resolve the same way they
 * do in the app — and so a spec can flip to Classic, or to Glass's light mode, and re-run the
 * identical assertions.
 *
 * @param themeId The *token* theme id, i.e. what `useAppTheme` writes to `data-rf-theme`. Note that
 * `official.glass.light` is a registry entry, not a token theme: it renders `official.glass` with
 * `mode: 'light'` (see `src/themes/registry.ts#tokenThemeId`), which is exactly the pair this
 * fixture takes.
 * @param mode The palette mode, i.e. `data-rf-mode`.
 */
export const buildFixtureHtml = async (
    themeId: 'official.glass' | 'official.classic',
    mode: 'dark' | 'light' = 'dark'
): Promise<string> => {
    const [surfaceCss, sidebarCss, projectorJs] = await Promise.all([
        Promise.resolve(compileCss('src/ui/components/Surface/Surface.scss')),
        Promise.resolve(
            compileCss(
                'src/ui/components/FloatingSidebar/FloatingSidebar.scss'
            )
        ),
        bundleProjector()
    ]);

    return `<!doctype html>
<html data-rf-theme="${themeId}" data-rf-mode="${mode}">
<head>
<meta charset="utf-8">
<style>${readRepoFile('src/ui/tokens/official.classic.css')}</style>
<style>${readRepoFile('src/ui/tokens/official.glass.css')}</style>
<style>${surfaceCss}</style>
<style>${sidebarCss}</style>
<style>
  /* Fixture-only geometry. The probe needs a size and something behind it for a backdrop filter to
     have anything to filter; neither influences the property values under assertion. */
  body { margin: 0; background: var(--rf-color-background); }
  #backdrop { position: fixed; inset: 0; background: linear-gradient(45deg, #fff, #000); }
  #probe { position: relative; width: 200px; height: 200px; }
</style>
</head>
<body>
<div id="backdrop"></div>
<div id="probe" class="rf-surface rf-surface--glass"></div>
<nav class="rf-floating-sidebar" aria-label="Primary">
  <ul class="rf-floating-sidebar__list">
    <li class="rf-floating-sidebar__item">
      <button type="button" class="rf-floating-sidebar__button" aria-current="page">
        <span class="rf-floating-sidebar__label">Home</span>
      </button>
    </li>
    <li class="rf-floating-sidebar__item">
      <button type="button" class="rf-floating-sidebar__button">
        <span class="rf-floating-sidebar__label">Library</span>
      </button>
    </li>
  </ul>
</nav>
<script>${projectorJs}</script>
</body>
</html>`;
};
