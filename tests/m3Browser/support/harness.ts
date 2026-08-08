/**
 * Navigation and artifact helpers shared by the M3 browser specs (#139).
 *
 * `test` is re-exported from `tests/e2e/support/origin-inventory.ts`, not from `@playwright/test`.
 * That is what puts this suite inside the runtime-origin gate: the automatic fixture emits a
 * coverage marker per spec and records every destination the application reaches for, and
 * `scripts/verify-runtime-origins.mjs --expect-specs` fails if a listed spec stops importing this
 * module.
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';

export { expect, test } from '../../e2e/support/origin-inventory';

export const REPO_ROOT = resolve(__dirname, '..', '..', '..');
export const DIST = join(REPO_ROOT, 'dist');
export const ARTIFACTS = join(REPO_ROOT, 'test-results', 'm3-browser');

mkdirSync(ARTIFACTS, { recursive: true });

export const PACKS_PAGE = '#wizardPacksPage';
export const USER_PAGE = '#wizardUserPage';

/** Open a wizard step and wait for its own page element. */
export async function openWizard(page: Page, step: string): Promise<void> {
    await page.goto(`/#/wizard/${step}`);
    await page.waitForSelector(
        `#wizard${step[0].toUpperCase()}${step.slice(1)}Page`,
        {
            timeout: 45_000
        }
    );
}

export async function openUserStep(page: Page): Promise<void> {
    await page.goto('/#/wizard/user');
    await page.waitForSelector(USER_PAGE, { timeout: 45_000 });
}

export async function openPacksStep(page: Page): Promise<void> {
    await page.goto('/#/wizard/packs');
    await page.waitForSelector(`${PACKS_PAGE} .wizardPackRow`, {
        timeout: 45_000
    });
}

export const shot = (page: Page, name: string) =>
    page.screenshot({ path: join(ARTIFACTS, `${name}.png`), fullPage: false });

/** Every suggestion row, in document order, as `{ name, selected }`. */
export function packRows(
    page: Page
): Promise<Array<{ name: string; selected: boolean; custom: boolean }>> {
    return page.$$eval(`${PACKS_PAGE} .wizardPackRow`, (rows) =>
        rows.map((row) => ({
            name:
                (row.querySelector('.txtPackName') as HTMLInputElement | null)
                    ?.value ?? '',
            selected:
                (row.querySelector('.chkPack') as HTMLInputElement | null)
                    ?.checked ?? false,
            custom: row.getAttribute('data-custom') === 'true'
        }))
    );
}

/**
 * Rows are addressed by `data-pack`, the name the row was BUILT with.
 *
 * Not by the name field's current value: that is a live property, not an attribute, so a CSS
 * `[value="..."]` selector would never match, and it changes the moment a row is renamed — which is
 * exactly the case the rename scenario needs to keep addressing.
 */
const packRow = (page: Page, name: string) =>
    page.locator(`${PACKS_PAGE} .wizardPackRow[data-pack="${name}"]`);

/**
 * `force` because `emby-checkbox` styles the native input out of the hit-testable box and paints its
 * own. The click still lands on the real input and still fires a real `change`.
 */
export async function selectPack(page: Page, name: string): Promise<void> {
    await packRow(page, name).locator('.chkPack').check({ force: true });
}

export async function renamePack(
    page: Page,
    from: string,
    to: string
): Promise<void> {
    await packRow(page, from).locator('.txtPackName').fill(to);
}

export async function addCustomPack(page: Page, name: string): Promise<void> {
    await page.fill(`${PACKS_PAGE} #txtCustomPackName`, name);
    await page.click(`${PACKS_PAGE} .btnAddCustomPack`);
    await page.waitForSelector(
        `${PACKS_PAGE} .wizardPackRow[data-custom="true"] .txtPackName`,
        { timeout: 10_000 }
    );
}

export const submitPacks = (page: Page) =>
    page.click(`${PACKS_PAGE} button[type="submit"]`);

/**
 * Everything the page could be persisting, read out of the browser rather than reasoned about.
 *
 * Used by the credential-lifetime proof: neither storage may contain the password anywhere, at any
 * depth, at any point after the wizard has signed in.
 */
export function persistedState(page: Page): Promise<string> {
    return page.evaluate(() => {
        const dump = (storage: Storage) =>
            Object.keys(storage)
                .map((key) => `${key}=${storage.getItem(key) ?? ''}`)
                .join('\n');
        return `${dump(localStorage)}\n${dump(sessionStorage)}\n${document.cookie}`;
    });
}
