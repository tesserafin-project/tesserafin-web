import { expect, test } from './support/origin-inventory';
import {
    type FormFactor,
    type ThemeName,
    apiUserId,
    applyFormFactor,
    describeFocus,
    expectTvLayout,
    openItemDetail,
    seedResumePosition,
    signIn,
    useTheme
} from './support/b2';

/**
 * #306 — the last step of connect → browse → details → play → RESUME, by keyboard, in both
 * shipped themes at all three form factors.
 *
 * The other B2 specs reach the player with the Play control and never ask where it starts.
 * `seedResumePosition` already exists for the Home sections; this spec uses it for what a user does
 * with it: focus the detail page's Resume control, see focus on it, press Enter, and get playback
 * that starts at the stored position rather than at zero.
 *
 * THE POSITION IS READ FROM THE MEDIA ELEMENT, not from a request parameter. The first `playing`
 * event's `currentTime` is captured in the page before any test code can pause or seek, so a player
 * that requested the right offset and then played from zero fails here.
 *
 * NOT CLAIMED: a stop-time position write. The rig's fixture is 2 s long and the server marks any
 * item under `MinResumeDurationSeconds` (300 s) as played on stop, so "stop, then resume" cannot be
 * proven with it; the stored position is seeded through the server API instead.
 */

const SEEDED_SECONDS = 0.5; // seedResumePosition writes 5_000_000 ticks
const FORM_FACTORS: FormFactor[] = ['desktop', 'mobile', 'tv'];
const THEME_NAMES: ThemeName[] = ['classic', 'glass'];

test.describe('B2 resume: the stored position is resumed by keyboard', () => {
    for (const theme of THEME_NAMES) {
        for (const factor of FORM_FACTORS) {
            test(`${theme} at ${factor}: Resume is focusable, visibly focused, and starts at the stored position`, async ({
                page
            }) => {
                const undo = await seedResumePosition();
                try {
                    await page.addInitScript(() => {
                        document.addEventListener(
                            'playing',
                            (event) => {
                                const w = window as unknown as {
                                    __firstPlayingAt?: number;
                                };
                                if (w.__firstPlayingAt === undefined) {
                                    w.__firstPlayingAt = (
                                        event.target as HTMLMediaElement
                                    ).currentTime;
                                }
                            },
                            true
                        );
                    });
                    await applyFormFactor(page, factor);
                    const userId = await apiUserId();
                    await signIn(page);
                    await useTheme(page, userId, theme);
                    if (factor === 'tv') await expectTvLayout(page);

                    await openItemDetail(page);
                    const resume = page
                        .locator('[data-detail-section="mainDetailButtons"]')
                        .getByRole('button', { name: /^(Resume|Reprendre)\b/ });
                    await expect(
                        resume,
                        'a stored position must surface a Resume control'
                    ).toBeVisible({ timeout: 25_000 });

                    await resume.focus();
                    const focus = await describeFocus(page);
                    expect(
                        focus.focusVisible,
                        `Resume must show visible focus (${JSON.stringify(focus)})`
                    ).toBe(true);

                    const reachedPlayer = page.waitForURL(/#\/video/, {
                        timeout: 30_000
                    });
                    await page.keyboard.press('Enter');
                    await reachedPlayer;

                    await expect
                        .poll(
                            () =>
                                page.evaluate(
                                    () =>
                                        (
                                            window as unknown as {
                                                __firstPlayingAt?: number;
                                            }
                                        ).__firstPlayingAt ?? null
                                ),
                            {
                                timeout: 30_000,
                                message: 'the player must start playing'
                            }
                        )
                        .toBeGreaterThanOrEqual(SEEDED_SECONDS - 0.1);
                } finally {
                    await page.keyboard.press('Escape').catch(() => undefined);
                    await undo();
                }
            });
        }
    }
});
