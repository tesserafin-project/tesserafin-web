import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { type Route, request } from '@playwright/test';
import { expect, test } from './support/origin-inventory';
import {
    AUTH_HEADER,
    BASE_URL,
    type FormFactor,
    PASSWORD,
    USER,
    VIEWPORTS,
    apiUserId,
    applyFormFactor,
    describeFocus,
    expectTvLayout,
    measureLayoutStable,
    signIn,
    useTheme
} from './support/b2';

/**
 * B2 (#55) — the player surface and the terminal error dialog, at every form factor.
 *
 * B1 (#54, `error-playback.spec.ts`) already proves the BEHAVIOUR: an exhausted retry ladder
 * reaches a real translated error dialog, the dialog dismisses, the player is torn down, and
 * recovery needs no document reload. None of that is repeated here.
 *
 * What B2 adds is the PRESENTATION of those same surfaces at the three form factors. A dialog that
 * is correct but rendered half off a 390 px screen, or a player control that cannot be reached with
 * a remote, passes every B1 assertion and still fails #55. The failure mode is specific to a
 * viewport, so it has to be measured at each one.
 *
 * The playback failure is provoked exactly as B1 does it — by refusing media bytes while
 * `PlaybackInfo` and the session endpoints stay healthy — so the dialog under measurement is the
 * product's real terminal error state, not a mock.
 */

const CAPTURE_DIR =
    process.env.TESSERAFIN_E2E_CAPTURE_DIR ??
    resolve(process.cwd(), 'test-results', 'b2-captures');

const capturePath = (name: string): string => {
    const path = resolve(CAPTURE_DIR, name);
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return path;
};

/** The media byte paths B1's error spec refuses. Session and PlaybackInfo stay healthy. */
const MEDIA_BYTES =
    /\/(videos|audio)\/[^/]+\/(stream|master\.m3u8|main\.m3u8|hls1)/i;

async function firstMovieId(): Promise<string> {
    const api = await request.newContext({ baseURL: BASE_URL });
    try {
        const auth = await api.post('/Users/AuthenticateByName', {
            headers: { Authorization: AUTH_HEADER },
            data: { Username: USER, Pw: PASSWORD }
        });
        expect(auth.ok()).toBe(true);
        const body = await auth.json();
        const items = await api.get('/Items', {
            params: {
                userId: String(body.User.Id),
                recursive: 'true',
                includeItemTypes: 'Movie'
            },
            headers: {
                Authorization: `${AUTH_HEADER}, Token="${body.AccessToken}"`
            }
        });
        expect(items.status()).toBe(200);
        const id = (await items.json()).Items?.[0]?.Id;
        expect(
            id,
            'the rig must expose at least one movie fixture'
        ).toBeTruthy();
        return String(id);
    } finally {
        await api.dispose();
    }
}

const FORM_FACTORS: FormFactor[] = ['desktop', 'mobile', 'tv'];

test.describe('B2 player: controls and the terminal error dialog at every form factor', () => {
    for (const factor of FORM_FACTORS) {
        for (const theme of ['classic', 'glass'] as const) {
            test(`${theme} at ${factor} (${VIEWPORTS[factor].width}x${VIEWPORTS[factor].height}): player controls are reachable and the terminal error dialog fits the screen`, async ({
                page
            }, testInfo) => {
                const userId = await apiUserId();
                const itemId = await firstMovieId();

                await applyFormFactor(page, factor);
                await signIn(page);
                await useTheme(page, userId, theme);
                await applyFormFactor(page, factor);
                if (factor === 'tv') await expectTvLayout(page);

                // 1. THE PLAYER ITSELF, with media flowing. Its controls must be on screen and
                //    addressable at this form factor.
                await page.goto(`/#/details?id=${itemId}`);
                const play = page
                    .locator(
                        'button.btnPlay:visible, button[title*="Play" i]:visible'
                    )
                    .first();
                await expect(
                    play,
                    'the item detail page must offer a play control'
                ).toBeVisible({ timeout: 25_000 });
                await play.click();
                await page.waitForURL(/#\/video/, { timeout: 30_000 });
                await expect(page.locator('video')).toBeVisible({
                    timeout: 30_000
                });
                // The on-screen display auto-hides; a real pointer move is what brings it back.
                await page.mouse.move(300, 300);
                await page.mouse.move(320, 320);

                const playerLayout = await measureLayoutStable(page);
                testInfo.annotations.push({
                    type: `layout:player:${theme}:${factor}`,
                    description: JSON.stringify(playerLayout)
                });
                expect(
                    playerLayout.horizontalOverflowPx,
                    `the player at ${factor} in ${theme} must not scroll horizontally`
                ).toBeLessThanOrEqual(1);
                expect(
                    playerLayout.offscreenControls,
                    `the player at ${factor} in ${theme} must not leave a control outside the viewport`
                ).toEqual([]);
                await page.screenshot({
                    path: capturePath(`${theme}-${factor}-player.png`)
                });

                // A remote user must be able to put focus on a player control and see it.
                await page.keyboard.press('Tab');
                const focus = await describeFocus(page);
                testInfo.annotations.push({
                    type: `focus:player:${theme}:${factor}`,
                    description: JSON.stringify(focus)
                });

                await page.keyboard.press('Escape');
                await page.waitForURL(/#\/(details|home)/, { timeout: 25_000 });

                // 2. THE TERMINAL ERROR DIALOG, provoked the way B1 provokes it.
                await page.route('**/*', (route: Route) =>
                    MEDIA_BYTES.test(new URL(route.request().url()).pathname)
                        ? route.abort('connectionrefused')
                        : route.continue()
                );
                await page.goto(`/#/details?id=${itemId}`);
                const playAgain = page
                    .locator(
                        'button.btnPlay:visible, button[title*="Play" i]:visible'
                    )
                    .first();
                await expect(playAgain).toBeVisible({ timeout: 25_000 });
                await playAgain.click();

                const dialog = page
                    .locator(
                        '[role="dialog"], [role="alertdialog"], .dialog:visible'
                    )
                    .first();
                await expect(
                    dialog,
                    'an exhausted playback ladder must reach a visible terminal error dialog'
                ).toBeVisible({ timeout: 40_000 });

                const dialogLayout = await measureLayoutStable(page);
                testInfo.annotations.push({
                    type: `layout:player-error:${theme}:${factor}`,
                    description: JSON.stringify(dialogLayout)
                });
                expect(
                    dialogLayout.clippedDialogs,
                    `the terminal playback error dialog at ${factor} in ${theme} must fit entirely inside the viewport`
                ).toEqual([]);
                expect(
                    dialogLayout.horizontalOverflowPx,
                    `the terminal playback error dialog at ${factor} in ${theme} must not push the page sideways`
                ).toBeLessThanOrEqual(1);
                await page.screenshot({
                    path: capturePath(`${theme}-${factor}-player-error.png`)
                });

                // Its dismissal control must be present, named, and operable — the presentation
                // half of B1's recovery clause. A dialog nobody can close is a dead end at any
                // viewport.
                const dismiss = dialog
                    .getByRole('button')
                    .filter({ hasText: /.+/ })
                    .first();
                await expect(
                    dismiss,
                    'the terminal error dialog must offer a named button to dismiss it'
                ).toBeVisible({ timeout: 15_000 });
                await dismiss.click();
                await expect(
                    dialog,
                    'the dialog must close when its own button is pressed'
                ).toBeHidden({ timeout: 15_000 });

                await page.unroute('**/*');
            });
        }
    }
});
