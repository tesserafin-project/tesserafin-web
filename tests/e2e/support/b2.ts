import { expect, request, type Page } from '@playwright/test';

/**
 * B2 (#55) — shared harness for the presentation / responsive / accessibility gate.
 *
 * Everything here already existed somewhere in the suite; it is collected in one place so the B2
 * specs assert the same things about the same form factors rather than each re-deriving them.
 *
 * THE THREE FORM FACTORS ARE THE REPOSITORY'S, NOT NEW NUMBERS.
 *
 *   desktop 1440x900 — above MUI's `md` (900 px), which is the single breakpoint the shell
 *     branches on: `src/apps/modern/AppLayout.tsx` and `src/components/ResponsiveDrawer.tsx` both
 *     switch on `theme.breakpoints.up('md')`. Renders the permanent sidebar.
 *   mobile 390x844 — below `md`. Renders the temporary drawer.
 *   tv 1920x1080 PLUS `layout-tv` on `<html>` — TV is a layout, not a resolution.
 *     `components/layoutManager` publishes `layout-tv`, and `src/themes/interactionProfileSignals.ts`
 *     (`TV_LAYOUT_CLASS`) watches exactly that class to raise the `remote` interaction profile.
 *     Setting 1920x1080 alone renders the plain desktop layout, so calling that "TV" would label a
 *     desktop run as something it is not.
 *
 * The same three appear in `tests/e2e/glass-activation.spec.ts`, which is where they came from.
 */

export const USER = process.env.TESSERAFIN_E2E_USER ?? 'smokeadmin';
export const PASSWORD = process.env.TESSERAFIN_E2E_PASSWORD ?? 'smokepass123';
export const BASE_URL =
    process.env.TESSERAFIN_E2E_BASE_URL ?? 'http://localhost:8096';

export const AUTH_HEADER =
    'MediaBrowser Client="Tesserafin Web B2", Device="Playwright", DeviceId="tesserafin-e2e-b2", Version="0.0.0"';

export const VIEWPORTS = {
    desktop: { width: 1440, height: 900 },
    mobile: { width: 390, height: 844 },
    tv: { width: 1920, height: 1080 }
} as const;

export type FormFactor = keyof typeof VIEWPORTS;

/** The two shipped main themes B2 signs off. `official.glass.light` is the light tier of Glass. */
export const THEMES = {
    classic: 'official.classic',
    glass: 'official.glass'
} as const;

export type ThemeName = keyof typeof THEMES;

/** The Movies fixture every rig seeds. See ci/verify-release-pair.sh "MEDIA FIXTURES". */
export const MOVIE_TITLE = 'Smoke Test Movie';

export async function apiUserId(): Promise<string> {
    const api = await request.newContext({ baseURL: BASE_URL });
    try {
        const auth = await api.post('/Users/AuthenticateByName', {
            headers: { Authorization: AUTH_HEADER },
            data: { Username: USER, Pw: PASSWORD }
        });
        expect(auth.ok(), 'the admin fixture user must authenticate').toBe(
            true
        );
        return String((await auth.json()).User.Id);
    } finally {
        await api.dispose();
    }
}

/**
 * Applies the form factor.
 *
 * FOR TV, THROUGH THE PRODUCT'S OWN SETTING, not by writing the class. `components/layoutManager`
 * owns `layout-tv` on `<html>`: it reads `appSettings.get('layout')` at boot and then ADDS or
 * REMOVES the class for every mode. Writing the class directly survives a client-side route change
 * but is wiped by the next document load, when the manager runs again and puts `layout-desktop`
 * back — so a run that reloaded would silently continue as desktop at 1920x1080 and photograph a
 * desktop layout labelled "tv". That was observed, and it is why this sets the setting instead.
 *
 * `appSettings.#getKey` gives device-scoped settings a bare key, so the storage key is `layout`.
 * The init script runs before every document, so the choice survives reloads too.
 */
export async function applyFormFactor(page: Page, factor: FormFactor) {
    await page.setViewportSize(VIEWPORTS[factor]);
    await page.addInitScript((wantTv) => {
        if (wantTv) window.localStorage.setItem('layout', 'tv');
        else window.localStorage.removeItem('layout');
    }, factor === 'tv');
    // The init script only fires on the NEXT document. If a page is already open, put the setting
    // in place now as well so a caller that applies the form factor mid-test is not a no-op.
    await page
        .evaluate((wantTv) => {
            if (wantTv) window.localStorage.setItem('layout', 'tv');
            else window.localStorage.removeItem('layout');
        }, factor === 'tv')
        .catch(() => undefined);
}

/**
 * Asserts the TV layout is genuinely live, and fails loudly if it is not.
 *
 * Every TV claim in this suite depends on it: the `remote` interaction profile
 * (`src/themes/interactionProfileSignals.ts` watches this exact class), the 10-foot type and target
 * sizes, and the TV-specific CSS in `src/styles/librarybrowser.scss`. Without this check a TV test
 * that lost the layout would still pass, having proved something about desktop.
 */
export async function expectTvLayout(page: Page) {
    await expect(
        page.locator('html'),
        'the TV layout must be live — otherwise this is a desktop run at a TV resolution'
    ).toHaveClass(/layout-tv/, { timeout: 20_000 });
}

/**
 * THE SHELL IS NOT ONE SHELL.
 *
 * Under the desktop and mobile layouts the modern shell renders Home as a `tab` and the libraries
 * and Search as `link`s. Under the TV layout `components/layoutManager` selects the legacy 10-foot
 * shell, where the same destinations are `button`s. A selector written for one silently fails
 * against the other, so every navigation helper below accepts both roles rather than assuming the
 * modern shell everywhere.
 */
const HOME_NAME = /^(home|accueil)$/i;
const SEARCH_NAME = /search|rechercher/i;
const LIBRARY_NAME = /^(movies|films)$/i;

function anyRole(page: Page, name: RegExp) {
    return page
        .getByRole('tab', { name })
        .or(page.getByRole('link', { name }))
        .or(page.getByRole('button', { name }))
        .first();
}

/** The Home destination, whichever shell is live. */
export const navHome = (page: Page) => anyRole(page, HOME_NAME);
/** The Search control, whichever shell is live. */
export const navSearch = (page: Page) => anyRole(page, SEARCH_NAME);
/** The seeded Movies library entry, whichever shell is live. */
export const navLibrary = (page: Page) => anyRole(page, LIBRARY_NAME);

/**
 * The first real search result, whichever shell is live.
 *
 * The modern shell renders results as anchors into `#/details`; the legacy 10-foot shell renders
 * them as `button.card[data-id]` with `data-action="link"`. Both are activated the same way — focus
 * and Enter, for the reason `search.spec.ts` documents at length: the card's hover overlay
 * intercepts pointer events and its Resume button would start playback instead of opening the item.
 */
export function searchResultCard(page: Page) {
    return page
        .locator('.searchResults a[href*="#/details"]')
        .or(page.locator('.searchResults button.card[data-id]'))
        .first();
}

export async function signIn(page: Page) {
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(response?.ok(), 'the server did not serve the SPA').toBeTruthy();
    const loginName = page.locator('#txtManualName:visible');
    await expect(loginName.or(navHome(page)).first()).toBeVisible({
        timeout: 25_000
    });
    if (page.url().includes('/login')) {
        const accepted = page.waitForResponse(
            (res) =>
                /\/users\/authenticatebyname/i.test(res.url()) &&
                res.status() < 400,
            { timeout: 15_000 }
        );
        await loginName.fill(USER);
        await page.locator('#txtManualPassword:visible').fill(PASSWORD);
        await page.locator('button[type="submit"]:visible').first().click();
        await accepted;
        await page.waitForURL('**/#/home**', { timeout: 15_000 });
    }
    await expect(
        navHome(page),
        'the shell must present a Home destination after sign-in'
    ).toBeVisible({ timeout: 25_000 });
}

/** The href of the live main-theme stylesheet — the product's own evidence of which theme is on. */
export async function activeThemeHref(page: Page): Promise<string> {
    return page.evaluate(() => {
        const links = Array.from(
            document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
        );
        return links.find((l) => /themes\//.test(l.href))?.href ?? '';
    });
}

/**
 * Selects a theme the way the product persists it — the user-scoped `<userId>-appTheme` key
 * `appSettings` owns — and reloads so the stylesheet is applied by the real boot path.
 *
 * The settled state waited on is THE STYLESHEET, not the Home tab. Waiting on the Home tab would
 * make this helper only usable on the home route, and a caller that switched theme after
 * navigating elsewhere would fail on the helper's assumption rather than on its own subject.
 */
export async function useTheme(page: Page, userId: string, theme: ThemeName) {
    await page.evaluate(
        ([key, value]) => window.localStorage.setItem(key, value),
        [`${userId}-appTheme`, THEMES[theme]] as const
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    const marker = THEMES[theme].replace('official.', '');
    await expect
        .poll(() => activeThemeHref(page), {
            timeout: 25_000,
            message: `the ${theme} stylesheet must be the live main theme after the reload`
        })
        .toContain(marker);
}

export interface LayoutReport {
    /** documentElement.scrollWidth minus clientWidth. Above zero means the page scrolls sideways. */
    horizontalOverflowPx: number;
    /** Visible, interactive elements whose box lies wholly or partly outside the viewport. */
    offscreenControls: string[];
    /** Visible dialogs whose box is not fully inside the viewport. */
    clippedDialogs: string[];
}

/**
 * The responsive usability check, expressed as measurements rather than as a picture.
 *
 * A pixel snapshot fails on a font hint and passes on a control that scrolled off the right edge.
 * These three are the failures that actually make a form factor unusable: the page scrolls
 * sideways, a control cannot be reached, or a dialog is cut off. Each is read from real layout
 * boxes in the live document.
 */
export async function measureLayout(page: Page): Promise<LayoutReport> {
    return page.evaluate(() => {
        const describe = (el: Element): string => {
            const tag = el.tagName.toLowerCase();
            const id = el.id ? `#${el.id}` : '';
            const cls =
                typeof el.className === 'string' && el.className
                    ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}`
                    : '';
            const label =
                el.getAttribute('aria-label') ??
                (el.textContent ?? '').trim().slice(0, 30);
            return `${tag}${id}${cls}${label ? ` "${label}"` : ''}`;
        };

        const isVisible = (el: Element): boolean => {
            const style = window.getComputedStyle(el);
            if (
                style.display === 'none' ||
                style.visibility === 'hidden' ||
                style.opacity === '0'
            ) {
                return false;
            }
            const box = el.getBoundingClientRect();
            return box.width > 0 && box.height > 0;
        };

        const root = document.documentElement;
        const viewportWidth = root.clientWidth;
        const viewportHeight = root.clientHeight;

        const interactive = Array.from(
            document.querySelectorAll(
                'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="link"], [role="menuitem"]'
            )
        ).filter(isVisible);

        const offscreenControls: string[] = [];
        for (const el of interactive) {
            const box = el.getBoundingClientRect();
            // A control inside a scrollable region is reachable by scrolling that region, so
            // only elements outside the viewport with no scrollable ancestor count. The cheap,
            // robust form of that test: the element's own left/right edge outside the viewport
            // while no ancestor scrolls horizontally.
            const outsideX = box.right <= 0 || box.left >= viewportWidth;
            const outsideY = box.bottom <= 0 || box.top >= viewportHeight;
            if (!outsideX && !outsideY) continue;
            let scrollableAncestor = false;
            let node: Element | null = el.parentElement;
            while (node && node !== document.body) {
                const style = window.getComputedStyle(node);
                const scrolls =
                    /(auto|scroll)/.test(style.overflowX) ||
                    /(auto|scroll)/.test(style.overflowY);
                if (scrolls && node.scrollWidth > node.clientWidth + 1) {
                    scrollableAncestor = true;
                    break;
                }
                if (scrolls && node.scrollHeight > node.clientHeight + 1) {
                    scrollableAncestor = true;
                    break;
                }
                node = node.parentElement;
            }
            // Vertical page scroll is normal; only a control off the horizontal axis, or one
            // below a page that does not scroll, is unreachable.
            const pageScrollsVertically = root.scrollHeight > root.clientHeight;
            if (outsideY && !outsideX && pageScrollsVertically) continue;
            if (!scrollableAncestor) offscreenControls.push(describe(el));
        }

        const clippedDialogs: string[] = [];
        for (const dialog of Array.from(
            document.querySelectorAll(
                '[role="dialog"], [role="alertdialog"], dialog[open]'
            )
        ).filter(isVisible)) {
            const box = dialog.getBoundingClientRect();
            if (
                box.left < -1 ||
                box.top < -1 ||
                box.right > viewportWidth + 1 ||
                box.bottom > viewportHeight + 1
            ) {
                clippedDialogs.push(
                    `${describe(dialog)} box=${Math.round(box.left)},${Math.round(box.top)} ${Math.round(box.width)}x${Math.round(box.height)} viewport=${viewportWidth}x${viewportHeight}`
                );
            }
        }

        return {
            horizontalOverflowPx: Math.max(
                0,
                root.scrollWidth - root.clientWidth
            ),
            offscreenControls: offscreenControls.slice(0, 10),
            clippedDialogs
        };
    });
}

/**
 * Reads {@link measureLayout} until two consecutive reads agree.
 *
 * Layout that is still animating is not layout. The Glass drawer slides in over ~200 ms, so a
 * single read taken the moment a link becomes visible can catch every entry still translated off
 * the left edge and report controls as unreachable that are, half a frame later, perfectly
 * reachable. Polling to a settled state is what makes the assertion about the design rather than
 * about the transition.
 */
export async function measureLayoutStable(
    page: Page,
    attempts = 12
): Promise<LayoutReport> {
    let previous = JSON.stringify(await measureLayout(page));
    for (let i = 0; i < attempts; i += 1) {
        await page.waitForTimeout(120);
        const current = await measureLayout(page);
        const serialised = JSON.stringify(current);
        if (serialised === previous) return current;
        previous = serialised;
    }
    return JSON.parse(previous) as LayoutReport;
}

export interface FocusReport {
    tag: string;
    role: string | null;
    accessibleName: string;
    /** True when the focused element paints something the eye can see as focus. */
    focusVisible: boolean;
    /** The computed properties that differ between the focused and the unfocused state. */
    focusIndicators: string[];
    outlineWidthPx: number;
    boxShadow: string;
}

/**
 * The computed properties a focus indicator can realistically be painted with, including the ones
 * the repository's own components use (`outline`) and the ones MUI uses (background, box-shadow,
 * and a pseudo-element overlay).
 */
const FOCUS_PROPERTIES = [
    'boxShadow',
    'backgroundColor',
    'backgroundImage',
    'borderColor',
    'borderWidth',
    'color',
    'textDecorationLine',
    'transform',
    'filter',
    'opacity'
] as const;

/**
 * Describes what currently has focus, including whether the focus is actually VISIBLE.
 *
 * VISIBILITY IS A DIFFERENCE, NOT A PROPERTY. Asserting a non-zero outline would call MUI's
 * background-based indicator invisible, and `theme-glass-selection.spec.ts` already establishes
 * that a background change is an accepted indicator in this codebase. Asserting `:focus-visible`
 * matches would prove only that the selector applies, not that anything was painted.
 *
 * So the focused element's computed style — including its `::before` and `::after` — is compared
 * against the SAME element with focus removed. The comparison is taken against the element itself
 * rather than a sibling, so a difference cannot be attributed to the two elements simply being
 * styled differently, and focus is restored immediately afterwards.
 *
 * A DIFFERENCE ONLY COUNTS IF IT CAN PAINT. `outline-*` is folded into one derived value first,
 * because the shell's MUI controls were observed changing `outline-offset` from `0px` to `1px`
 * while `outline-style` stayed `none` and `outline-width` stayed `0px` — a computed difference that
 * draws precisely nothing. Comparing the individual longhands would call that a visible focus
 * indicator, which is the exact false pass this gate exists to prevent.
 */
export async function describeFocus(page: Page): Promise<FocusReport> {
    return page.evaluate(
        (properties) => {
            const el = document.activeElement as HTMLElement | null;
            if (!el || el === document.body) {
                return {
                    tag: el ? el.tagName.toLowerCase() : 'none',
                    role: null,
                    accessibleName: '',
                    focusVisible: false,
                    focusIndicators: [],
                    outlineWidthPx: 0,
                    boxShadow: 'none'
                };
            }

            /**
             * `none` unless the outline would actually be drawn. An offset or a colour on an
             * outline whose style is `none` or whose width is `0` paints nothing.
             */
            const paintedOutline = (style: CSSStyleDeclaration): string => {
                const width = Number.parseFloat(style.outlineWidth || '0') || 0;
                if (width <= 0 || style.outlineStyle === 'none') return 'none';
                return `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor} offset ${style.outlineOffset}`;
            };

            const snapshot = (): Record<string, string> => {
                const out: Record<string, string> = {};
                for (const pseudo of [null, '::before', '::after'] as const) {
                    const style = window.getComputedStyle(el, pseudo);
                    const prefix = pseudo ?? '';
                    out[`${prefix}outline`] = paintedOutline(style);
                    for (const property of properties) {
                        out[`${prefix}${property}`] = style[
                            property as keyof CSSStyleDeclaration
                        ] as string;
                    }
                    if (pseudo) out[`${prefix}content`] = style.content;
                }
                return out;
            };

            const focused = snapshot();
            // Remove focus, re-read, then put it straight back. `preventScroll` keeps the page from
            // jumping, which would change the very layout other assertions are about to measure.
            el.blur();
            const unfocused = snapshot();
            el.focus({ preventScroll: true });

            const focusIndicators = Object.keys(focused).filter(
                (key) => focused[key] !== unfocused[key]
            );

            const outlineWidthPx =
                focused.outline === 'none'
                    ? 0
                    : Number.parseFloat(focused.outline) || 0;
            // The legacy 10-foot shell names its icon buttons with `title`, the modern shell with
            // `aria-label`, and text buttons with their content. Reading only `aria-label` reported
            // the TV app bar's controls as unnamed when the accessibility tree names them fine.
            const labelledBy = el.getAttribute('aria-labelledby');
            const labelledByText = labelledBy
                ? labelledBy
                      .split(/\s+/)
                      .map(
                          (id) => document.getElementById(id)?.textContent ?? ''
                      )
                      .join(' ')
                      .trim()
                : '';
            const name =
                (el.getAttribute('aria-label') ?? '').trim() ||
                labelledByText ||
                (el.getAttribute('title') ?? '').trim() ||
                el.innerText?.trim().slice(0, 60) ||
                '';
            return {
                tag: el.tagName.toLowerCase(),
                role: el.getAttribute('role'),
                accessibleName: name,
                focusVisible: focusIndicators.length > 0,
                focusIndicators,
                outlineWidthPx,
                boxShadow: focused.boxShadow || 'none'
            };
        },
        FOCUS_PROPERTIES as unknown as string[]
    );
}

/** Presses Tab n times and returns what held focus after each press. */
export async function tabThrough(
    page: Page,
    steps: number
): Promise<FocusReport[]> {
    const seen: FocusReport[] = [];
    for (let i = 0; i < steps; i += 1) {
        await page.keyboard.press('Tab');
        seen.push(await describeFocus(page));
    }
    return seen;
}
