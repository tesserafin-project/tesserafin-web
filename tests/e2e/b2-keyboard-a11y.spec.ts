import { expect, test } from './support/origin-inventory';
import {
    MOVIE_TITLE,
    apiUserId,
    applyFormFactor,
    describeFocus,
    expectTvLayout,
    searchResultCard,
    signIn,
    tabThrough,
    useTheme
} from './support/b2';

/**
 * B2 (#55) — keyboard navigation, focus order, focus visibility, and roles/names.
 *
 * THE INPUT MODEL IS THE PROJECT'S. `theme-glass-selection.spec.ts` establishes what a remote is
 * in this codebase: arrow keys for D-pad movement, Enter to activate, and the `layout-tv` class on
 * `<html>` as the thing that puts the shell into its 10-foot presentation. Nothing here invents a
 * different remote abstraction.
 *
 * FOCUS VISIBILITY IS MEASURED, NOT ASSERTED BY SELECTOR. Checking that `:focus-visible` matches
 * proves the selector applies; it does not prove anything was painted. `describeFocus` reads the
 * computed outline width and box-shadow off the live element, so a rule that is present but
 * produces no visible ring fails.
 */

test.describe('B2 keyboard: focus order and visible focus on primary flows', () => {
    test('tabbing from the top of the shell reaches real controls, in order, each with visible focus', async ({
        page
    }) => {
        const userId = await apiUserId();
        await signIn(page);
        await useTheme(page, userId, 'classic');

        // Start from the document, not from an element the test focused itself — the question is
        // where a keyboard user LANDS, not where they can be put.
        await page.evaluate(() => {
            (document.activeElement as HTMLElement | null)?.blur();
        });

        const stops = await tabThrough(page, 12);
        const reached = stops.filter(
            (s) => s.tag !== 'body' && s.tag !== 'none'
        );
        expect(
            reached.length,
            'tabbing from the top of the shell must reach interactive controls'
        ).toBeGreaterThan(3);

        // Every stop must be something a user can act on, and must show where focus is.
        const invisibleFocus = reached.filter((s) => !s.focusVisible);
        expect(
            invisibleFocus.map(
                (s) => `${s.tag}[${s.role ?? '-'}] "${s.accessibleName}"`
            ),
            'every keyboard stop must paint a visible focus indicator'
        ).toEqual([]);

        // Sensible ORDER: the stops must be distinct, i.e. focus actually advances rather than
        // being trapped on one element.
        const distinct = new Set(
            reached.map((s) => `${s.tag}|${s.role ?? ''}|${s.accessibleName}`)
        );
        expect(
            distinct.size,
            'focus must advance through distinct controls rather than being trapped'
        ).toBeGreaterThan(2);

        // And it must not be trapped: Shift+Tab has to move focus back off the last stop.
        const last = await describeFocus(page);
        await page.keyboard.press('Shift+Tab');
        const back = await describeFocus(page);
        expect(
            `${back.tag}|${back.accessibleName}`,
            'Shift+Tab must move focus backwards, not leave it where it was'
        ).not.toBe(`${last.tag}|${last.accessibleName}`);
    });

    test('primary shell controls carry a correct role and a non-empty accessible name', async ({
        page
    }) => {
        const userId = await apiUserId();
        await signIn(page);
        await useTheme(page, userId, 'glass');

        // The controls #55 calls primary: the shell's navigation, and Search.
        const homeTab = page.getByRole('tab', { name: /accueil|home/i });
        await expect(
            homeTab,
            'the Home entry must be exposed with a tab role and a name'
        ).toBeVisible({ timeout: 25_000 });

        const searchControl = page
            .getByRole('link', { name: /search|rechercher/i })
            .or(page.getByRole('button', { name: /search|rechercher/i }))
            .first();
        await expect(
            searchControl,
            'Search must be exposed with a link or button role and a name'
        ).toBeVisible({ timeout: 25_000 });

        // NO UNNAMED INTERACTIVE CONTROLS. Every visible button, link, tab and menu item must
        // have an accessible name from somewhere — text, aria-label, aria-labelledby or title.
        // A control with none is unusable by a screen reader and unaddressable by a remote.
        const unnamed = await page.evaluate(() => {
            const out: string[] = [];
            const nodes = Array.from(
                document.querySelectorAll(
                    'button, a[href], [role="button"], [role="tab"], [role="link"], [role="menuitem"]'
                )
            );
            for (const el of nodes) {
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden')
                    continue;
                const box = el.getBoundingClientRect();
                if (box.width === 0 || box.height === 0) continue;
                if (el.getAttribute('aria-hidden') === 'true') continue;
                const labelledBy = el.getAttribute('aria-labelledby');
                const labelledByText = labelledBy
                    ? labelledBy
                          .split(/\s+/)
                          .map(
                              (id) =>
                                  document.getElementById(id)?.textContent ?? ''
                          )
                          .join(' ')
                          .trim()
                    : '';
                const name =
                    (el.getAttribute('aria-label') ?? '').trim() ||
                    labelledByText ||
                    (el.getAttribute('title') ?? '').trim() ||
                    (el.textContent ?? '').trim();
                if (name.length === 0) {
                    const tag = el.tagName.toLowerCase();
                    const cls =
                        typeof el.className === 'string'
                            ? el.className
                                  .trim()
                                  .split(/\s+/)
                                  .slice(0, 2)
                                  .join('.')
                            : '';
                    out.push(`${tag}${cls ? `.${cls}` : ''}`);
                }
            }
            return out;
        });
        expect(
            unnamed,
            'every visible interactive control must have an accessible name'
        ).toEqual([]);
    });
});

test.describe('B2 TV: remote-style movement and activation with visible focus', () => {
    test('under the TV layout, arrow keys move focus between real controls and Enter activates one', async ({
        page
    }) => {
        const userId = await apiUserId();
        await applyFormFactor(page, 'tv');
        await signIn(page);
        await useTheme(page, userId, 'glass');
        await applyFormFactor(page, 'tv');

        // The layout class is the product's own TV signal — assert it is actually on, because
        // everything below is a claim about the 10-foot presentation and not about a big desktop.
        await expectTvLayout(page);

        // Reach Search with the keyboard alone, the way a remote does: Tab into the shell, then
        // arrow along it. Both are what the picker test established as this project's D-pad.
        await page.evaluate(() => {
            (document.activeElement as HTMLElement | null)?.blur();
        });

        const seen: string[] = [];
        let searchFocused = false;
        for (let i = 0; i < 25; i += 1) {
            await page.keyboard.press(i === 0 ? 'Tab' : 'ArrowRight');
            const focus = await describeFocus(page);
            seen.push(
                `${focus.tag}[${focus.role ?? '-'}] "${focus.accessibleName}"`
            );
            if (/search|rechercher/i.test(focus.accessibleName)) {
                searchFocused = true;
                // Focus must be VISIBLE at 10 feet — this is the clause a remote user depends on.
                expect(
                    focus.focusVisible,
                    `the focused control must paint a visible indicator under the TV layout (outline ${focus.outlineWidthPx}px, shadow ${focus.boxShadow}, changed properties: ${focus.focusIndicators.join(', ') || 'none'})`
                ).toBe(true);
                break;
            }
            // Arrow movement that never changes focus means the shell is not remote-navigable.
            if (i > 3 && new Set(seen).size === 1) break;
        }

        // If arrow keys alone do not reach it, Tab must — a 10-foot shell has to be reachable by
        // one of the two, and failing here is a real usability defect, not a harness detail.
        if (!searchFocused) {
            for (let i = 0; i < 25 && !searchFocused; i += 1) {
                await page.keyboard.press('Tab');
                const focus = await describeFocus(page);
                seen.push(
                    `TAB ${focus.tag}[${focus.role ?? '-'}] "${focus.accessibleName}"`
                );
                if (/search|rechercher/i.test(focus.accessibleName)) {
                    searchFocused = true;
                    expect(
                        focus.focusVisible,
                        `the focused control must paint a visible indicator under the TV layout (outline ${focus.outlineWidthPx}px, shadow ${focus.boxShadow}, changed properties: ${focus.focusIndicators.join(', ') || 'none'})`
                    ).toBe(true);
                }
            }
        }

        expect(
            searchFocused,
            `remote-style navigation must be able to reach the Search control under the TV layout. Focus visited: ${seen.join(' -> ')}`
        ).toBe(true);

        // ACTIVATION, not merely focus: Enter on the focused control has to do the thing.
        await page.keyboard.press('Enter');
        await page.waitForURL('**/#/search**', { timeout: 20_000 });

        // And the destination has to be operable from the remote too: the field must take text.
        const field = page.locator('.searchFields input:visible').first();
        await expect(field).toBeVisible({ timeout: 15_000 });
        await field.focus();
        await page.keyboard.type(MOVIE_TITLE);
        await expect(
            searchResultCard(page),
            'a remote user must be able to search and get results under the TV layout'
        ).toBeVisible({ timeout: 25_000 });
    });
});
