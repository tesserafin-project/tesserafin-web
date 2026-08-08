/**
 * A deterministic, same-origin Reefin API for the server-free Content packs browser suite (#138).
 *
 * WHY SAME ORIGIN. `index.html` ships `connect-src 'self'`, so a fixture API on another port is
 * blocked by the page's own Content Security Policy before a request is made. The fixture answers on
 * the origin the production build is served from, and static assets are told apart from API calls by
 * an exact allowlist built from `dist/` on disk — the same construction
 * `tests/itemDetailsBrowser/support/fixtureApi.ts` uses, for the same reason.
 *
 * ## WHAT THIS FIXTURE IS, AND WHAT IT DELIBERATELY IS NOT
 *
 * It is a TRANSPORT. It returns pre-authored M1 response shapes and records what was asked for.
 *
 * It is NOT a re-implementation of the server. In particular it does not:
 *
 *   * evaluate authorization — a "user B cannot see pack 3" scenario is expressed by AUTHORING user
 *     B's responses without pack 3, exactly as a server that had filtered it would have answered.
 *     Nothing here reads a policy and decides;
 *   * compute `VisibleItemCount` — every count is a literal in the profile below. A fixture that
 *     derived the count from its own item array would be making the projection the Web is forbidden
 *     to make, and the suite would then be proving the fixture's arithmetic rather than the client's
 *     restraint;
 *   * choose `RepresentativeItemId` — likewise a literal;
 *   * derive membership. `GET /Items/{itemId}/ContentPacks` answers from an authored map, and the
 *     add/remove writes mutate that map because a WRITE is a transport event: the point of the
 *     membership scenarios is that the client re-reads afterwards rather than guessing.
 *
 * The one derived thing is paging: `GET /ContentPacks/{packId}/Items` slices the authored item array
 * by `startIndex`/`limit`, because paging is transport, not projection. Its `TotalRecordCount` is
 * the authored `visibleTotal`, NOT the array length, so a suite can express "the server says there
 * are more pages than this array" without the fixture silently disagreeing with itself.
 *
 * ## FAIL-CLOSED
 *
 * Every request that is neither a `dist/` file nor a declared endpoint is recorded in
 * {@link ApiLedger.undeclared} and answered `501`. A route that starts issuing a request nobody
 * declared fails the suite instead of quietly succeeding.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Page, Route } from '@playwright/test';

export const SERVER_ID = 'server-1';
export const ACCESS_TOKEN = 'fixture-token';

/** Both accounts the no-leak proof uses. Two ids, two authored projections, one fixture. */
export const USER_A = 'user-a';
export const USER_B = 'user-b';

export interface ApiLedger {
    /** Every API request the page issued, as `METHOD /path`, in order. */
    requests: string[];
    /** Requests that matched no declared endpoint. Non-empty is a failure. */
    undeclared: string[];
    /** Bodies of the writes, in order, so a suite can assert the exact payload sent. */
    writes: Array<{ method: string; path: string; body: unknown }>;
}

/** Every file the production build emitted, as an absolute URL path. */
export function distFileSet(distDir: string): Set<string> {
    const files = new Set<string>();
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) walk(full);
            else files.add(`/${relative(distDir, full).split('\\').join('/')}`);
        }
    };
    walk(distDir);
    return files;
}

const list = (items: unknown[], totalRecordCount = items.length) => ({
    Items: items,
    TotalRecordCount: totalRecordCount,
    StartIndex: 0
});

/** One pack, exactly as the server projects it FOR ONE USER. Every field is authored. */
export interface FixturePack {
    Id: string;
    Name: string;
    Description?: string | null;
    /** The server's projection. Never derived from `items`. */
    VisibleItemCount: number;
    /** The server's choice. `null` means the server declined to name one. */
    RepresentativeItemId?: string | null;
    /** The authorized items, in the server's order. */
    items: FixtureItem[];
    /** `TotalRecordCount` for the items page. Defaults to `items.length`. */
    visibleTotal?: number;
}

export interface FixtureItem {
    Id: string;
    Name: string;
    Type: string;
    MediaType?: string;
    IsFolder?: boolean;
    ServerId?: string;
    SeriesId?: string;
    SeriesName?: string;
    SeasonId?: string;
    IndexNumber?: number;
    ParentIndexNumber?: number;
    AlbumArtists?: Array<{ Id: string; Name: string }>;
    ImageTags?: Record<string, string>;
    SeriesPrimaryImageTag?: string;
    UserData?: Record<string, unknown>;
    RunTimeTicks?: number;
}

/**
 * The four media families the mixed-media ruling names, each with the artwork tags and the
 * parentage its Home-adapter branch actually reads.
 */
export const MOVIE: FixtureItem = {
    Id: 'movie-1',
    Name: 'Fixture Movie',
    Type: 'Movie',
    MediaType: 'Video',
    IsFolder: false,
    ServerId: SERVER_ID,
    RunTimeTicks: 60_000_000_000,
    ImageTags: { Primary: 'movie-primary' },
    UserData: { Key: 'movie-1', PlaybackPositionTicks: 0, Played: false }
};

export const EPISODE: FixtureItem = {
    Id: 'episode-1',
    Name: 'Fixture Episode',
    Type: 'Episode',
    MediaType: 'Video',
    IsFolder: false,
    ServerId: SERVER_ID,
    SeriesId: 'series-1',
    SeriesName: 'Fixture Series',
    SeasonId: 'season-1',
    IndexNumber: 1,
    ParentIndexNumber: 1,
    RunTimeTicks: 24_000_000_000,
    // No own Primary: the Home adapter must inherit the series artwork for this one.
    ImageTags: {},
    SeriesPrimaryImageTag: 'series-primary',
    UserData: { Key: 'episode-1', PlaybackPositionTicks: 0, Played: false }
};

export const MUSIC_ALBUM: FixtureItem = {
    Id: 'album-1',
    Name: 'Fixture Album',
    Type: 'MusicAlbum',
    IsFolder: true,
    ServerId: SERVER_ID,
    AlbumArtists: [{ Id: 'artist-1', Name: 'Fixture Artist' }],
    ImageTags: { Primary: 'album-primary' },
    UserData: { Key: 'album-1' }
};

export const BOOK: FixtureItem = {
    Id: 'book-1',
    Name: 'Fixture Book',
    Type: 'Book',
    MediaType: 'Book',
    IsFolder: false,
    ServerId: SERVER_ID,
    ImageTags: { Primary: 'book-primary' },
    UserData: { Key: 'book-1' }
};

/** An item the server named as a representative but for which it sent no image tag. */
export const UNARTED: FixtureItem = {
    Id: 'movie-2',
    Name: 'Fixture Movie Without Artwork',
    Type: 'Movie',
    MediaType: 'Video',
    IsFolder: false,
    ServerId: SERVER_ID,
    ImageTags: {},
    UserData: { Key: 'movie-2' }
};

/** How a declared endpoint should behave for one scenario. */
export interface FaultProfile {
    /** `GET /ContentPacks` answers this status instead of `200`. */
    listStatus?: number;
    /** `GET /ContentPacks/{packId}` answers this status instead of `200`. */
    detailStatus?: number;
    /** `GET /ContentPacks/{packId}/Items` answers this status instead of `200`. */
    itemsStatus?: number;
    /** Every write answers this status instead of succeeding. */
    writeStatus?: number;
    /** `POST /ContentPacks` answers `409` — the duplicate-name case. */
    createConflict?: boolean;
    /** Milliseconds each `GET /ContentPacks/{packId}` waits, by pack id. Stale-response races. */
    detailDelayMs?: Record<string, number>;
    /** `GET /ContentPacks` never answers until released. The loading state. */
    holdList?: boolean;
}

export interface FixtureProfile {
    userId: string;
    userName: string;
    /** `EnableContentPackManagement`, verbatim. The only thing that draws a manager control. */
    canManage: boolean;
    isAdministrator?: boolean;
    packs: FixturePack[];
    /** `GET /Items/{itemId}/ContentPacks` — authored, then mutated by the membership writes. */
    membership?: Record<string, string[]>;
    /** Items reachable by id for the Item Details assignment scenarios. */
    items?: FixtureItem[];
    faults?: FaultProfile;
    /**
     * The theme id to boot with, e.g. `official.classic` or `official.glass`.
     *
     * Written into `localStorage` as `<userId>-appTheme` BEFORE the app boots, which is exactly
     * where `userSettings.theme()` reads it from: `set('appTheme', value, false)` bypasses
     * DisplayPreferences entirely and goes to `appSettings`, whose key is `userId + '-' + name`.
     * The server-free suite has no theme picker to drive (that path needs a real server), so this
     * is the same storage the picker would have written, not a substitute for it.
     */
    theme?: string;
    /**
     * The layout mode to boot with — `tv` is what actually turns on the remote path.
     *
     * `scripts/keyboardNavigation.js` IGNORES every navigation key unless `layoutManager.tv`
     * (`if (!layoutManager.tv && isNavigationKey(key)) return;`), so a "TV" spec that merely used a
     * 1920x1080 viewport would be pressing arrows that the application never sees, and would prove
     * nothing about remote support. `layoutManager` reads the mode from `appSettings.get('layout')`,
     * which is an un-namespaced `localStorage` key.
     */
    layout?: 'tv' | 'mobile' | 'desktop';
}

const packDto = (pack: FixturePack) => ({
    Id: pack.Id,
    Name: pack.Name,
    Description: pack.Description ?? null,
    VisibleItemCount: pack.VisibleItemCount,
    RepresentativeItemId: pack.RepresentativeItemId ?? null
});

const userDto = (profile: FixtureProfile) => ({
    Id: profile.userId,
    Name: profile.userName,
    ServerId: SERVER_ID,
    HasPassword: true,
    Policy: {
        IsAdministrator: profile.isAdministrator ?? false,
        EnableContentPackManagement: profile.canManage,
        EnableLiveTvManagement: false,
        EnableContentDownloading: true,
        EnableMediaPlayback: true,
        EnableVideoPlaybackTranscoding: true
    },
    Configuration: { PlayDefaultAudioTrack: true }
});

export interface InstalledFixture {
    ledger: ApiLedger;
    /** Mutable: a scenario can change the profile between navigations. */
    profile: FixtureProfile;
    /** Release a `holdList` fault so the pending list finally answers. */
    releaseList: () => void;
}

/**
 * Install the fixture API, the static allowlist and a signed-in session on a page.
 *
 * The returned handle is live: mutating `profile` changes what the next request answers, which is
 * how "the server now reports a different order" is expressed without restarting anything.
 */
export async function installFixtureApi(
    page: Page,
    origin: string,
    distDir: string,
    profile: FixtureProfile
): Promise<InstalledFixture> {
    const staticFiles = distFileSet(distDir);
    const ledger: ApiLedger = { requests: [], undeclared: [], writes: [] };
    const state: InstalledFixture = {
        ledger,
        profile,
        releaseList: () => {
            /* replaced below */
        }
    };

    let releaseList: (() => void) | null = null;
    const listGate = new Promise<void>((resolve) => {
        releaseList = resolve;
    });
    state.releaseList = () => releaseList?.();

    await page.addInitScript(
        ([apiOrigin, serverId, userId, token, theme, layout]) => {
            /*
             * Drop React Query's persisted cache before the app boots. `utils/query/queryClient.ts`
             * persists the whole client into IndexedDB (`keyval-store`), so a request-sensitive
             * assertion in a suite that reused that store would pass from a previous run's cached
             * data rather than from a request this route issued.
             */
            indexedDB.deleteDatabase('keyval-store');

            localStorage.setItem(
                'jellyfin_credentials',
                JSON.stringify({
                    Servers: [
                        {
                            Id: serverId,
                            Name: 'Fixture',
                            ManualAddress: apiOrigin,
                            LastConnectionMode: 2,
                            AccessToken: token,
                            UserId: userId,
                            DateLastAccessed: 1
                        }
                    ]
                })
            );

            if (theme) localStorage.setItem(`${userId}-appTheme`, theme);
            if (layout) localStorage.setItem('layout', layout);
        },
        [
            origin,
            SERVER_ID,
            state.profile.userId,
            ACCESS_TOKEN,
            state.profile.theme ?? '',
            state.profile.layout ?? ''
        ]
    );

    await page.route('**/*', async (route: Route) => {
        const url = new URL(route.request().url());
        const path = decodeURIComponent(url.pathname);
        const current = state.profile;
        const faults = current.faults ?? {};

        if (staticFiles.has(path) || path === '/') return route.fallback();

        const method = route.request().method();
        ledger.requests.push(`${method} ${path}`);

        const json = (body: unknown, status = 200) =>
            route.fulfill({
                status,
                contentType: 'application/json',
                body: JSON.stringify(body)
            });
        const status = (code: number) =>
            route.fulfill({
                status: code,
                contentType: 'application/json',
                body: JSON.stringify({ status: code })
            });
        const recordWrite = () => {
            let body: unknown = null;
            try {
                body = route.request().postDataJSON();
            } catch {
                body = route.request().postData();
            }
            ledger.writes.push({ method, path, body });
            return body;
        };

        // --- artwork ------------------------------------------------------------------------
        // A 1x1 PNG, so a card that asked for a picture actually gets one and a capture is not
        // waiting on a request that will never settle.
        if (/^\/Items\/[^/]+\/Images\//.test(path)) {
            return route.fulfill({
                status: 200,
                contentType: 'image/png',
                body: Buffer.from(
                    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
                    'base64'
                )
            });
        }

        // --- session bootstrap ---------------------------------------------------------------
        if (path === '/System/Info/Public')
            return json({
                Id: SERVER_ID,
                ServerName: 'Fixture',
                Version: '1.0.0',
                ProductName: 'Reefin',
                StartupWizardCompleted: true
            });
        if (path === '/System/Info')
            return json({
                Id: SERVER_ID,
                ServerName: 'Fixture',
                Version: '1.0.0'
            });
        if (path === '/System/Endpoint')
            return json({ IsLocal: true, IsInNetwork: true });
        if (path === `/Users/${current.userId}` || path === '/Users/Me')
            return json(userDto(current));
        if (path.startsWith('/Sessions'))
            return route.fulfill({ status: 204, body: '' });
        if (path.startsWith('/DisplayPreferences'))
            return json({ CustomPrefs: {} });
        if (path.startsWith('/Branding')) return json({});
        if (path.startsWith('/QuickConnect')) return json(false);
        if (path === '/UserViews') return json(list([]));
        if (path === '/SyncPlay/List') return json([]);
        if (path.startsWith('/Playback/BitrateTest'))
            return route.fulfill({ status: 200, body: 'x'.repeat(1024) });

        // --- the ten content-pack operations --------------------------------------------------

        // 6. GET /ContentPacks
        if (path === '/ContentPacks' && method === 'GET') {
            if (faults.holdList) await listGate;
            if (faults.listStatus) return status(faults.listStatus);
            return json(current.packs.map(packDto));
        }

        // 2. POST /ContentPacks
        if (path === '/ContentPacks' && method === 'POST') {
            const body = recordWrite() as { Name?: string } | null;
            if (faults.createConflict) return status(409);
            if (faults.writeStatus) return status(faults.writeStatus);
            const created: FixturePack = {
                Id: `pack-created-${current.packs.length + 1}`,
                Name: body?.Name ?? '',
                Description: (body as { Description?: string | null })
                    ?.Description,
                VisibleItemCount: 0,
                RepresentativeItemId: null,
                items: []
            };
            current.packs = [...current.packs, created];
            return json(packDto(created));
        }

        // 9. POST /ContentPacks/Order
        if (path === '/ContentPacks/Order' && method === 'POST') {
            const body = recordWrite() as string[] | { PackIds?: string[] };
            if (faults.writeStatus) return status(faults.writeStatus);
            const ids = Array.isArray(body) ? body : (body?.PackIds ?? []);
            /*
             * Re-ordered by the ids the client sent, which is the whole point: the mosaic then
             * re-READS the list and shows what the server reports. A client that reordered its own
             * array would look identical here and be wrong — the ordering assertions all compare
             * against this array after a refetch, never against the request body.
             */
            const byId = new Map(current.packs.map((p) => [p.Id, p]));
            const reordered = ids
                .map((id) => byId.get(id))
                .filter(Boolean) as FixturePack[];
            const missing = current.packs.filter((p) => !ids.includes(p.Id));
            current.packs = [...reordered, ...missing];
            return route.fulfill({ status: 204, body: '' });
        }

        const packMatch = path.match(/^\/ContentPacks\/([^/]+)$/);
        if (packMatch) {
            const packId = packMatch[1];
            const pack = current.packs.find((p) => p.Id === packId);

            // 4. GET /ContentPacks/{packId}
            if (method === 'GET') {
                const delay = faults.detailDelayMs?.[packId];
                if (delay) await new Promise((r) => setTimeout(r, delay));
                if (faults.detailStatus) return status(faults.detailStatus);
                if (!pack) return status(404);
                return json(packDto(pack));
            }

            // 10. POST /ContentPacks/{packId}
            if (method === 'POST') {
                const body = recordWrite() as {
                    Name?: string;
                    Description?: string | null;
                } | null;
                if (faults.createConflict) return status(409);
                if (faults.writeStatus) return status(faults.writeStatus);
                if (!pack) return status(404);
                /*
                 * The identifier is NOT re-issued. The response carries the same `Id` it was asked
                 * for, which is what makes "a rename does not change identity" checkable from
                 * outside: a client that re-keyed anything would have had to invent the new key.
                 */
                pack.Name = body?.Name ?? pack.Name;
                pack.Description = body?.Description ?? null;
                return json(packDto(pack));
            }

            // 3. DELETE /ContentPacks/{packId}
            if (method === 'DELETE') {
                recordWrite();
                if (faults.writeStatus) return status(faults.writeStatus);
                if (!pack) return status(404);
                current.packs = current.packs.filter((p) => p.Id !== packId);
                for (const key of Object.keys(current.membership ?? {})) {
                    current.membership![key] = current.membership![key].filter(
                        (id) => id !== packId
                    );
                }
                return route.fulfill({ status: 204, body: '' });
            }
        }

        // 5. GET /ContentPacks/{packId}/Items
        const itemsMatch = path.match(/^\/ContentPacks\/([^/]+)\/Items$/);
        if (itemsMatch && method === 'GET') {
            const pack = current.packs.find((p) => p.Id === itemsMatch[1]);
            if (faults.itemsStatus) return status(faults.itemsStatus);
            if (!pack) return status(404);
            const startIndex = Number(url.searchParams.get('startIndex') ?? 0);
            const limit = Number(url.searchParams.get('limit') ?? 50);
            return json({
                ...list(
                    pack.items.slice(startIndex, startIndex + limit),
                    pack.visibleTotal ?? pack.items.length
                ),
                StartIndex: startIndex
            });
        }

        // 1. POST and 8. DELETE /ContentPacks/{packId}/Items/{itemId}
        const membershipMatch = path.match(
            /^\/ContentPacks\/([^/]+)\/Items\/([^/]+)$/
        );
        if (membershipMatch && (method === 'POST' || method === 'DELETE')) {
            const [, packId, itemId] = membershipMatch;
            recordWrite();
            if (faults.writeStatus) return status(faults.writeStatus);
            current.membership = current.membership ?? {};
            const before = current.membership[itemId] ?? [];
            if (method === 'POST') {
                /*
                 * A repeated add is a SUCCESSFUL no-op — composite uniqueness on (pack, item) at
                 * the server. Answering an error here would be modelling a server that does not
                 * exist, and the client would then be asserted against the wrong contract.
                 */
                current.membership[itemId] = before.includes(packId)
                    ? before
                    : [...before, packId];
            } else {
                current.membership[itemId] = before.filter(
                    (id) => id !== packId
                );
            }
            return route.fulfill({ status: 204, body: '' });
        }

        // 7. GET /Items/{itemId}/ContentPacks
        const forItemMatch = path.match(/^\/Items\/([^/]+)\/ContentPacks$/);
        if (forItemMatch && method === 'GET') {
            const ids = current.membership?.[forItemMatch[1]] ?? [];
            const byId = new Map(current.packs.map((p) => [p.Id, p]));
            return json(
                ids.map((id) => {
                    const pack = byId.get(id);
                    return pack
                        ? packDto(pack)
                        : {
                              Id: id,
                              Name: id,
                              VisibleItemCount: 0,
                              RepresentativeItemId: null
                          };
                })
            );
        }

        // --- item reads, for the Item Details assignment scenarios -----------------------------
        const allItems = [
            ...(current.items ?? []),
            ...current.packs.flatMap((p) => p.items)
        ];
        const byId = path.match(
            /^\/(?:Users\/[^/]+\/)?Items\/([^/?]+)(\/[A-Za-z]+)?$/
        );
        if (byId) {
            const [, id, sub] = byId;
            const item = allItems.find((candidate) => candidate.Id === id);
            if (!sub && item) return json({ ...item, People: [] });
            if (sub === '/Ancestors') return json([]);
            if (sub === '/ThemeMedia')
                return json({
                    ThemeVideosResult: list([]),
                    ThemeSongsResult: list([])
                });
            if (sub === '/Similar') return json(list([]));
            if (sub === '/Collections') return json(list([]));
            if (sub === '/SpecialFeatures') return json([]);
            if (sub === '/AdditionalParts') return json(list([]));
            if (sub === '/PlaybackInfo')
                return json({
                    MediaSources: [
                        {
                            Id: id,
                            Name: item?.Name ?? id,
                            Container: 'mkv',
                            SupportsDirectPlay: true,
                            SupportsDirectStream: true,
                            SupportsTranscoding: false,
                            MediaStreams: [
                                {
                                    Index: 0,
                                    Type: 'Video',
                                    Codec: 'h264',
                                    DisplayTitle: '1080p H264'
                                }
                            ]
                        }
                    ]
                });
        }
        if (path === '/Shows/NextUp') return json(list([]));
        if (path === '/LiveTv/Timers') return json(list([]));
        if (path === '/LiveTv/Programs') return json(list([]));
        if (path === '/Items') return json(list([]));
        if (
            /^\/(?:Users\/[^/]+\/)?(?:UserPlayedItems|PlayedItems)\//.test(path)
        )
            return json({ Played: method === 'POST' });
        if (
            /^\/(?:Users\/[^/]+\/)?(?:UserFavoriteItems|FavoriteItems)\//.test(
                path
            )
        )
            return json({ IsFavorite: method === 'POST' });
        if (/\/(?:UserItems|Items)\/[^/]+\/(?:UserData|Rating)/.test(path))
            return json({});

        ledger.undeclared.push(`${method} ${path}`);
        return route.fulfill({
            status: 501,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'undeclared fixture endpoint' })
        });
    });

    return state;
}
