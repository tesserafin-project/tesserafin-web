import { expect, request, test } from '@playwright/test';

/**
 * Playback v2 (PR #26, `fix/playback-v2-descriptor-consumption`) — REAL browser E2E.
 *
 * What this file proves, and what it deliberately does not:
 *  - It drives the actual UI (`button.btnPlay` on `/#/details`) against a real server booted by
 *    `reefin/ci/serve-e2e.sh`, and asserts on ACTUAL network traffic captured through
 *    `page.on('request'|'response')`. Nothing here is asserted by reading client source.
 *  - The v2 flag (`appSettings.enableV2PlaybackPath()`, plain `localStorage`) is turned ON
 *    in-browser per test via `addInitScript`. The source default (OFF) is never modified.
 *
 * There is NO `page.route` request-body rewriting anywhere in this file, by design — the same
 * discipline `playback-attempt-id-contract.spec.ts` and `playback-capabilities-contract.spec.ts`
 * document for themselves. The bytes asserted on are the bytes the real, unpatched bundle put on
 * the wire; a test that rewrites the request it then asserts about proves only its own injection.
 *
 * Formerly this file carried a KNOWN BLOCKER: `reefinPlaybackCapabilities.ts` emitted
 * `VideoCodecs: [{Codec}]` while the server's `Reefin.Playback.Decision/VideoCodecCapability` is a
 * positional record whose `Profiles`/`VideoRangeTypes` members are non-nullable, so every
 * `POST /Playback/Sessions` from the real client was rejected `400` and the v2 SUCCESS path was
 * unreachable without patching the outgoing body. That blocker is GONE: the builder now emits
 * `Profiles: []` and `VideoRangeTypes: ['SDR']` on every video codec entry
 * (`src/scripts/reefinPlaybackCapabilities.ts`), so the unmodified client creates a v2 session on
 * its own and #26's descriptor consumption executes end-to-end with no patching at all.
 */

const USER = process.env.REEFIN_E2E_USER ?? 'smokeadmin';
const PASSWORD = process.env.REEFIN_E2E_PASSWORD ?? 'smokepass123';
const BASE_URL = process.env.REEFIN_E2E_BASE_URL ?? 'http://localhost:8096';

const E2E_AUTH_HEADER =
    'MediaBrowser Client="Reefin Web E2E", Device="Playwright", DeviceId="reefin-e2e-playback-v2", Version="0.0.0"';

/** The lazily-loaded chunk `playbackSessionV2UrlTrigger.ts` reaches for ONLY when the flag is on.
 * Its presence/absence in the captured traffic is the positive/negative control that the flag was
 * genuinely in effect — independent of anything the client logs. */
const V2_CHUNK = /playback-v2-url\.[a-f0-9]+\.chunk\.js/i;
const V2_SESSIONS = /\/Playback\/Sessions(\?|$)/i;
const V2_STREAM = /\/Playback\/Sessions\/[^/]+\/Stream/i;
/** The legacy server-built delivery URL shape. */
const LEGACY_STREAM = /\/Videos\/[^/]+\/(stream|master|main)\./i;

interface Wire {
    requests: { method: string; url: string; postData: string | null }[];
    responses: { status: number; url: string; contentType: string }[];
}

function instrument(page: import('@playwright/test').Page): Wire {
    const wire: Wire = { requests: [], responses: [] };
    page.on('request', (r) =>
        wire.requests.push({
            method: r.method(),
            url: r.url(),
            postData: r.postData()
        })
    );
    page.on('response', (r) =>
        wire.responses.push({
            status: r.status(),
            url: r.url(),
            contentType: r.headers()['content-type'] ?? ''
        })
    );
    return wire;
}

async function resolveFirstMovieId(): Promise<string> {
    const api = await request.newContext({ baseURL: BASE_URL });
    const auth = await (
        await api.post('/Users/AuthenticateByName', {
            headers: { Authorization: E2E_AUTH_HEADER },
            data: { Username: USER, Pw: PASSWORD }
        })
    ).json();
    const items = await (
        await api.get('/Items', {
            params: {
                userId: auth.User.Id,
                recursive: 'true',
                includeItemTypes: 'Movie'
            },
            headers: {
                Authorization: `${E2E_AUTH_HEADER}, Token="${auth.AccessToken}"`
            }
        })
    ).json();
    const id = items.Items?.[0]?.Id;
    if (!id) throw new Error('no movie fixture found on the server');
    await api.dispose();
    return String(id);
}

/** Resolves a fixture by NAME across every video-bearing library, not just `movies`.
 *
 * The remux fixture ("Remux Probe (2022)") is a `Video` in the `homevideos` library "Codec Probes",
 * NOT a `Movie` — `reefin/ci/serve-e2e.sh` puts it there deliberately, because `library.spec.ts`
 * asserts `toHaveCount(2)` on the movies grid in four places and indexes cards positionally, so a
 * third movie would break healthy specs. `resolveFirstMovieId()` therefore cannot reach it, which
 * is why the real MKV had no client-side coverage at all before this. */
async function resolveItemIdByName(name: string): Promise<string> {
    const api = await request.newContext({ baseURL: BASE_URL });
    const auth = await (
        await api.post('/Users/AuthenticateByName', {
            headers: { Authorization: E2E_AUTH_HEADER },
            data: { Username: USER, Pw: PASSWORD }
        })
    ).json();
    const items = await (
        await api.get('/Items', {
            params: {
                userId: auth.User.Id,
                recursive: 'true',
                includeItemTypes: 'Movie,Video'
            },
            headers: {
                Authorization: `${E2E_AUTH_HEADER}, Token="${auth.AccessToken}"`
            }
        })
    ).json();
    const match = (items.Items ?? []).find(
        (i: { Name: string }) => i.Name === name
    );
    await api.dispose();
    if (!match) {
        throw new Error(`fixture "${name}" not found on the server`);
    }
    return String(match.Id);
}

async function signInAndPlay(
    page: import('@playwright/test').Page,
    itemId: string
) {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    if (page.url().includes('/login')) {
        await page.locator('#txtManualName:visible').fill(USER);
        await page.locator('#txtManualPassword:visible').fill(PASSWORD);
        await page.locator('button[type="submit"]:visible').first().click();
        await page.waitForURL('**/#/home**', { timeout: 20_000 });
    }
    await page.waitForLoadState('networkidle');

    await page.goto(`/#/details?id=${itemId}`);
    await page.waitForLoadState('networkidle');
    const play = page
        .locator('button.btnPlay:visible, button[title*="Play" i]:visible')
        .first();
    await expect(play).toBeVisible({ timeout: 20_000 });
    await play.click();
}

/** The v2 EXECUTION engine is kill-switched off by default (`PlaybackLiveStreamResolver` falls back
 * to legacy with `FallbackReason: "KillSwitch"` unless `PlaybackShadow.GetEffectiveMode()` is
 * Canary/V2). Flipped here through the real admin API — server runtime configuration, not a source
 * default, and unrelated to the client's own `enableV2PlaybackPath` flag.
 *
 * This writes PERSISTENT server state, so every test whose outcome depends on the engine mode must
 * set the mode it needs rather than inheriting whatever an earlier test left behind.
 *
 * THE VALUE MATTERS. `Reefin.Model/Configuration/PlaybackEngineMode.cs` declares exactly four
 * members — `Legacy | Shadow | Canary | V2`. There is NO `Off`. An earlier revision of this file
 * posted `Mode: 'Off'`, which fails ASP.NET enum binding, so `POST /System/Configuration` answered
 * `400`, this helper threw, and the kill-switch test below never exercised a kill switch at all —
 * it failed in its own setup. `Legacy` is the correct kill switch: `PlaybackLiveStreamResolver.cs`
 * gates on `effectiveMode is not (Canary or V2)`, so `Legacy` takes the `KillSwitch` branch on the
 * very next request. The readback below makes a silently-ignored write impossible to mistake for a
 * successful one. */
async function setV2EngineMode(mode: 'V2' | 'Legacy') {
    const api = await request.newContext({ baseURL: BASE_URL });
    const auth = await (
        await api.post('/Users/AuthenticateByName', {
            headers: { Authorization: E2E_AUTH_HEADER },
            data: { Username: USER, Pw: PASSWORD }
        })
    ).json();
    const token = `${E2E_AUTH_HEADER}, Token="${auth.AccessToken}"`;
    const cfg = await (
        await api.get('/System/Configuration', {
            headers: { Authorization: token }
        })
    ).json();
    cfg.PlaybackShadow = { ...(cfg.PlaybackShadow ?? {}), Mode: mode };
    const posted = await api.post('/System/Configuration', {
        headers: { Authorization: token },
        data: cfg
    });
    if (!posted.ok()) {
        throw new Error(
            `could not set the v2 engine mode to ${mode}: ${posted.status()} ${(
                await posted.text()
            ).slice(0, 300)}`
        );
    }

    // Read it back. A 2xx on the config POST is not proof the value was persisted as asked, and a
    // mode that silently stayed put would make every assertion downstream describe the wrong path.
    const verify = await (
        await api.get('/System/Configuration', {
            headers: { Authorization: token }
        })
    ).json();
    expect(
        verify.PlaybackShadow?.Mode,
        `engine mode did not persist as ${mode}`
    ).toBe(mode);
    await api.dispose();
}

const enableV2Engine = () => setV2EngineMode('V2');
const disableV2Engine = () => setV2EngineMode('Legacy');

test.describe('playback v2 — flag ON', () => {
    let itemId = '';
    test.beforeAll(async () => {
        itemId = await resolveFirstMovieId();
    });

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() =>
            localStorage.setItem('enableV2PlaybackPath', 'true')
        );
    });

    test('the v2 path is genuinely entered: lazy chunk fetched and POST Playback/Sessions issued', async ({
        page
    }) => {
        test.setTimeout(120_000);
        const wire = instrument(page);
        await signInAndPlay(page, itemId);

        // Anti-vacuity: the flag must still be on at the moment playback is triggered. If login had
        // cleared localStorage, every assertion below would be about the legacy path instead.
        await expect
            .poll(() =>
                page.evaluate(() =>
                    localStorage.getItem('enableV2PlaybackPath')
                )
            )
            .toBe('true');

        // Positive control that the flag actually took effect in the bundle: the dedicated chunk is
        // only requested from behind the `isEnabled()` check in playbackSessionV2UrlTrigger.ts.
        await expect
            .poll(
                () => wire.requests.filter((r) => V2_CHUNK.test(r.url)).length,
                { timeout: 30_000 }
            )
            .toBeGreaterThan(0);

        // Requirement 1 (first half): a real POST to Playback/Sessions happens on the wire.
        await expect
            .poll(
                () =>
                    wire.requests.filter(
                        (r) => r.method === 'POST' && V2_SESSIONS.test(r.url)
                    ).length,
                { timeout: 30_000 }
            )
            .toBeGreaterThan(0);

        // …and it is the REAL v2 path, not the shadow one: the real path generates and sends a
        // PlaySessionId (docs/pr116d-url-contract-design.md §2.3).
        const post = wire.requests.find(
            (r) => r.method === 'POST' && V2_SESSIONS.test(r.url)
        )!;
        expect(post.postData).toBeTruthy();
        expect(JSON.parse(post.postData!).PlaySessionId).toBeTruthy();
    });

    test('the UNPATCHED client body is accepted 200 and the descriptor is fetched and played', async ({
        page
    }) => {
        test.setTimeout(120_000);

        // NO `page.route`, and that absence is the whole point of this test. The outgoing
        // `POST /Playback/Sessions` body is exactly what the real bundle produced; it is captured
        // through `page.on('request')` in `instrument()` — pure observation, never mutation — and
        // asserted on below. An earlier revision rewrote this body to inject
        // `Profiles`/`VideoRangeTypes` before letting it through, which made the test prove only
        // its own injection. The builder now emits both fields itself, so nothing needs patching.
        await enableV2Engine();

        const wire = instrument(page);
        let descriptor: Record<string, unknown> | null = null;
        page.on('response', async (r) => {
            if (V2_STREAM.test(r.url()) && r.status() === 200) {
                try {
                    descriptor = await r.json();
                } catch {
                    /* not json */
                }
            }
        });

        await signInAndPlay(page, itemId);

        // Requirement 1, second half — now reachable THROUGH THE CLIENT. This endpoint exists only
        // on the v2 path, so a request to it is itself the proof that v2 was used.
        await expect
            .poll(
                () => wire.requests.filter((r) => V2_STREAM.test(r.url)).length,
                { timeout: 30_000 }
            )
            .toBeGreaterThan(0);

        // The body the REAL client produced, read back off the wire and never modified. These two
        // fields are the ones the server's positional `VideoCodecCapability` record requires; the
        // assertion is what makes this test a genuine contract check on
        // `reefinPlaybackCapabilities.ts` rather than on a test-side injection.
        const post = wire.requests.find(
            (r) => r.method === 'POST' && V2_SESSIONS.test(r.url)
        )!;
        expect(post, 'no POST Playback/Sessions was captured').toBeTruthy();
        expect(post.postData).toBeTruthy();
        const videoCodecs = JSON.parse(post.postData!)?.Capabilities?.Decode
            ?.VideoCodecs as
            | {
                  Codec: string;
                  Profiles?: string[];
                  VideoRangeTypes?: string[];
              }[]
            | undefined;
        expect(
            videoCodecs?.length,
            'client sent no VideoCodecs'
        ).toBeGreaterThan(0);
        for (const vc of videoCodecs!) {
            expect(vc.Profiles, `codec ${vc.Codec} Profiles`).toEqual([]);
            expect(
                vc.VideoRangeTypes,
                `codec ${vc.Codec} VideoRangeTypes`
            ).toEqual(['SDR']);
        }

        // EXACTLY 200 — not "not 4xx", not "ok". Every response the collection endpoint produced in
        // this run must be a 200, so a single stray 400 fails the test instead of being masked by a
        // later success.
        await expect
            .poll(
                () =>
                    wire.responses.filter((r) => V2_SESSIONS.test(r.url))
                        .length,
                { timeout: 30_000 }
            )
            .toBeGreaterThan(0);

        for (const sessionResponse of wire.responses.filter((r) =>
            V2_SESSIONS.test(r.url)
        )) {
            expect(
                sessionResponse.status,
                `POST ${sessionResponse.url} status`
            ).toBe(200);
        }

        await expect.poll(() => descriptor, { timeout: 30_000 }).toBeTruthy();
        const d = descriptor as unknown as Record<string, string>;

        // The descriptor must be a complete execution state, else #26 deliberately keeps legacy.
        expect(d.Url, 'descriptor carried no Url').toBeTruthy();
        expect(d.MimeType, 'descriptor carried no MimeType').toBeTruthy();
        expect(
            d.FallbackReason,
            `v2 did not serve this (${d.FallbackReason})`
        ).toBeFalsy();

        // Requirement 2 through the client: the media the player actually requested is the URL the
        // descriptor handed out, and the bytes served carry the MimeType the descriptor promised.
        const descriptorPath = String(d.Url).split('?')[0];
        await expect
            .poll(
                () =>
                    wire.responses.filter(
                        (r) =>
                            r.url.includes(descriptorPath) &&
                            (r.status === 200 || r.status === 206)
                    ).length,
                { timeout: 30_000 }
            )
            .toBeGreaterThan(0);

        const played = wire.responses.find(
            (r) =>
                r.url.includes(descriptorPath) &&
                (r.status === 200 || r.status === 206)
        )!;
        expect(played.contentType.split(';')[0].trim().toLowerCase()).toBe(
            String(d.MimeType).toLowerCase()
        );

        // Requirement 3: no legacy playback parameters are parsed out of the URL by the client —
        // the v2 URL carries none of the params the pre-#26 retry heuristics string-matched.
        expect(played.url.toLowerCase()).not.toContain('transcodereasons');
        expect(played.url.toLowerCase()).not.toContain('allowvideostreamcopy');
        expect(played.url.toLowerCase()).not.toContain('allowaudiostreamcopy');

        // Requirement 4: no mixed state. NOTE the v2 descriptor Url has the SAME path shape as the
        // legacy delivery URL (`/videos/{id}/stream.mp4?...`), so "a LEGACY_STREAM-shaped URL was
        // fetched" proves nothing on its own. The real invariant is that EVERY media delivery the
        // player performed was the descriptor's own Url - i.e. no second, legacy-built URL was
        // fetched alongside the v2 one.
        const mediaFetches = wire.responses.filter(
            (r) =>
                LEGACY_STREAM.test(r.url) &&
                (r.status === 200 || r.status === 206)
        );
        expect(mediaFetches.length).toBeGreaterThan(0);
        for (const m of mediaFetches) {
            expect(
                m.url,
                'a media URL other than the v2 descriptor Url was played - v2/legacy mixed state'
            ).toContain(descriptorPath);
        }

        // The v2 URL is also the one carrying the descriptor's own PlaySessionId, not a legacy one.
        expect(played.url).toContain('PlaySessionId=');
    });

    test('when the server engine is kill-switched off, playback falls back to a PURELY legacy stream (no mixed state)', async ({
        page
    }) => {
        test.setTimeout(120_000);

        // The fallback must be FORCED, explicitly. This test used to get its fallback for free from
        // the capability-contract `400` — the client could not create a session at all, so legacy
        // was the only outcome. Now that the client emits `Profiles`/`VideoRangeTypes` and the
        // server accepts the body, that free fallback is gone: without this line the test would
        // inherit `Mode: 'V2'` from the preceding test and v2 would genuinely serve the media.
        // The server kill switch is the documented fallback mechanism
        // (`FallbackReason: "KillSwitch"`), exercised through the real admin API — no request-body
        // rewriting.
        await disableV2Engine();

        const wire = instrument(page);
        let descriptor: Record<string, unknown> | null = null;
        page.on('response', async (r) => {
            if (V2_STREAM.test(r.url()) && r.status() === 200) {
                try {
                    descriptor = await r.json();
                } catch {
                    /* not json */
                }
            }
        });

        await signInAndPlay(page, itemId);

        // The media actually gets served, through the legacy delivery URL.
        await expect
            .poll(
                () =>
                    wire.responses.filter(
                        (r) =>
                            LEGACY_STREAM.test(r.url) &&
                            (r.status === 200 || r.status === 206)
                    ).length,
                { timeout: 30_000 }
            )
            .toBeGreaterThan(0);

        const served = wire.responses.find(
            (r) =>
                LEGACY_STREAM.test(r.url) &&
                (r.status === 200 || r.status === 206)
        )!;

        // ---------------------------------------------------------------------------------------
        // THE CORRECTED INVARIANT. This test previously asserted
        // `expect(wire.requests.filter(V2_STREAM)).toHaveLength(0)` — that the descriptor endpoint
        // is never touched under a kill switch. That assumption was never observed, and it is
        // WRONG, for a structural reason: `FallbackReason` is a field of the DESCRIPTOR, and the
        // descriptor only exists on the `GET /Playback/Sessions/{id}/Stream` response. The client
        // flag is ON here, so the client takes the v2 path, POSTs a session, and GETs the
        // descriptor — that GET is precisely HOW it discovers the engine declined to serve.
        // Requiring zero `/Stream` requests demanded the client know the outcome without ever
        // asking for it.
        //
        // Verified on this rig with the engine at `Mode: 'Legacy'`: the descriptor answers `200`
        // with `ServedBy: 0`, `FallbackReason: 'KillSwitch'`, and a fully populated
        // `Url`/`Container`/`MimeType`. So the real "no mixed state" invariant is not about which
        // endpoints were called — it is about which media URL was ultimately PLAYED.
        // ---------------------------------------------------------------------------------------
        await expect
            .poll(
                () => wire.requests.filter((r) => V2_STREAM.test(r.url)).length,
                {
                    timeout: 30_000
                }
            )
            .toBeGreaterThan(0);

        await expect.poll(() => descriptor, { timeout: 30_000 }).toBeTruthy();
        const d = descriptor as unknown as Record<string, string>;
        console.log(
            `[killswitch] ServedBy=${d.ServedBy} FallbackReason=${d.FallbackReason} ` +
                `Container=${d.Container} MimeType=${d.MimeType}`
        );
        console.log(`[killswitch] descriptor Url=${d.Url}`);

        // The engine really did decline, and for the kill-switch reason specifically — not for
        // `PlanNotExecutable` or `StopThresholdTripped`, which would make this a different test.
        expect(d.FallbackReason).toBe('KillSwitch');

        // Requirement 4: no mixing. Every media delivery the player actually performed must be ONE
        // AND THE SAME URL. Two competing URLs — a v2-issued one alongside the legacy one — is the
        // exact mixed state PR #26's all-or-nothing rule forbids.
        const mediaFetches = wire.responses.filter(
            (r) =>
                LEGACY_STREAM.test(r.url) &&
                (r.status === 200 || r.status === 206)
        );
        const distinctMediaPaths = [
            ...new Set(mediaFetches.map((r) => r.url.split('?')[0]))
        ];
        console.log(
            `[killswitch] distinct media paths played=${JSON.stringify(distinctMediaPaths)}`
        );
        expect(
            distinctMediaPaths,
            'more than one distinct media URL was played — v2/legacy mixed state'
        ).toHaveLength(1);

        // A static (non-transcoded) delivery, which is what a legacy DirectPlay of this fixture is.
        expect(served.url).toMatch(/Static=true/i);

        // The Content-Type of the bytes actually played agrees with what the player was told. Left
        // container-agnostic on purpose: which container legacy picks depends on the real bundle's
        // own device profile, and hardcoding one would make this test assert an incidental
        // property of today's profile rather than the invariant under test.
        expect(served.contentType).toMatch(/^video\//);
    });
});

/**
 * The REAL Matroska fixture, driven through the REAL client.
 *
 * WHAT THIS PROVES, AND WHAT IT EXPLICITLY DOES NOT.
 *
 * It proves PR #26's descriptor consumption against a genuinely different container: the v2 engine
 * serves the `.mkv`, the descriptor supplies the media URL and the MimeType, and the client parses
 * nothing out of the URL.
 *
 * It does NOT prove a Remux/DirectStream decision, because THE REAL CLIENT CANNOT PROVOKE ONE ON
 * THIS RIG. The premise that it could rests on the claim that
 * `src/scripts/reefinPlaybackCapabilities.ts` offers `DirectPlayProfiles` for `webm`/`mp4`/`mov`
 * only. That claim is false: `buildVideoDirectPlayProfiles()` has an explicit third branch —
 *
 *     if (canPlayMkv(videoProbe, browser) && mp4VideoCodecs.length) {
 *         profiles.push(decodeProfile(MediaKind.Video, ['mkv'], mp4VideoCodecs, videoAudioCodecs));
 *     }
 *
 * — and Playwright's bundled Chromium satisfies `canPlayMkv`, so the unpatched client DECLARES mkv
 * direct-play support. The server then correctly answers `Method: 'DirectPlay'`,
 * `Reasons: ['MethodChosen']`, `Container: 'mkv'`, `MimeType: 'video/x-matroska'`. There is no
 * remux to observe. The declared containers are captured and printed below so this is a statement
 * about the bytes on the wire, not about reading the builder's source.
 *
 * Forcing a remux would require either rewriting the outgoing capability body (banned — removing
 * exactly that rewrite is the point of #26) or editing client source, so the Remux decision is
 * reported as NOT PROVEN rather than simulated. A hand-crafted capability set that excludes `mkv`
 * DOES yield `Method: 'Remux'` server-side; see `playback-v2-server-contract.spec.ts`.
 */
test.describe('playback v2 — the real MKV', () => {
    let remuxId = '';

    test.beforeAll(async () => {
        remuxId = await resolveItemIdByName('Remux Probe (2022)');
    });

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() =>
            localStorage.setItem('enableV2PlaybackPath', 'true')
        );
    });

    test('the v2 engine serves the .mkv and its descriptor — not the URL — supplies the media URL and MimeType', async ({
        page
    }) => {
        test.setTimeout(120_000);

        // Persistent server state — set the mode this test needs rather than inheriting it.
        await enableV2Engine();

        const wire = instrument(page);
        let descriptor: Record<string, unknown> | null = null;
        const sessionBodies: string[] = [];
        page.on('response', async (r) => {
            if (V2_STREAM.test(r.url()) && r.status() === 200) {
                try {
                    descriptor = await r.json();
                } catch {
                    /* not json */
                }
            } else if (V2_SESSIONS.test(r.url())) {
                try {
                    sessionBodies.push(await r.text());
                } catch {
                    /* body already consumed */
                }
            }
        });

        await signInAndPlay(page, remuxId);

        await expect
            .poll(
                () => wire.requests.filter((r) => V2_STREAM.test(r.url)).length,
                {
                    timeout: 30_000
                }
            )
            .toBeGreaterThan(0);
        await expect.poll(() => descriptor, { timeout: 30_000 }).toBeTruthy();

        const d = descriptor as unknown as Record<string, string>;
        console.log(
            `[remux] ServedBy=${d.ServedBy} FallbackReason=${d.FallbackReason} ` +
                `Protocol=${d.Protocol} Container=${d.Container} MimeType=${d.MimeType}`
        );
        console.log(`[remux] descriptor Url=${d.Url}`);

        // The decision, read off the POST response body, which carries the engine's own
        // `Method`/`Reasons` — never inferred from the URL shape.
        await expect
            .poll(() => sessionBodies.length, { timeout: 30_000 })
            .toBeGreaterThan(0);
        const decision = JSON.parse(sessionBodies[0]);
        console.log(
            `[mkv] Method=${decision.Method} Reasons=${JSON.stringify(decision.Reasons)}`
        );

        // THE EVIDENCE for why no remux occurs: the containers the UNPATCHED client actually put on
        // the wire. Printed rather than merely asserted, so the run itself carries the proof that
        // `mkv` is among them and the "webm/mp4/mov only" premise is wrong.
        const post = wire.requests.find(
            (r) => r.method === 'POST' && V2_SESSIONS.test(r.url)
        )!;
        const declaredContainers = (
            JSON.parse(post.postData!)?.Capabilities?.Decode
                ?.DirectPlayProfiles ?? []
        )
            .filter((p: { Type: string }) => p.Type === 'Video')
            .flatMap((p: { Containers: string[] }) => p.Containers);
        console.log(
            `[mkv] client-declared video direct-play containers=${JSON.stringify(declaredContainers)}`
        );
        expect(
            declaredContainers,
            'the client did NOT declare mkv — a genuine remux should then have been reachable, ' +
                'and this test needs rewriting to assert it'
        ).toContain('mkv');

        // Consequently the server direct-plays it. Asserted, not glossed: if this ever becomes
        // `Remux`, the capability surface changed and the reasoning above must be revisited.
        expect(decision.Method).toBe('DirectPlay');

        // v2 served it — not the legacy fallback.
        expect(
            d.FallbackReason,
            `v2 did not serve this (${d.FallbackReason})`
        ).toBeFalsy();
        expect(d.MimeType, 'descriptor carried no MimeType').toBeTruthy();

        // The media the player actually requested is the descriptor's own Url.
        const descriptorPath = String(d.Url).split('?')[0];
        await expect
            .poll(
                () =>
                    wire.responses.filter(
                        (r) =>
                            r.url.includes(descriptorPath) &&
                            (r.status === 200 || r.status === 206)
                    ).length,
                { timeout: 30_000 }
            )
            .toBeGreaterThan(0);

        const played = wire.responses.find(
            (r) =>
                r.url.includes(descriptorPath) &&
                (r.status === 200 || r.status === 206)
        )!;

        // The MimeType the player was given came from the DESCRIPTOR, and the delivery endpoint
        // agrees with it. (On the truthfulness of that MimeType with respect to the BYTES, see the
        // server-side note in `playback-v2-server-contract.spec.ts` — that is a server concern, not
        // a client-consumption one, and it is deliberately not asserted here.)
        expect(played.contentType.split(';')[0].trim().toLowerCase()).toBe(
            String(d.MimeType).toLowerCase()
        );

        // The client did NOT parse the URL: none of the legacy params the pre-#26 heuristics
        // string-matched are present to be parsed in the first place.
        expect(played.url.toLowerCase()).not.toContain('transcodereasons');
        expect(played.url.toLowerCase()).not.toContain('allowvideostreamcopy');
        expect(played.url.toLowerCase()).not.toContain('allowaudiostreamcopy');

        // No mixed state: every media delivery was the one descriptor-issued URL.
        const mediaFetches = wire.responses.filter(
            (r) =>
                LEGACY_STREAM.test(r.url) &&
                (r.status === 200 || r.status === 206)
        );
        expect(mediaFetches.length).toBeGreaterThan(0);
        for (const m of mediaFetches) {
            expect(
                m.url,
                'a media URL other than the v2 descriptor Url was played — mixed state'
            ).toContain(descriptorPath);
        }
    });
});

/**
 * The REAL external `.srt` sidecar (`Smoke Test Movie (2020).en.srt`, a genuine SubRip file that
 * `ci/serve-e2e.sh` ffprobe-verifies as `codec_name=subrip`). It indexes as an EXTERNAL subtitle
 * stream (`IsExternal: true`, `IsTextSubtitleStream: true`) on the movie's media source.
 */
test.describe('playback v2 — external subtitle sidecar', () => {
    let itemId = '';

    test.beforeAll(async () => {
        itemId = await resolveFirstMovieId();
    });

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() =>
            localStorage.setItem('enableV2PlaybackPath', 'true')
        );
    });

    test('the sidecar is delivered externally and the v2 decision reflects it, without forcing a burn-in transcode', async ({
        page
    }) => {
        test.setTimeout(120_000);
        await enableV2Engine();

        const wire = instrument(page);
        const sessionBodies: string[] = [];
        page.on('response', async (r) => {
            if (V2_SESSIONS.test(r.url())) {
                try {
                    sessionBodies.push(await r.text());
                } catch {
                    /* body already consumed */
                }
            }
        });

        await signInAndPlay(page, itemId);

        await expect
            .poll(() => sessionBodies.length, { timeout: 30_000 })
            .toBeGreaterThan(0);
        const decision = JSON.parse(sessionBodies[0]);
        console.log(
            `[subtitle] Method=${decision.Method} Reasons=${JSON.stringify(decision.Reasons)}`
        );

        // THE LOAD-BEARING ASSERTION. The client declares `SubtitleDelivery: [{Method: External}]`
        // (`buildSubtitleDelivery` in reefinPlaybackCapabilities.ts), and the server honours it:
        // the sidecar is converted to a browser-consumable format and handed over as a SEPARATE
        // track rather than burned into the video. `SubtitleFormatConverted` is the server's own
        // reason code for exactly that, and its presence is what distinguishes external delivery
        // from the burn-in path.
        //
        // The contrast that gives this teeth: a client declaring `SubtitleDelivery: []` on this
        // SAME fixture gets `Method: 'Transcode'` with
        // `['SubtitleCodecNotSupported', 'SubtitleBurnInRequired']` — i.e. the sidecar's presence
        // alone is enough to force a full re-encode when external delivery is not offered. The real
        // client avoids that, and this asserts it does.
        expect(decision.Reasons).toContain('SubtitleFormatConverted');
        expect(
            decision.Reasons,
            'the sidecar forced a burn-in — external delivery was not honoured'
        ).not.toContain('SubtitleBurnInRequired');
        expect(decision.Method).toBe('DirectPlay');

        // The subtitle is therefore NOT welded into the video stream: the media is a static direct
        // play, with no burn-in transcode parameters on the delivery URL. Polled, not read
        // synchronously — the media request is issued asynchronously after the decision lands, so
        // reading `wire` immediately races it and observes an empty list.
        await expect
            .poll(
                () =>
                    wire.responses.filter(
                        (r) =>
                            LEGACY_STREAM.test(r.url) &&
                            (r.status === 200 || r.status === 206)
                    ).length,
                { timeout: 30_000 }
            )
            .toBeGreaterThan(0);

        const mediaFetches = wire.responses.filter(
            (r) =>
                LEGACY_STREAM.test(r.url) &&
                (r.status === 200 || r.status === 206)
        );
        expect(mediaFetches[0].url).toMatch(/Static=true/i);
        expect(mediaFetches[0].url.toLowerCase()).not.toContain(
            'subtitlemethod=encode'
        );

        // And the sidecar is really retrievable as its own track, as real bytes, from the browser's
        // own authenticated session — not merely promised by the decision. Fetched in-page so this
        // exercises the same origin/credentials the player would use.
        const subtitleProbe = await page.evaluate(async (id: string) => {
            const res = await fetch(
                `/Videos/${id}/${id}/Subtitles/0/0/Stream.vtt`,
                { headers: { Accept: '*/*' } }
            );
            return {
                status: res.status,
                contentType: res.headers.get('content-type'),
                body: (await res.text()).slice(0, 120)
            };
        }, itemId);
        console.log(
            `[subtitle] sidecar fetch=${JSON.stringify(subtitleProbe)}`
        );

        expect(subtitleProbe.status).toBe(200);
        expect(subtitleProbe.contentType).toMatch(/text\/vtt/);
        // Real cue content, converted from the SubRip source — not an empty 200.
        expect(subtitleProbe.body).toContain('WEBVTT');
        expect(subtitleProbe.body).toContain('Reefin E2E external subtitle');
    });
});

test.describe('playback v2 — flag OFF (default)', () => {
    let itemId = '';
    test.beforeAll(async () => {
        itemId = await resolveFirstMovieId();
    });

    test('no v2 chunk and no Playback/Sessions traffic; playback is whole-legacy', async ({
        page
    }) => {
        test.setTimeout(120_000);
        const wire = instrument(page);
        // Deliberately NO addInitScript here: this exercises the shipped default.
        await signInAndPlay(page, itemId);

        await expect
            .poll(
                () =>
                    wire.responses.filter(
                        (r) =>
                            LEGACY_STREAM.test(r.url) &&
                            (r.status === 200 || r.status === 206)
                    ).length,
                { timeout: 30_000 }
            )
            .toBeGreaterThan(0);

        // The default really is off…
        expect(
            await page.evaluate(() =>
                localStorage.getItem('enableV2PlaybackPath')
            )
        ).toBeNull();

        // …and with it off, the v2 chain is never even fetched over the network (PR116f's whole
        // point), let alone called.
        expect(wire.requests.filter((r) => V2_CHUNK.test(r.url))).toHaveLength(
            0
        );
        expect(
            wire.requests.filter((r) => V2_SESSIONS.test(r.url))
        ).toHaveLength(0);
        expect(wire.requests.filter((r) => V2_STREAM.test(r.url))).toHaveLength(
            0
        );

        const served = wire.responses.find(
            (r) =>
                LEGACY_STREAM.test(r.url) &&
                (r.status === 200 || r.status === 206)
        )!;
        expect(served.contentType).toMatch(/^video\/mp4/);
    });
});
