/**
 * A real sign-out and a real sign-in through the production bundle: nothing of account A may reach
 * account B. The transport is a same-origin FIXTURE, keyed on the bearer token. No real server is
 * involved, so this proves the client's isolation and says nothing about the server's authorisation.
 */
import { resolve } from 'node:path';
import { type Page, type Route, expect, test } from '@playwright/test';
import {
    MOVIE,
    SERVER_ID,
    USER_ID,
    installFixtureApi
} from './support/fixtureApi';

const DIST = resolve(__dirname, '../../dist');
const SHARED = 'view-movies';
const SECRET = 'view-secret';
const CARD = 'a[data-rf-slot="media-card"]';
const GRID_CARD = `.rf-library-continuous ${CARD}`;
const USER_B = 'user-b';
const TOKEN_B = 'token-b';
const A_TOTAL = 12_000;
const B_TOTAL = 30;
const OPENED = 5_207;

const aName = (index: number) => `A-only ${String(index).padStart(5, '0')}`;
const bName = (index: number) => `B-sees ${String(index).padStart(5, '0')}`;

const view = (Id: string, Name: string) => ({
    Id,
    Name,
    CollectionType: 'movies',
    Type: 'CollectionFolder',
    ServerId: SERVER_ID
});

interface Held {
    release: () => void;
    outcome?: 'delivered' | 'aborted';
}

async function install(page: Page, origin: string, layout: 'grid' | 'shelf') {
    await page.setViewportSize({ width: 1440, height: 900 });
    const ledger = await installFixtureApi(page, origin, DIST);
    await page.addInitScript((chosen) => {
        localStorage.setItem(
            'tesserafin.themeStudio.appliedPresentation',
            JSON.stringify({
                page: {
                    library: {
                        layout: chosen,
                        cardAspect: 'poster',
                        filters: 'inline'
                    }
                }
            })
        );
    }, layout);
    const fixture = {
        holdFrom: undefined as number | undefined,
        held: [] as Held[],
        requests: [] as { who: 'A' | 'B'; startIndex: number }[],
        heldArrived: undefined as (() => void) | undefined
    };
    await page.route('**/*', async (route: Route) => {
        const request = route.request();
        const url = new URL(request.url());
        const path = url.pathname.toLowerCase();
        const who = (request.headers()['authorization'] ?? '').includes(TOKEN_B)
            ? 'B'
            : 'A';
        const json = (body: unknown, status = 200) =>
            route.fulfill({
                status,
                contentType: 'application/json',
                body: JSON.stringify(body)
            });
        const list = (Items: unknown[]) =>
            json({ Items, TotalRecordCount: Items.length, StartIndex: 0 });
        const userB = {
            Id: USER_B,
            Name: 'Account B',
            ServerId: SERVER_ID,
            HasPassword: true,
            Policy: { IsAdministrator: false, EnableMediaPlayback: true },
            Configuration: {}
        };
        if (
            path === '/users/authenticatebyname' &&
            request.method() === 'POST'
        ) {
            ledger.requests.push('POST /Users/AuthenticateByName');
            return json({
                User: userB,
                AccessToken: TOKEN_B,
                ServerId: SERVER_ID
            });
        }
        if (path === '/users/public') return json([]);
        if (
            path === `/users/${USER_B}` ||
            (path === '/users/me' && who === 'B')
        )
            return json(userB);
        if (path === '/userviews') {
            return who === 'A'
                ? list([view(SHARED, 'Movies'), view(SECRET, 'Secret')])
                : list([view(SHARED, 'Movies')]);
        }
        for (const owner of [USER_ID, USER_B]) {
            if (path === `/users/${owner}/items/${SHARED}`)
                return json(view(SHARED, 'Movies'));
            if (path === `/users/${owner}/items/${SECRET}`)
                return who === 'A'
                    ? json(view(SECRET, 'Secret'))
                    : route.fulfill({ status: 404, body: '' });
        }
        if (path === `/items/${SHARED}`) return json(view(SHARED, 'Movies'));
        if (path === `/items/${SECRET}`)
            return who === 'A'
                ? json(view(SECRET, 'Secret'))
                : route.fulfill({ status: 404, body: '' });
        if (path === '/items/latest') return json([]);
        if (path === '/useritems/resume') return list([]);
        if (path === '/items/filters') return json({ Genres: [], Years: [] });
        if (path === '/studios') return list([]);
        if (path === '/items' && url.searchParams.get('parentId')) {
            const parent = url.searchParams.get('parentId');
            const startIndex = Number(url.searchParams.get('startIndex') ?? 0);
            const limit = Number(url.searchParams.get('limit') ?? 0);
            fixture.requests.push({ who, startIndex });
            if (who === 'B' && parent === SECRET)
                return json({ error: 'not this viewer' }, 403);
            if (
                who === 'A' &&
                fixture.holdFrom !== undefined &&
                startIndex >= fixture.holdFrom
            ) {
                const held: Held = { release: () => undefined };
                fixture.held.push(held);
                fixture.heldArrived?.();
                await new Promise<void>((done) => {
                    held.release = done;
                });
                // Delivered whatever the client did with it: a late answer is the case under test.
                const fulfilled = route
                    .fulfill({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify(page_(startIndex, limit, 'A'))
                    })
                    .then(() => {
                        held.outcome = 'delivered';
                    })
                    .catch(() => {
                        held.outcome = 'aborted';
                    });
                return fulfilled;
            }
            return json(page_(startIndex, limit, who));
        }
        return route.fallback();
    });
    return { fixture, ledger };
}

function page_(startIndex: number, limit: number, who: 'A' | 'B') {
    const total = who === 'A' ? A_TOTAL : B_TOTAL;
    const Items = [];
    for (let i = startIndex; i < Math.min(total, startIndex + limit); i++) {
        Items.push({
            ...MOVIE,
            Id: who === 'A' && i === OPENED ? MOVIE.Id : `${who}-${i}`,
            Name: who === 'A' ? aName(i) : bName(i),
            ProductionYear: 2000,
            ImageTags: {},
            BackdropImageTags: [],
            UserData: { ...MOVIE.UserData, PlaybackPositionTicks: 0 }
        });
    }
    return { Items, TotalRecordCount: total, StartIndex: startIndex };
}

const persistedHolds = (page: Page, text: string) =>
    page.evaluate(
        (needle) =>
            new Promise<boolean>((done) => {
                const open = indexedDB.open('keyval-store');
                open.onerror = () => done(false);
                open.onsuccess = () => {
                    const db = open.result;
                    if (!db.objectStoreNames.contains('keyval')) {
                        db.close();
                        done(false);
                        return;
                    }
                    const read = db
                        .transaction('keyval')
                        .objectStore('keyval')
                        .get('tesserafin-query-cache');
                    read.onsuccess = () => {
                        db.close();
                        done(
                            JSON.stringify(read.result ?? '').includes(needle)
                        );
                    };
                    read.onerror = () => done(false);
                };
            }),
        text
    );

for (const layout of ['grid', 'shelf'] as const) {
    test(`${layout}: A deep, a fiche, sign-out with a request of A in flight, then B sees only B`, async ({
        page,
        baseURL
    }) => {
        test.setTimeout(120_000);
        const { fixture, ledger } = await install(page, baseURL!, layout);
        await page.goto(`/#/library/${SHARED}`);
        await expect(page.locator(GRID_CARD).first()).toContainText(aName(0));

        const moveTo = (index: number) =>
            page.evaluate(
                ([target, total, shelf]) => {
                    const root = document.querySelector<HTMLElement>(
                        '.rf-library-continuous'
                    )!;
                    if (shelf) {
                        const scroller = root.querySelector<HTMLElement>(
                            '.rf-media-shelf__scroller'
                        )!;
                        scroller.scrollTo({
                            left: (target / total) * scroller.scrollWidth,
                            behavior: 'instant'
                        });
                        return;
                    }
                    const top =
                        root.getBoundingClientRect().top + window.scrollY;
                    window.scrollTo({
                        top: top + (target / total) * root.offsetHeight,
                        behavior: 'instant'
                    });
                },
                [index, A_TOTAL, layout === 'shelf'] as const
            );

        // Deep, into a fiche from the keyboard, and back: A's position exists and works.
        await moveTo(OPENED);
        const opened = page.locator(`${GRID_CARD}[href*="id=${MOVIE.Id}&"]`);
        await expect(opened).toHaveCount(1);
        await opened.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#itemDetailPage')).toBeVisible();
        await page.goBack();
        await expect(opened).toBeFocused();

        // A second opening leaves a remembered position behind, under A's history entry.
        await page.keyboard.press('Enter');
        await expect(page.locator('#itemDetailPage')).toBeVisible();
        await page.goBack();
        await expect(opened).toBeFocused();

        // A's next page is on the wire when A leaves.
        fixture.holdFrom = 6_000;
        const arrived = new Promise<void>((done) => {
            fixture.heldArrived = done;
        });
        await moveTo(5_990);
        await arrived;
        expect(fixture.held.length).toBeGreaterThan(0);

        // Signed out from the library itself, through the toolbar's real menu.
        await page.getByRole('button', { name: /user menu/i }).click();
        await page.getByRole('menuitem', { name: 'Sign Out' }).click();

        const manual = page.locator('#txtManualName');
        await expect(page.locator('.manualLoginForm')).toBeVisible({
            timeout: 15_000
        });
        await manual.fill('account-b');
        await page.locator('#txtManualPassword').fill('b-password');
        await page.locator('.manualLoginForm button[type="submit"]').click();
        await expect
            .poll(() =>
                page.evaluate(
                    () =>
                        JSON.parse(
                            localStorage.getItem('jellyfin_credentials') ?? '{}'
                        ).Servers?.[0]?.UserId
                )
            )
            .toBe(USER_B);
        await expect(page.locator('.manualLoginForm')).toBeHidden();

        // B at the same URL, while A's late answer lands.
        await page.evaluate((id) => {
            window.location.hash = `#/library/${id}`;
        }, SHARED);
        await expect(page.locator(GRID_CARD).first()).toContainText(bName(0));
        for (const held of fixture.held) held.release();
        await page.waitForTimeout(500);
        // Really delivered: a request aborted on the way would leave the late answer untested.
        expect(fixture.held.map((held) => held.outcome)).toEqual(
            fixture.held.map(() => 'delivered')
        );

        const everything = await page.locator('body').innerText();
        expect(everything).not.toContain('A-only');
        expect(
            await page
                .locator('.rf-library-continuous')
                .getAttribute('data-rf-total')
        ).toBe(String(B_TOTAL));
        // No restoration of A's position or focus.
        await expect(page.getByText('no longer here')).toHaveCount(0);
        expect(
            await page.evaluate(() =>
                document.activeElement?.closest('.rf-library-continuous')
            )
        ).toBeNull();
        expect(
            await page.evaluate(() => ({
                y: window.scrollY,
                x:
                    document.querySelector('.rf-media-shelf__scroller')
                        ?.scrollLeft ?? 0
            }))
        ).toEqual({ x: 0, y: 0 });

        // B's history includes A's entries: going back onto one must not restore A's anything.
        await page.goBack();
        await page.waitForTimeout(500);
        expect(await page.locator('body').innerText()).not.toContain('A-only');
        await page.goForward();
        await expect(page.locator(GRID_CARD).first()).toContainText(bName(0));

        // A library B has no right to.
        await page.evaluate((id) => {
            window.location.hash = `#/library/${id}`;
        }, SECRET);
        await page.waitForTimeout(800);
        expect(await page.locator('body').innerText()).not.toContain('A-only');
        await expect(page.locator(GRID_CARD)).toHaveCount(0);

        // The persisted cache, which outlives the page, holds nothing of A either.
        await expect
            .poll(() => persistedHolds(page, bName(0)), {
                timeout: 15_000
            })
            .toBe(true);
        expect(await persistedHolds(page, 'A-only')).toBe(false);
        expect(ledger.undeclared).toEqual([]);
        test.info().annotations.push({
            type: 'held requests of A',
            description: fixture.held.map((held) => held.outcome).join(', ')
        });
    });
}
