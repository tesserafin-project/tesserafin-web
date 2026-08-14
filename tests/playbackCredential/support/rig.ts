/**
 * Rig helpers for the production playback-credential probe (S4).
 *
 * The rig is `ci/serve-e2e.sh` in the server repository: a real Tesserafin server bound to a real
 * TCP port, serving a real production web bundle through `--webdir`, with ffmpeg-synthesized media
 * in a real library. Nothing here mocks a server, a decision or a media byte.
 *
 * Sign-in, detail navigation and player opening are reused from `tests/e2e/support/b2.ts` rather
 * than re-implemented, so what this probe measures is the flow the rest of the real-server suite
 * drives.
 *
 * NOTHING HERE RETURNS A CREDENTIAL. `sessionToken` is read into memory so the probe can compare
 * console payloads against it; it is never printed, asserted on by value, or written to a file.
 */
import {
    expect,
    request,
    type APIRequestContext,
    type Page
} from '@playwright/test';

import {
    AUTH_HEADER,
    BASE_URL,
    PASSWORD,
    searchResultCard,
    USER
} from '../../e2e/support/b2';

/** The transcode fixture `ci/serve-e2e.sh` seeds: MPEG-4 Part 2 video + AC-3 audio. */
export const TRANSCODE_TITLE = 'Transcode Probe';

export interface Admin {
    api: APIRequestContext;
    token: string;
    userId: string;
    dispose: () => Promise<void>;
}

/** Authenticate as the rig's admin through the ordinary public API. */
export async function admin(): Promise<Admin> {
    const api = await request.newContext({ baseURL: BASE_URL });
    const auth = await api.post('/Users/AuthenticateByName', {
        headers: { Authorization: AUTH_HEADER },
        data: { Username: USER, Pw: PASSWORD }
    });
    expect(auth.ok(), 'the rig admin must authenticate').toBe(true);
    const body = await auth.json();
    return {
        api,
        token: String(body.AccessToken),
        userId: String(body.User.Id),
        dispose: () => api.dispose()
    };
}

function authed(a: Admin) {
    return { Authorization: `${AUTH_HEADER}, Token="${a.token}"` };
}

/** Resolve an item by NAME, never by a captured id: every rig boot re-seeds fresh guids. */
export async function itemIdByName(a: Admin, name: string): Promise<string> {
    const res = await a.api.get(`/Users/${a.userId}/Items`, {
        headers: authed(a),
        params: { searchTerm: name, recursive: 'true', limit: '10' }
    });
    expect(res.ok(), `item lookup for ${name}`).toBe(true);
    const items = (await res.json()).Items as Array<{
        Id: string;
        Name: string;
    }>;
    const match = items.find((i) => i.Name.includes(name));
    expect(match, `the rig must have seeded "${name}"`).toBeTruthy();
    return match!.Id;
}

export interface SessionFacts {
    playMethod: string | null;
    transcodingReasons: string[];
    hasTranscodingInfo: boolean;
    nowPlayingName: string | null;
}

/**
 * What the SERVER says about the live playback, which is the only authority on Direct Play versus
 * transcode. A requested URL is not evidence: the client asks, the server decides.
 */
export async function sessionFacts(
    a: Admin,
    itemName: string
): Promise<SessionFacts> {
    const res = await a.api.get('/Sessions', { headers: authed(a) });
    expect(res.ok(), 'sessions lookup').toBe(true);
    const sessions = (await res.json()) as Array<{
        NowPlayingItem?: { Name?: string };
        PlayState?: { PlayMethod?: string };
        TranscodingInfo?: { TranscodeReasons?: string[] };
    }>;
    const session = sessions.find((s) =>
        s.NowPlayingItem?.Name?.includes(itemName)
    );
    return {
        playMethod: session?.PlayState?.PlayMethod ?? null,
        transcodingReasons: session?.TranscodingInfo?.TranscodeReasons ?? [],
        hasTranscodingInfo: Boolean(session?.TranscodingInfo),
        nowPlayingName: session?.NowPlayingItem?.Name ?? null
    };
}

/** Open an item's detail page by searching for it, the way a person reaches it. */
export async function openDetailByName(
    page: Page,
    title: string
): Promise<void> {
    await page
        .getByRole('link', { name: /search|recherche/i })
        .or(page.getByRole('button', { name: /search|recherche/i }))
        .first()
        .click();
    await page.waitForURL('**/#/search**', { timeout: 15_000 });
    const field = page.locator('.searchFields input:visible').first();
    await expect(field).toBeVisible({ timeout: 15_000 });
    await field.fill(title);
    // The shell's own result card, whichever shell is live - see b2.searchResultCard for why it is
    // activated with focus+Enter rather than a click.
    const card = searchResultCard(page);
    await expect(card, `"${title}" must be findable`).toBeVisible({
        timeout: 25_000
    });
    await card.focus();
    await card.press('Enter');
    await page.waitForURL('**/#/details?id=**', { timeout: 25_000 });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
        timeout: 25_000
    });
}

export interface MediaBytes {
    requests: number;
    bytes: number;
    transcodeUrls: number;
}

/**
 * Count the media the BROWSER actually pulled.
 *
 * `/Videos/{id}/stream` is the direct path and `master.m3u8` / `hls1/` / `/Videos/{id}/live.m3u8`
 * are the transcoding paths, so the shape of what was fetched corroborates the server's own
 * decision instead of standing in for it.
 */
export function watchMedia(page: Page): () => MediaBytes {
    let requests = 0;
    let bytes = 0;
    let transcodeUrls = 0;
    page.on('response', (response) => {
        const url = response.url();
        if (!/\/Videos\/|\/Audio\/|hls1\/|master\.m3u8|main\.m3u8/i.test(url))
            return;
        requests += 1;
        if (/master\.m3u8|hls1\/|main\.m3u8|\/live\.m3u8/i.test(url))
            transcodeUrls += 1;
        const length = Number(response.headers()['content-length'] ?? 0);
        if (Number.isFinite(length)) bytes += length;
    });
    return () => ({ requests, bytes, transcodeUrls });
}

/**
 * The detail page's play control, in whichever shell rendered it.
 *
 * The modern details route renders `[data-detail-action='btnPlay']` (DetailActionBar.tsx); the
 * legacy view renders `.mainDetailButtons .btnPlay`. Matching only the legacy one made the player
 * flows time out on a perfectly healthy modern detail page.
 */
export function playControl(page: Page) {
    return page
        .locator("[data-detail-action='btnPlay']:visible")
        .or(page.locator('.mainDetailButtons .btnPlay:visible'))
        .first();
}

/** Wait until the <video> element has actually advanced past `seconds`. */
export async function expectPlaybackAdvances(
    page: Page,
    seconds = 0.2
): Promise<number> {
    const reached = await page.waitForFunction(
        (min) => {
            const video = document.querySelector('video');
            return video && video.currentTime > min ? video.currentTime : false;
        },
        seconds,
        { timeout: 30_000 }
    );
    return Number(await reached.jsonValue());
}

/**
 * The BROWSER session's own access token, read from the credentials the app stores.
 *
 * Returned so the probe can compare in memory. Callers must never print it, and the probe's
 * assertions are on counts and booleans only.
 */
export async function sessionToken(page: Page): Promise<string> {
    return page.evaluate(() => {
        const raw = localStorage.getItem('jellyfin_credentials');
        const parsed = raw ? JSON.parse(raw) : null;
        return (
            (parsed?.Servers ?? []).find(
                (server: { AccessToken?: string }) => server?.AccessToken
            )?.AccessToken ?? ''
        );
    });
}

/**
 * Count console entries that carry the session credential, without keeping any payload.
 *
 * The counter closes over the token and answers with numbers only, so a failing assertion can never
 * print what leaked - the failure message says how many entries matched and which console level.
 */
export interface DisclosureCounter {
    total: () => number;
    byLevel: () => Record<string, number>;
}

export function watchDisclosure(page: Page, token: string): DisclosureCounter {
    const byLevel: Record<string, number> = {};
    let total = 0;
    const needles = [token, 'ApiKey=', 'api_key='].filter(Boolean);
    page.on('console', (message) => {
        const text = message.text();
        if (needles.some((needle) => text.includes(needle))) {
            total += 1;
            byLevel[message.type()] = (byLevel[message.type()] ?? 0) + 1;
        }
    });
    return { total: () => total, byLevel: () => ({ ...byLevel }) };
}
