/**
 * A deterministic, same-origin Reefin API for the server-free Item Details browser suite.
 *
 * WHY SAME ORIGIN. `index.html` ships `connect-src 'self'`, so a fixture API on another port is
 * blocked by the page's own Content Security Policy before a request is made. The fixture therefore
 * answers on the origin the production build is served from, and static assets are told apart from
 * API calls by an exact allowlist built from `dist/` on disk — not by guessing at path prefixes.
 *
 * WHY FAIL-CLOSED. Every request that is neither a `dist/` file nor a declared endpoint is recorded
 * in {@link ApiLedger.undeclared} and answered `501`. A route that starts issuing a request nobody
 * recorded fails the suite instead of quietly succeeding.
 *
 * This does NOT depend on the server repository, on `ci/serve-e2e.sh`, or on any untracked helper:
 * it needs `npm run build:production` and nothing else.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Page, Route } from '@playwright/test';

export const SERVER_ID = 'server-1';
export const USER_ID = 'user-1';
export const ACCESS_TOKEN = 'fixture-token';

export interface ApiLedger {
    /** Every API request the page issued, as `METHOD /path`, in order. */
    requests: string[];
    /** Requests that matched no declared endpoint. Non-empty is a failure. */
    undeclared: string[];
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

const list = (items: unknown[]) => ({
    Items: items,
    TotalRecordCount: items.length,
    StartIndex: 0
});

const USER = {
    Id: USER_ID,
    Name: 'Fixture User',
    ServerId: SERVER_ID,
    HasPassword: true,
    Policy: {
        IsAdministrator: false,
        EnableLiveTvManagement: false,
        EnableContentDownloading: true,
        EnableMediaPlayback: true,
        EnableVideoPlaybackTranscoding: true
    },
    Configuration: { PlayDefaultAudioTrack: true }
};

/** Streams shaped so the version, audio and subtitle selectors all have something to show. */
const MEDIA_STREAMS = [
    {
        Index: 0,
        Type: 'Video',
        Codec: 'h264',
        DisplayTitle: '1080p H264',
        Width: 1920,
        Height: 1080
    },
    { Index: 1, Type: 'Audio', DisplayTitle: 'English AAC', IsDefault: true },
    { Index: 2, Type: 'Audio', DisplayTitle: 'French AC3' },
    {
        Index: 3,
        Type: 'Subtitle',
        DisplayTitle: 'English SRT',
        IsDefault: true
    },
    { Index: 4, Type: 'Subtitle', DisplayTitle: 'French PGS' }
];

const source = (id: string, name: string) => ({
    Id: id,
    Name: name,
    Type: 'Default',
    Container: 'mkv',
    SupportsDirectPlay: true,
    SupportsDirectStream: true,
    SupportsTranscoding: false,
    DefaultAudioStreamIndex: 1,
    DefaultSubtitleStreamIndex: 3,
    MediaStreams: MEDIA_STREAMS
});

export const MOVIE = {
    Id: 'movie-1',
    ServerId: SERVER_ID,
    Name: 'Fixture Movie',
    Type: 'Movie',
    MediaType: 'Video',
    IsFolder: false,
    CanDelete: true,
    RunTimeTicks: 60_000_000_000,
    ProductionYear: 2026,
    Overview: 'A fixture overview for the Item Details characterization.',
    Taglines: ['A fixture tagline.'],
    Tags: ['fixture-tag'],
    Genres: ['Drama'],
    GenreItems: [{ Id: 'genre-1', Name: 'Drama' }],
    Studios: [{ Id: 'studio-1', Name: 'Fixture Studio' }],
    People: [
        { Id: 'person-1', Name: 'Fixture Director', Type: 'Director' },
        {
            Id: 'person-2',
            Name: 'Fixture Actor',
            Type: 'Actor',
            Role: 'Someone'
        }
    ],
    UserData: {
        Key: 'movie-1',
        PlaybackPositionTicks: 0,
        Played: false,
        IsFavorite: false
    },
    MediaSources: [
        source('movie-1', 'Version A'),
        source('movie-1-alt', 'Version B')
    ],
    ImageTags: {}
};

export const SERIES = {
    Id: 'series-1',
    ServerId: SERVER_ID,
    Name: 'Fixture Series',
    Type: 'Series',
    IsFolder: true,
    IsSeries: true,
    Status: 'Continuing',
    Overview: 'A fixture series.',
    People: [],
    UserData: { Key: 'series-1' },
    ImageTags: {}
};

export const SEASON = {
    Id: 'season-1',
    ServerId: SERVER_ID,
    Name: 'Season 1',
    Type: 'Season',
    IsFolder: true,
    IsSeries: true,
    SeriesId: 'series-1',
    SeriesName: 'Fixture Series',
    IndexNumber: 1,
    People: [],
    UserData: { Key: 'season-1' },
    ImageTags: {}
};

const EPISODES = [1, 2, 3].map((n) => ({
    Id: `episode-${n}`,
    ServerId: SERVER_ID,
    Name: `Episode ${n}`,
    Type: 'Episode',
    MediaType: 'Video',
    SeriesId: 'series-1',
    SeasonId: 'season-1',
    IndexNumber: n,
    ParentIndexNumber: 1,
    UserData: { Key: `episode-${n}`, PlaybackPositionTicks: 0 },
    ImageTags: {}
}));

const ITEMS: Record<string, unknown> = {
    'movie-1': MOVIE,
    'series-1': SERIES,
    'season-1': SEASON
};

/**
 * Install the fixture API and the static allowlist on a page.
 *
 * Returns the ledger so a test can assert on what the route actually asked for.
 */
export async function installFixtureApi(
    page: Page,
    origin: string,
    distDir: string
): Promise<ApiLedger> {
    const staticFiles = distFileSet(distDir);
    const ledger: ApiLedger = { requests: [], undeclared: [] };

    await page.addInitScript(
        ([apiOrigin, serverId, userId, token]) => {
            /*
             * Drop React Query's persisted cache before the app boots.
             *
             * `utils/query/queryClient.ts` persists the whole client into IndexedDB through
             * `idb-keyval` (database `keyval-store`, key `tesserafin-query-cache`) with a 24-hour
             * gcTime. A request-sensitive assertion in a suite that reused that store would pass
             * from a previous run's cached data rather than from a request the route issued, which
             * is exactly the accident Phase 3 requirement 11 names. Deleting the database is
             * cheaper and more honest than trying to invalidate individual keys.
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
        },
        [origin, SERVER_ID, USER_ID, ACCESS_TOKEN]
    );

    await page.route('**/*', async (route: Route) => {
        const url = new URL(route.request().url());
        const path = decodeURIComponent(url.pathname);

        if (staticFiles.has(path) || path === '/') return route.fallback();

        const method = route.request().method();
        ledger.requests.push(`${method} ${path}`);

        const json = (body: unknown) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(body)
            });

        // --- session bootstrap -------------------------------------------------------------
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
        if (path === `/Users/${USER_ID}` || path === '/Users/Me')
            return json(USER);
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

        // --- item reads --------------------------------------------------------------------
        const byId = path.match(
            /^\/(?:Users\/[^/]+\/)?Items\/([^/?]+)(\/[A-Za-z]+)?$/
        );
        if (byId) {
            const [, id, sub] = byId;
            if (!sub && ITEMS[id]) return json(ITEMS[id]);
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
                return json({ MediaSources: MOVIE.MediaSources });
        }
        if (path === '/Shows/series-1/Seasons') return json(list([SEASON]));
        if (path === '/Shows/series-1/Episodes') return json(list(EPISODES));
        if (path === '/Shows/NextUp') return json(list([]));
        if (path === '/LiveTv/Programs') return json(list([]));
        if (path === '/Items') return json(list([]));

        // --- user-data mutations -----------------------------------------------------------
        if (
            /^\/(?:Users\/[^/]+\/)?(?:UserPlayedItems|PlayedItems)\//.test(path)
        )
            return json({ ...MOVIE.UserData, Played: method === 'POST' });
        if (
            /^\/(?:Users\/[^/]+\/)?(?:UserFavoriteItems|FavoriteItems)\//.test(
                path
            )
        )
            return json({ ...MOVIE.UserData, IsFavorite: method === 'POST' });
        if (/\/(?:UserItems|Items)\/[^/]+\/(?:UserData|Rating)/.test(path))
            return json(MOVIE.UserData);

        ledger.undeclared.push(`${method} ${path}`);
        return route.fulfill({
            status: 501,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'undeclared fixture endpoint' })
        });
    });

    return ledger;
}
