/**
 * #153-LTV-P0 Phase 4 / Phase 0.6 runtime acceptance.
 *
 * Drives a real browser against the served bundle and the ephemeral M3U software tuner, through
 * the production remote-control path (the browser's own `serverNotifications` handlers), and
 * records ROUTE CLASSES, STATUSES and BYTE COUNTS only. No URLs, credentials, playlists or media
 * payloads are persisted.
 *
 * Sequence (the reachable defect trigger):
 *   1. play the library movie (subtitles on, SubtitleMode=Always)
 *   2. turn subtitles off      -> player data subtitleStreamIndex === -1
 *   3. queue the Live TV channel next
 *   4. advance the queue       -> the PlaybackInfo request under test
 */
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const BASE = process.env.TESSERAFIN_E2E_BASE_URL ?? 'http://127.0.0.1:8096';

const TOKEN = process.env.TESSERAFIN_E2E_TOKEN;
const MOVIE_ID = process.argv[2];
const CHANNEL_ID = process.argv[3];
const OUT = process.argv[4];
/** Section 5 of #153 asks for at least 30 s of real browser progression. */
const MIN_ADVANCE_SECONDS = Number(process.env.LTV_RIG_MIN_ADVANCE ?? '30');
const LABEL = process.argv[5] ?? 'run';
const PASSWORD = process.env.TESSERAFIN_E2E_PASSWORD ?? '';
const USERNAME = process.env.TESSERAFIN_E2E_USER ?? '';

const auth = { Authorization: `MediaBrowser Token="${TOKEN}"` };
const api = (path, init = {}) =>
    fetch(BASE + path, {
        ...init,
        headers: {
            ...auth,
            'Content-Type': 'application/json',
            ...(init.headers ?? {})
        }
    });

/**
 * Route class for a URL: the path with every id replaced by a placeholder. Deliberately lossy -
 * no ids, no query strings, no tokens - but precise enough to attribute a response to a route.
 */
function classify(url) {
    return new URL(url).pathname
        .replace(/[0-9a-f]{32}/gi, '{id}')
        .replace(
            /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
            '{id}'
        )
        .replace(/\/\d+\.ts$/i, '/{n}.ts')
        .replace(/\/[0-9a-f]{8,}\//gi, '/{hash}/');
}

const evidence = {
    label: LABEL,
    playbackInfoRequests: [],
    routes: {},
    consoleErrors: [],
    pageErrors: []
};

/**
 * #153-WEB-PUBLISH-R0: also record HOW each request was credentialed. Section 5 asks whether the
 * capability is propagated by the server and whether any durable token comes back, and a route
 * class alone cannot answer either. Only the KEY NAMES are kept — never a value.
 */
const CREDENTIAL_KEYS = [
    'playbackCapability',
    'api_key',
    'ApiKey',
    'webSocketTicket'
];

const record = (cls, status, bytes, url) => {
    const key = `${cls} ${status}`;
    if (!evidence.routes[key]) {
        evidence.routes[key] = {
            count: 0,
            bytes: 0,
            playbackCapability: 0,
            durableToken: 0
        };
    }
    const slot = evidence.routes[key];
    slot.count += 1;
    slot.bytes += bytes;
    try {
        const params = new URL(url).searchParams;
        if (params.has('playbackCapability')) slot.playbackCapability += 1;
        if (CREDENTIAL_KEYS.slice(1).some((k) => params.has(k)))
            slot.durableToken += 1;
    } catch {
        /* not a parseable url; the status still counts */
    }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(predicate, what, timeoutMs = 90000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await predicate()) return true;
        await sleep(500);
    }
    throw new Error(`timed out waiting for ${what}`);
}

const browser = await chromium.launch({
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio']
});
const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
});
const page = await context.newPage();

page.on('console', (msg) => {
    if (msg.type() === 'error')
        evidence.consoleErrors.push(msg.text().slice(0, 300));
});
page.on('pageerror', (err) =>
    evidence.pageErrors.push(String(err).slice(0, 300))
);

async function byteCountOf(response, cls) {
    try {
        const header = (await response.headerValue('content-length')) ?? null;
        if (header !== null) return Number.parseInt(header, 10) || 0;
        if (cls === 'hls-playlist' || cls === 'playbackinfo') {
            return (await response.body()).byteLength;
        }
    } catch {
        /* body no longer available; the status still counts */
    }
    return 0;
}

page.on('response', async (response) => {
    const request = response.request();
    const cls = classify(response.url());
    record(
        cls,
        response.status(),
        await byteCountOf(response, cls),
        response.url()
    );

    if (!/\/PlaybackInfo$/i.test(cls)) return;
    let requestBody = null;
    try {
        requestBody = JSON.parse(request.postData() ?? '{}');
    } catch {
        requestBody = null;
    }
    let payload = null;
    try {
        payload = await response.json();
    } catch {
        payload = null;
    }
    evidence.playbackInfoRequests.push({
        itemId: new URL(response.url()).pathname.split('/')[2] ?? null,
        // Only the source-selection fields. The DeviceProfile and every other field are omitted
        // from the record on purpose.
        sentMediaSourceId: requestBody?.MediaSourceId ?? null,
        sentSubtitleStreamIndex: requestBody?.SubtitleStreamIndex ?? null,
        status: response.status(),
        sourceCount: payload?.MediaSources?.length ?? null,
        returnedSourceIds: (payload?.MediaSources ?? []).map((s) => s.Id),
        errorCode: payload?.ErrorCode ?? null
    });
});

// --- sign in through the real login form -------------------------------------------------
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector(
    '#txtManualName, .manualLoginForm input[type=text]',
    {
        timeout: 90000
    }
);
await page.fill('#txtManualName', USERNAME);
await page.fill('#txtManualPassword', PASSWORD);
await page.click('.manualLoginForm button[type=submit]');
await waitFor(
    async () => !/\/login/i.test(new URL(page.url()).hash + page.url()),
    'sign-in to complete'
);
await sleep(4000);

// --- find this browser's session ----------------------------------------------------------
let sessionId = null;
await waitFor(async () => {
    const sessions = await (await api('/Sessions')).json();
    const match = sessions.find(
        (s) => s.SupportedCommands?.length && s.Client && /web/i.test(s.Client)
    );
    if (match) sessionId = match.Id;
    return Boolean(sessionId);
}, 'the browser session to register');

const command = (name, args = {}) =>
    api(`/Sessions/${sessionId}/Command`, {
        method: 'POST',
        body: JSON.stringify({ Name: name, Arguments: args })
    });

// --- 1. play the movie --------------------------------------------------------------------
await api(
    `/Sessions/${sessionId}/Playing?playCommand=PlayNow&itemIds=${MOVIE_ID}`,
    { method: 'POST' }
);
await waitFor(
    () => evidence.playbackInfoRequests.some((r) => r.itemId === MOVIE_ID),
    'the movie PlaybackInfo request'
);
await waitFor(async () => {
    const sessions = await (await api('/Sessions')).json();
    const mine = sessions.find((s) => s.Id === sessionId);
    return mine?.NowPlayingItem?.Id === MOVIE_ID;
}, 'the movie to be reported as now playing');
await sleep(6000);

// --- 2. turn subtitles off ----------------------------------------------------------------
await command('SetSubtitleStreamIndex', { Index: '-1' });
await sleep(6000);

// --- 3. queue the channel next, 4. advance ------------------------------------------------
await api(
    `/Sessions/${sessionId}/Playing?playCommand=PlayNext&itemIds=${CHANNEL_ID}`,
    { method: 'POST' }
);
await sleep(3000);
await api(`/Sessions/${sessionId}/Playing/NextTrack`, { method: 'POST' });

await waitFor(
    () => evidence.playbackInfoRequests.some((r) => r.itemId === CHANNEL_ID),
    'the channel PlaybackInfo request'
);

// --- let real playback run so segments are actually fetched --------------------------------
await sleep(25000);

evidence.playbackAdvanced = await page.evaluate(async () => {
    const video = document.querySelector('video');
    if (!video) return { present: false };
    const first = video.currentTime;
    const samples = [];
    // #153-WEB-PUBLISH-R0: section 5 asks for >= 30 s of REAL browser progression, so this samples
    // for 45 s of wall clock instead of taking a single 6 s delta. `advancedSeconds` is the media
    // time actually covered, which is what "playback visibly advances" has to mean.
    for (let i = 0; i < 45; i += 1) {
        await new Promise((r) => setTimeout(r, 1000));
        samples.push(
            Number(document.querySelector('video')?.currentTime ?? -1)
        );
    }
    const last = samples[samples.length - 1];
    return {
        present: true,
        first,
        last,
        advanced: last > first,
        advancedSeconds: last - first,
        samples
    };
});

const sessions = await (await api('/Sessions')).json();
const mine = sessions.find((s) => s.Id === sessionId);
evidence.finalNowPlayingItemId = mine?.NowPlayingItem?.Id ?? null;
evidence.finalNowPlayingType = mine?.NowPlayingItem?.Type ?? null;

await api(`/Sessions/${sessionId}/Playing/Stop`, { method: 'POST' }).catch(
    () => undefined
);
await sleep(3000);
await browser.close();

/**
 * PROJECTION, not serialisation.
 *
 * Everything in `evidence` is derived from a network response — route classes from response urls,
 * source ids and error codes from response bodies, console text from the browser — and this is the
 * one place any of it would reach the filesystem. Hosted CodeQL was right to flag the naive write
 * (`js/http-to-file-access`, "write to file system depends on untrusted data"), and a character
 * filter did not answer it: filtered response bytes are still response bytes.
 *
 * So the ledger is not a filtered copy of `evidence`. It is REBUILT from this module's own
 * constants: every string below is either a literal declared here or a number. A response value
 * can select which literal is emitted; it is never itself emitted. That makes the header's promise
 * — no url, no credential, no playlist, no media payload — a property of the writer rather than of
 * how carefully each recording site was written.
 *
 * The gate is unaffected: it asserts against `evidence` in memory, before this runs.
 */
const ROUTE_CLASSES = [
    ['hls-master', /master\.m3u8$/],
    ['hls-live-playlist', /live\.m3u8$/],
    ['hls-playlist', /\.m3u8$/],
    // Order matters: a direct-play url ends in .mp4 too, so it has to be claimed before the
    // segment rule, and the segment rule is anchored on the /hls/ path the server actually emits.
    ['direct-stream', /\/Videos\/[^/]+\/stream/i],
    ['hls-segment', /\/hls\d*\/.*\.(ts|mp4|m4s)$/],
    ['playback-info', /PlaybackInfo$/],
    ['live-stream-media-info', /LiveStreams\/MediaInfo$/],
    ['subtitle', /Subtitles/],
    ['trickplay', /Trickplay/],
    ['attachment', /Attachments/],
    ['font', /FallbackFont/],
    ['session', /\/Sessions/],
    ['web-asset', /^\/web\//],
    ['item', /\/Items|\/Users/],
    ['system', /\/System|\/Branding|\/QuickConnect|\/SyncPlay/]
];

const ERROR_CODES = ['NoCompatibleStream', 'NotAllowed', 'RateLimitExceeded'];

const CONSOLE_CATEGORIES = [
    ['resource-load-failed', /Failed to load resource/i],
    ['hls-error', /HLS Error/i],
    ['websocket', /WebSocket/i],
    ['player-null', /player cannot be null/i]
];

/** The literal for whichever class matches, or our own fallback. Never the input. */
function routeClassOf(text) {
    for (const [name, pattern] of ROUTE_CLASSES) {
        if (pattern.test(text)) return name;
    }
    return 'other';
}

function categoriseMessages(messages) {
    const counts = { total: messages.length };
    for (const [name] of CONSOLE_CATEGORIES) counts[name] = 0;
    counts.uncategorised = 0;
    for (const message of messages) {
        const hit = CONSOLE_CATEGORIES.find(([, pattern]) =>
            pattern.test(message)
        );
        if (hit) counts[hit[0]] += 1;
        else counts.uncategorised += 1;
    }
    return counts;
}

/**
 * Ids are replaced by a per-run ordinal. `known` maps the two ids this run was told to drive (the
 * movie and the channel) onto their own names, so the interesting relation — "the returned source
 * id is NOT the channel item id" — survives without the id itself being written.
 */
function idNamer() {
    const known = new Map([
        [MOVIE_ID, 'movie-item'],
        [CHANNEL_ID, 'channel-item']
    ]);
    const seen = new Map();
    return (value) => {
        if (value === null || value === undefined) return null;
        const key = String(value);
        const name = known.get(key);
        if (name) return name;
        if (!seen.has(key)) seen.set(key, `other-id-${seen.size + 1}`);
        return seen.get(key);
    };
}

function projectEvidence(source) {
    const nameOf = idNamer();
    const routes = {};
    for (const [key, value] of Object.entries(source.routes)) {
        const cut = key.lastIndexOf(' ');
        const status = Number.parseInt(key.slice(cut + 1), 10) || 0;
        const projected = `${routeClassOf(key.slice(0, cut))} ${status}`;
        if (!routes[projected]) {
            routes[projected] = {
                count: 0,
                bytes: 0,
                playbackCapability: 0,
                durableToken: 0
            };
        }
        routes[projected].count += value.count;
        routes[projected].bytes += value.bytes;
        routes[projected].playbackCapability += value.playbackCapability;
        routes[projected].durableToken += value.durableToken;
    }

    return {
        label: LABEL,
        routes,
        playbackInfoRequests: source.playbackInfoRequests.map((request) => ({
            item: nameOf(request.itemId),
            sentMediaSourceId: nameOf(request.sentMediaSourceId),
            sentMediaSourceIdPresent:
                request.sentMediaSourceId !== null &&
                request.sentMediaSourceId !== undefined,
            sentSubtitleStreamIndex:
                typeof request.sentSubtitleStreamIndex === 'number'
                    ? request.sentSubtitleStreamIndex
                    : null,
            status: Number(request.status) || 0,
            sourceCount:
                typeof request.sourceCount === 'number'
                    ? request.sourceCount
                    : null,
            returnedSourceIds: (request.returnedSourceIds ?? []).map(nameOf),
            errorCode: request.errorCode
                ? (ERROR_CODES.find((code) => code === request.errorCode) ??
                  'other')
                : null
        })),
        playbackAdvanced: source.playbackAdvanced
            ? {
                  present: Boolean(source.playbackAdvanced.present),
                  first: Number(source.playbackAdvanced.first) || 0,
                  last: Number(source.playbackAdvanced.last) || 0,
                  advanced: Boolean(source.playbackAdvanced.advanced),
                  advancedSeconds:
                      Number(source.playbackAdvanced.advancedSeconds) || 0,
                  sampleCount: (source.playbackAdvanced.samples ?? []).length
              }
            : null,
        finalNowPlaying: nameOf(source.finalNowPlayingItemId),
        finalNowPlayingIsChannel: source.finalNowPlayingItemId === CHANNEL_ID,
        consoleErrors: categoriseMessages(source.consoleErrors),
        pageErrors: categoriseMessages(source.pageErrors)
    };
}

writeFileSync(OUT, JSON.stringify(projectEvidence(evidence), null, 2));
console.log('ACCEPTANCE_WRITTEN ' + OUT);

// --- runtime gate ---------------------------------------------------------------------------
// Two properties, both asserted hard so that removing either is a detectable mutation rather than
// a no-op:
//
//   1. SOURCE SELECTION. The browser must not send a Live TV channel's placeholder MediaSourceId,
//      and the server must answer with a real tuner source rather than NoCompatibleStream.
//
//   2. DELIVERY. The channel must actually play: a live playlist, real fragment BYTES, and the
//      <video> element's own currentTime advancing. An earlier revision could only assert (1),
//      because the server then in use blocked every Live TV transcode and no <video> ever reached
//      a live source; asserting delivery is what stops that regressing back silently.
if (process.env.LTV_RIG_ASSERT === '1') {
    const failures = [];
    const channel = evidence.playbackInfoRequests.filter(
        (r) => r.itemId === CHANNEL_ID
    );
    if (channel.length === 0) {
        failures.push('no channel PlaybackInfo request was observed');
    }
    const first = channel[0];
    if (first) {
        if (first.sentMediaSourceId === CHANNEL_ID) {
            failures.push(
                'source-selection: the browser sent the channel item id as MediaSourceId'
            );
        }
        if (first.errorCode) {
            failures.push(
                `source-selection: channel PlaybackInfo returned ErrorCode ${first.errorCode}`
            );
        }
        if (!(first.sourceCount >= 1)) {
            failures.push(
                `source-selection: channel PlaybackInfo returned ${first.sourceCount} sources`
            );
        }
        if (first.returnedSourceIds[0] === CHANNEL_ID) {
            failures.push(
                'source-selection: the returned source id is the channel item id, not a tuner id'
            );
        }
    }
    // Delivery. Byte counts come from content-length, so a 200 with an empty body cannot pass.
    const routeTotal = (predicate) =>
        Object.entries(evidence.routes)
            .filter(([key]) => predicate(key))
            .reduce(
                (acc, [, value]) => ({
                    count: acc.count + value.count,
                    bytes: acc.bytes + value.bytes,
                    capability: acc.capability + value.playbackCapability,
                    durable: acc.durable + value.durableToken
                }),
                { count: 0, bytes: 0, capability: 0, durable: 0 }
            );

    const playlist = routeTotal((key) => /live\.m3u8 200$/.test(key));
    if (playlist.count === 0 || playlist.bytes === 0) {
        failures.push(
            `delivery: no live playlist with bytes (count ${playlist.count}, bytes ${playlist.bytes})`
        );
    }

    const fragments = routeTotal((key) => /\.ts 200$/.test(key));
    if (fragments.count === 0 || fragments.bytes === 0) {
        failures.push(
            `delivery: no live fragment carried bytes (count ${fragments.count}, bytes ${fragments.bytes})`
        );
    }
    if (fragments.count > 0 && fragments.capability < fragments.count) {
        failures.push(
            `delivery: ${fragments.count - fragments.capability} fragment(s) carried no playbackCapability`
        );
    }

    // Any durable credential anywhere in the run is a failure, not just on the media routes.
    const durable = routeTotal(() => true).durable;
    if (durable > 0) {
        failures.push(
            `credential: ${durable} request(s) carried a durable token`
        );
    }

    const advancedSeconds = evidence.playbackAdvanced?.advancedSeconds ?? 0;
    if (advancedSeconds < MIN_ADVANCE_SECONDS) {
        failures.push(
            `delivery: playback advanced ${advancedSeconds.toFixed(3)} s, needs >= ${MIN_ADVANCE_SECONDS} s`
        );
    }
    if (failures.length) {
        console.error('ACCEPTANCE_FAILED\n  ' + failures.join('\n  '));
        process.exit(1);
    }
    console.log('ACCEPTANCE_PASSED');
}
