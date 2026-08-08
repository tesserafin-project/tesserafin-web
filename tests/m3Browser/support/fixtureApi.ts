/**
 * A deterministic, same-origin Reefin API for the server-free M3 browser suite (#139).
 *
 * Same construction and the same reasons as `tests/contentPacksBrowser/support/fixtureApi.ts`: the
 * production build ships `connect-src 'self'`, so a fixture on another port is blocked by the page's
 * own CSP before a request leaves; static assets are told apart from API calls by an exact allowlist
 * built from `dist/` on disk; and everything undeclared is recorded and answered `501` so a new
 * request nobody declared fails the suite instead of quietly succeeding.
 *
 * ## IT IS A TRANSPORT, NOT A SERVER
 *
 * In particular it does **not** evaluate authorization. That matters more here than it did for M2,
 * because the whole point of the wizard scenarios is a caller whose policy says
 * `EnableContentPackManagement: false` and whose `POST /ContentPacks` nevertheless succeeds. The
 * fixture answers `200` because the real server answers `200` — measured on `1cca371cba` and
 * recorded in `tesserafin-project/tesserafin#220`, where an administrator satisfies every
 * `UserPermissionRequirement` through `DefaultAuthorizationHandler`. If this file read the policy
 * and decided, the suite would be proving the fixture's copy of the server's rules rather than the
 * client's willingness to ask.
 *
 * The one thing it *does* enforce is the presence of a token, because "tokenless requests remain
 * impossible" is a claim about the client, not about a policy: `authRequired` endpoints answer `401`
 * when no `Authorization` token reaches them.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Page, Route } from '@playwright/test';

export const SERVER_ID = 'server-1';
export const ACCESS_TOKEN = 'fixture-token';

export const USER_A = 'user-a';
export const USER_B = 'user-b';

export interface ApiLedger {
    /** Every API request the page issued, as `METHOD /path`, in order. */
    requests: string[];
    /** Requests that matched no declared endpoint. Non-empty is a failure. */
    undeclared: string[];
    /** Bodies of the writes, in order, so a spec can assert the exact payload sent. */
    writes: Array<{ method: string; path: string; body: unknown }>;
    /** Requests that arrived with no token. Used by the tokenless proof. */
    tokenless: string[];
}

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

export interface FixtureUser {
    id: string;
    name: string;
    isAdministrator: boolean;
    /** `EnableContentPackManagement`. Authored, never consulted for a decision. */
    canManage: boolean;
    /** The `UserConfiguration` the server would answer with, verbatim. */
    configuration: Record<string, unknown>;
}

export interface FixtureFaults {
    /** `POST /Startup/User` answers this status instead of `204`. */
    startupUserStatus?: number;
    /** `POST /Users/AuthenticateByName` answers this status instead of `200`. */
    authenticateStatus?: number;
    /** `POST /ContentPacks` answers this status instead of `200`. */
    createPackStatus?: number;
    /** `POST /ContentPacks` fails for exactly these names, then succeeds on retry. */
    createPackFailsOnceFor?: string[];
    /** `POST /Users/{id}/Configuration` answers this status instead of `204`. */
    configurationStatus?: number;
}

export interface FixtureProfile {
    /** Whether the app boots with a session already installed. */
    signedIn: boolean;
    /** `StartupWizardCompleted` on `/System/Info/Public`. */
    wizardCompleted: boolean;
    users: FixtureUser[];
    /** The user a signed-in boot is signed in as. */
    currentUserId: string;
    packs: Array<{ Id: string; Name: string }>;
    faults?: FixtureFaults;
    theme?: string;
    layout?: 'tv' | 'mobile' | 'desktop';
}

export const administrator = (
    over: Partial<FixtureUser> = {}
): FixtureUser => ({
    id: USER_A,
    name: 'household-admin',
    isAdministrator: true,
    // The measured fresh-install shape: administrator, capability false.
    canManage: false,
    configuration: { PlayDefaultAudioTrack: true },
    ...over
});

const userDto = (user: FixtureUser) => ({
    Id: user.id,
    Name: user.name,
    ServerId: SERVER_ID,
    HasPassword: true,
    Policy: {
        IsAdministrator: user.isAdministrator,
        EnableContentPackManagement: user.canManage,
        EnableContentDownloading: true,
        EnableMediaPlayback: true,
        EnableVideoPlaybackTranscoding: true
    },
    Configuration: user.configuration
});

export interface InstalledFixture {
    ledger: ApiLedger;
    /** Mutable: a scenario can change the profile between navigations. */
    profile: FixtureProfile;
    /** Names sent to `POST /ContentPacks`, in order, including duplicates. */
    createdPackNames: () => string[];
    /** The last body sent to `POST /Users/{id}/Configuration`, or null. */
    lastConfigurationWrite: () => Record<string, unknown> | null;
    /**
     * Point the stored session at another account, as signing out and back in would.
     *
     * It has to be an init script rather than a `localStorage` write from the test: the install
     * script re-writes `jellyfin_credentials` on EVERY boot, so an edit made in the page would be
     * silently overwritten by the next reload and the suite would go on testing the first user
     * while believing it had switched.
     */
    signInAs: (userId: string) => Promise<void>;
}

export async function installFixtureApi(
    page: Page,
    origin: string,
    distDir: string,
    profile: FixtureProfile
): Promise<InstalledFixture> {
    const staticFiles = distFileSet(distDir);
    const ledger: ApiLedger = {
        requests: [],
        undeclared: [],
        writes: [],
        tokenless: []
    };
    const failedOnce = new Set<string>();
    const state: InstalledFixture = {
        ledger,
        profile,
        createdPackNames: () =>
            ledger.writes
                .filter(
                    (w) =>
                        w.path.toLowerCase() === '/contentpacks' &&
                        w.method === 'POST'
                )
                .map((w) => (w.body as { Name?: string })?.Name ?? ''),
        signInAs: async (userId: string) => {
            state.profile.currentUserId = userId;
            await page.addInitScript(
                ([token, id]) => {
                    indexedDB.deleteDatabase('keyval-store');
                    const raw = localStorage.getItem('jellyfin_credentials');
                    if (!raw) return;
                    const parsed = JSON.parse(raw);
                    parsed.Servers[0].UserId = id;
                    parsed.Servers[0].AccessToken = token;
                    localStorage.setItem(
                        'jellyfin_credentials',
                        JSON.stringify(parsed)
                    );
                },
                [ACCESS_TOKEN, userId] as const
            );
        },
        lastConfigurationWrite: () => {
            const writes = ledger.writes.filter((w) =>
                /^\/users\/[^/]+\/configuration$/.test(w.path.toLowerCase())
            );
            return (
                (writes.at(-1)?.body as Record<string, unknown> | undefined) ??
                null
            );
        }
    };

    await page.addInitScript(
        ([apiOrigin, serverId, token, userId, signedIn, theme, layout]) => {
            /*
             * React Query persists its whole cache into IndexedDB (`keyval-store`). A reload that
             * reused it would answer "does the preference survive a reload?" from a previous
             * page's cache rather than from a request, and would let user B read user A's
             * configuration. Dropped before every boot.
             */
            indexedDB.deleteDatabase('keyval-store');

            const server: Record<string, unknown> = {
                Id: serverId,
                Name: 'Fixture',
                ManualAddress: apiOrigin,
                LastConnectionMode: 2,
                DateLastAccessed: 1
            };
            // A wizard boot has no session at all: that is the state a first run is actually in,
            // and it is what makes the tokenless assertions mean something.
            if (signedIn) {
                server.AccessToken = token;
                server.UserId = userId;
            }
            localStorage.setItem(
                'jellyfin_credentials',
                JSON.stringify({ Servers: [server] })
            );
            if (theme) localStorage.setItem(`${userId}-appTheme`, theme);
            if (layout) localStorage.setItem('layout', layout);
        },
        [
            origin,
            SERVER_ID,
            ACCESS_TOKEN,
            profile.currentUserId,
            profile.signedIn ? '1' : '',
            profile.theme ?? '',
            profile.layout ?? ''
        ] as const
    );

    await page.route('**/*', async (route: Route) => {
        const url = new URL(route.request().url());
        const path = decodeURIComponent(url.pathname);
        const current = state.profile;
        const faults = current.faults ?? {};

        if (staticFiles.has(path) || path === '/') return route.fallback();

        const method = route.request().method();
        ledger.requests.push(`${method} ${path}`);

        /*
         * `jellyfin-apiclient` lower-cases the paths it builds (`getUrl` normalises), while the
         * generated SDK sends them cased. The fixture therefore matches on a lower-cased copy and
         * keeps the original for the ledger, so a spec still reads `POST /ContentPacks` rather than
         * having to know which client issued it.
         */
        const lower = path.toLowerCase();

        const headers = route.request().headers();
        const hasToken = /Token="?[^",]+/.test(
            headers.authorization ?? headers['x-emby-authorization'] ?? ''
        );
        if (!hasToken) ledger.tokenless.push(`${method} ${path}`);

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
        const noContent = () => route.fulfill({ status: 204, body: '' });
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
        const findUser = (id: string) =>
            current.users.find((u) => u.id === id) ?? current.users[0];
        const currentUser = () => findUser(current.currentUserId);

        // --- session bootstrap ----------------------------------------------------------------
        if (lower === '/system/info/public')
            return json({
                Id: SERVER_ID,
                ServerName: 'Fixture',
                Version: '1.0.0',
                ProductName: 'Reefin',
                StartupWizardCompleted: current.wizardCompleted
            });
        if (lower === '/system/info')
            return json({
                Id: SERVER_ID,
                ServerName: 'Fixture',
                Version: '1.0.0'
            });
        if (lower === '/system/endpoint')
            return json({ IsLocal: true, IsInNetwork: true });
        if (lower.startsWith('/sessions')) return noContent();
        if (lower.startsWith('/displaypreferences'))
            return json({ CustomPrefs: {} });
        if (lower.startsWith('/branding')) return json({});
        if (lower.startsWith('/quickconnect')) return json(false);
        if (lower === '/userviews') {
            /*
             * Two media-family destinations, so "content-pack-first hides nothing" is a claim about
             * observable navigation rather than about an empty list. Authored, in the server's
             * order — the client never re-sorts them.
             */
            const views = [
                {
                    Id: 'view-movies',
                    Name: 'Movies',
                    CollectionType: 'movies',
                    Type: 'CollectionFolder',
                    ServerId: SERVER_ID
                },
                {
                    Id: 'view-music',
                    Name: 'Music',
                    CollectionType: 'music',
                    Type: 'CollectionFolder',
                    ServerId: SERVER_ID
                }
            ];
            return json({
                Items: views,
                TotalRecordCount: views.length,
                StartIndex: 0
            });
        }
        if (lower === '/syncplay/list') return json([]);
        /*
         * The home route's own reads. `Items/Latest` answers a BARE ARRAY, not a query result — the
         * first version of this fixture returned the query-result shape for everything under
         * `/Items`, the route did `(data ?? []).map(...)` on an object, and React Router replaced the
         * whole page with an error boundary. The toolbar assertions then failed for a reason that
         * had nothing to do with navigation.
         */
        if (lower.startsWith('/items/latest')) return json([]);
        if (lower.startsWith('/useritems/resume'))
            return json({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
        if (lower.startsWith('/items') && method === 'GET')
            return json({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
        if (lower.startsWith('/shows') && method === 'GET')
            return json({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
        if (lower.startsWith('/userplayedmedia') && method === 'GET')
            return json({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
        if (lower.startsWith('/playback/bitratetest'))
            return route.fulfill({ status: 200, body: 'x'.repeat(1024) });
        if (lower === '/users/public') return json([]);

        // --- the startup surface --------------------------------------------------------------
        if (lower === '/startup/configuration' && method === 'GET')
            return json({
                UICulture: 'en-US',
                MetadataCountryCode: 'US',
                PreferredMetadataLanguage: 'en',
                ServerName: 'Fixture'
            });
        if (lower === '/startup/configuration' && method === 'POST') {
            recordWrite();
            return noContent();
        }
        if (lower === '/startup/user' && method === 'GET')
            // The server's own answer shape: the name only. It has never sent a password back.
            return json({ Name: currentUser().name });
        if (lower === '/startup/user' && method === 'POST') {
            const body = recordWrite() as { Name?: string } | null;
            if (faults.startupUserStatus)
                return status(faults.startupUserStatus);
            if (body?.Name) currentUser().name = body.Name;
            return noContent();
        }
        if (lower === '/startup/remoteaccess' && method === 'POST') {
            recordWrite();
            return noContent();
        }
        if (lower === '/startup/complete' && method === 'POST') {
            recordWrite();
            current.wizardCompleted = true;
            return noContent();
        }
        if (lower === '/localization/options')
            return json([{ Name: 'English', Value: 'en-US' }]);
        if (lower === '/localization/cultures')
            return json([
                { DisplayName: 'English', TwoLetterISOLanguageName: 'en' },
                { DisplayName: 'French', TwoLetterISOLanguageName: 'fr' }
            ]);
        if (lower === '/localization/countries')
            return json([
                { DisplayName: 'United States', TwoLetterISORegionName: 'US' },
                { DisplayName: 'France', TwoLetterISORegionName: 'FR' }
            ]);
        if (lower.startsWith('/library/virtualfolders')) return json([]);
        if (lower.startsWith('/environment')) return json([]);

        // --- ordinary authentication ------------------------------------------------------------
        if (lower === '/users/authenticatebyname' && method === 'POST') {
            const body = recordWrite() as {
                Username?: string;
                Pw?: string;
            } | null;
            if (faults.authenticateStatus)
                return status(faults.authenticateStatus);
            const user =
                current.users.find((u) => u.name === body?.Username) ??
                currentUser();
            current.currentUserId = user.id;
            return json({
                User: userDto(user),
                AccessToken: ACCESS_TOKEN,
                ServerId: SERVER_ID,
                SessionInfo: { Id: 'session-1' }
            });
        }

        // --- the caller's own user --------------------------------------------------------------
        const userMatch = lower.match(/^\/users\/([^/]+)$/);
        if (lower === '/users/me' || userMatch) {
            if (!hasToken) return status(401);
            const id =
                lower === '/users/me'
                    ? current.currentUserId
                    : path.split('/')[2];
            return json(userDto(findUser(id)));
        }

        const configMatch = lower.match(/^\/users\/([^/]+)\/configuration$/);
        if (configMatch && method === 'POST') {
            if (!hasToken) return status(401);
            const body = recordWrite() as Record<string, unknown> | null;
            if (faults.configurationStatus)
                return status(faults.configurationStatus);
            // Stored verbatim. The server replaces the whole document, which is exactly why the
            // client has to send back everything it was given.
            findUser(path.split('/')[2]).configuration = body ?? {};
            return noContent();
        }

        // --- content packs ----------------------------------------------------------------------
        if (lower === '/contentpacks' && method === 'GET') {
            if (!hasToken) return status(401);
            return json(
                current.packs.map((p) => ({
                    Id: p.Id,
                    Name: p.Name,
                    Description: null,
                    VisibleItemCount: 0,
                    RepresentativeItemId: null
                }))
            );
        }
        if (lower === '/contentpacks' && method === 'POST') {
            // Tokenless first: this is the one rule the fixture enforces, and it is a claim about
            // the client, not a policy decision.
            if (!hasToken) {
                recordWrite();
                return status(401);
            }
            const body = recordWrite() as { Name?: string } | null;
            const name = body?.Name ?? '';
            if (faults.createPackStatus) return status(faults.createPackStatus);
            if (
                faults.createPackFailsOnceFor?.includes(name) &&
                !failedOnce.has(name)
            ) {
                failedOnce.add(name);
                return status(500);
            }
            const created = {
                Id: `pack-created-${current.packs.length + 1}`,
                Name: name
            };
            current.packs = [...current.packs, created];
            return json({
                ...created,
                Description: null,
                VisibleItemCount: 0,
                RepresentativeItemId: null
            });
        }

        ledger.undeclared.push(`${method} ${path}`);
        return status(501);
    });

    return state;
}
