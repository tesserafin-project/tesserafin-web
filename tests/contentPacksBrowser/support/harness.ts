/**
 * The navigation and artifact helpers every Content packs browser spec shares.
 *
 * `test` is re-exported from `tests/e2e/support/origin-inventory.ts` and NOT from
 * `@playwright/test`. That is what makes this suite part of the runtime-origin gate: the automatic
 * fixture emits a coverage marker for every spec and records every destination the application
 * reaches for, and `scripts/verify-runtime-origins.mjs --expect-specs` fails if any spec listed
 * there stopped importing this module.
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';

export { expect, test } from '../../e2e/support/origin-inventory';

export const REPO_ROOT = resolve(__dirname, '..', '..', '..');
export const DIST = join(REPO_ROOT, 'dist');
export const ARTIFACTS = join(
    REPO_ROOT,
    'test-results',
    'content-packs-browser'
);

mkdirSync(ARTIFACTS, { recursive: true });

/** The route's own page element, from `routes/contentpacks/index.tsx`. */
export const PAGE = '#contentPacksPage';

export const sel = (name: string) => `[data-content-packs="${name}"]`;

/** Open `/contentpacks` and wait for the route chunk to have rendered its heading. */
export async function openList(page: Page): Promise<void> {
    await page.goto('/#/contentpacks');
    await page.waitForSelector(`${PAGE} ${sel('mosaic-heading')}`, {
        timeout: 45_000
    });
}

/** Open one pack's detail route by its opaque id. */
export async function openPack(page: Page, packId: string): Promise<void> {
    await page.goto(`/#/contentpacks/${encodeURIComponent(packId)}`);
    await page.waitForSelector(PAGE, { timeout: 45_000 });
}

/**
 * Wait for the mosaic to have settled into one of its four states.
 *
 * Waiting on "a card exists" would make every empty/error assertion race the loading state; waiting
 * on the absence of the loading state is what actually distinguishes them.
 */
export async function settled(page: Page): Promise<void> {
    await page.waitForFunction(
        (pageSelector) => {
            const root = document.querySelector(pageSelector);
            if (!root) return false;
            return !root.querySelector('[data-rf-slot="state-loading"]');
        },
        PAGE,
        { timeout: 45_000 }
    );
}

export const shot = (page: Page, name: string) =>
    page.screenshot({ path: join(ARTIFACTS, `${name}.png`), fullPage: false });

/**
 * The dialogs, addressed by what they CONTAIN rather than by a title string.
 *
 * A locator keyed on translated copy breaks when the copy is edited, which is exactly the kind of
 * failure that teaches people to distrust a suite. `[data-content-packs="delete-scope"]` is present
 * only in the delete confirmation and `form` only in the create/rename form, so each dialog is
 * identified by its own structure.
 */
export const formDialog = (page: Page) =>
    page.locator(`[role="dialog"]:has(${sel('form')})`);
export const formSubmit = (page: Page) =>
    formDialog(page).locator('form button[type="submit"]');
export const formCancel = (page: Page) =>
    formDialog(page).locator('form button[type="button"]');
export const formName = (page: Page) =>
    formDialog(page).locator('input[name="contentPackName"]');

export const deleteDialog = (page: Page) =>
    page.locator(`[role="dialog"]:has(${sel('delete-scope')})`);
export const deleteConfirm = (page: Page) =>
    deleteDialog(page).locator('button').last();
export const deleteCancel = (page: Page) =>
    deleteDialog(page).locator('button').first();

/** The `data-content-packs` value of the element that currently holds focus. */
export const focusedMarker = (page: Page) =>
    page.evaluate(
        () =>
            document.activeElement?.getAttribute('data-content-packs') ??
            document.activeElement?.tagName.toLowerCase() ??
            null
    );

/** The card titles the mosaic is showing, in document order. */
export function cardTitles(page: Page): Promise<string[]> {
    return page.$$eval(
        `${PAGE} [data-rf-slot="media-card"] .rf-media-card__title`,
        (nodes) => nodes.map((node) => node.textContent?.trim() ?? '')
    );
}

export function cardSubtitles(page: Page): Promise<string[]> {
    return page.$$eval(
        `${PAGE} [data-rf-slot="media-card"] .rf-media-card__subtitle`,
        (nodes) => nodes.map((node) => node.textContent?.trim() ?? '')
    );
}

/** Every `href` the mosaic's cards point at, in document order. */
export function cardHrefs(page: Page): Promise<string[]> {
    // The card IS the anchor when it has an `href` — `MediaCard` renders `<a data-rf-slot=...>`,
    // it does not wrap one.
    return page.$$eval(`${PAGE} [data-rf-slot="media-card"]`, (nodes) =>
        nodes.map((node) => node.getAttribute('href') ?? '')
    );
}
