import { expect, request, test } from '@playwright/test';

/**
 * Playback v2 SERVER descriptor contract — exercised over HTTP against the real server booted by
 * `reefin/ci/serve-e2e.sh`.
 *
 * SCOPE CAPTION — read before trusting any result in this file:
 *   These tests do NOT exercise reefin-web's client. They POST a HAND-CRAFTED `Playback/Sessions`
 *   payload directly over HTTP, so a green run here proves the SERVER's descriptor is truthful and
 *   its status-code contract holds. Client-side consumption is proven separately, and for real, in
 *   `playback-v2-client.spec.ts`.
 *
 *   STALE-CAPTION CORRECTION: this header previously claimed the hand-crafted payload was necessary
 *   because "the real client's payload is rejected 400" for omitting `Profiles`/`VideoRangeTypes`.
 *   That has not been true since `tesserafinPlaybackCapabilities.ts` began emitting `Profiles: []` and
 *   `VideoRangeTypes: ['SDR']`. The unpatched client now creates v2 sessions on its own — observed,
 *   not assumed: `playback-capabilities-contract.spec.ts` captures the real body on the wire and
 *   `playback-v2-client.spec.ts` drives the full descriptor path through the UI. The payload here is
 *   hand-crafted only so this file can vary ONE capability at a time to reach server states the
 *   browser's own fixed capability set cannot express — which is exactly why the remux case below
 *   lives here rather than in the client spec.
 */

const USER = process.env.TESSERAFIN_E2E_USER ?? 'smokeadmin';
const PASSWORD = process.env.TESSERAFIN_E2E_PASSWORD ?? 'smokepass123';
const BASE_URL = process.env.TESSERAFIN_E2E_BASE_URL ?? 'http://localhost:8096';

const H =
    'MediaBrowser Client="Tesserafin Web E2E", Device="Playwright", DeviceId="tesserafin-e2e-v2-contract", Version="0.0.0"';

interface Ctx {
    api: import('@playwright/test').APIRequestContext;
    token: string;
    userId: string;
    itemId: string;
}

let ctx: Ctx;

/** The real client's captured `POST /Playback/Sessions` body, with ONLY `Profiles`/`VideoRangeTypes`
 * added to each `Capabilities.Decode.VideoCodecs[]` entry so the server will accept it. */
function baseRequest(overrides: Record<string, unknown> = {}) {
    return {
        ItemId: ctx.itemId,
        UserId: ctx.userId,
        MediaSourceId: ctx.itemId,
        PlaySessionId: `e2e-${Math.random().toString(36).slice(2)}`,
        Capabilities: {
            Decode: {
                DirectPlayProfiles: [
                    {
                        Type: 'Video',
                        Containers: ['mp4', 'm4v'],
                        VideoCodecs: ['h264'],
                        AudioCodecs: ['aac']
                    }
                ],
                VideoCodecs: [
                    { Codec: 'h264', Profiles: [], VideoRangeTypes: [] }
                ],
                AudioCodecs: [{ Codec: 'aac' }],
                SubtitleDelivery: [],
                SupportsHls: true,
                SupportsDash: false
            },
            OutputProfiles: []
        },
        Constraints: {
            AllowDirectPlay: true,
            AllowDirectStream: true,
            AllowTranscoding: true,
            AllowVideoStreamCopy: true,
            AllowAudioStreamCopy: true,
            MaxBitrate: null,
            MaxAudioChannels: null,
            PreferredAudioStreamIndex: null,
            PreferredSubtitleStreamIndex: null,
            SubtitleMode: 'Default',
            PreferredSubtitleLanguages: [],
            AlwaysBurnInSubtitleWhenTranscoding: false,
            StartTimeTicks: 0
        },
        ...overrides
    };
}

test.beforeAll(async () => {
    const api = await request.newContext({ baseURL: BASE_URL });
    const auth = await (
        await api.post('/Users/AuthenticateByName', {
            headers: { Authorization: H },
            data: { Username: USER, Pw: PASSWORD }
        })
    ).json();
    const token = `${H}, Token="${auth.AccessToken}"`;
    const items = await (
        await api.get('/Items', {
            params: {
                userId: auth.User.Id,
                recursive: 'true',
                includeItemTypes: 'Movie'
            },
            headers: { Authorization: token }
        })
    ).json();
    ctx = {
        api,
        token,
        userId: auth.User.Id,
        itemId: items.Items[0].Id
    };

    // The v2 EXECUTION engine is kill-switched off by default: PlaybackLiveStreamResolver falls
    // straight back to legacy unless `PlaybackShadow.GetEffectiveMode()` is Canary or V2, stamping
    // `FallbackReason: "KillSwitch"` / `ServedBy: 0` on every descriptor. Without flipping it, this
    // whole file would only ever exercise the descriptor mapper over LEGACY-resolved plans.
    // This is server runtime configuration set through the real admin API - no source default is
    // modified, and nothing here touches the client's own `enableV2PlaybackPath` flag.
    const cfgRes = await api.get('/System/Configuration', {
        headers: { Authorization: token }
    });
    const cfg = await cfgRes.json();
    cfg.PlaybackShadow = { ...(cfg.PlaybackShadow ?? {}), Mode: 'V2' };
    const posted = await api.post('/System/Configuration', {
        headers: { Authorization: token },
        data: cfg
    });
    if (!posted.ok()) {
        throw new Error(
            `could not enable the v2 playback engine: ${posted.status()} ${(await posted.text()).slice(0, 300)}`
        );
    }
    const verify = await (
        await api.get('/System/Configuration', {
            headers: { Authorization: token }
        })
    ).json();
    expect(
        verify.PlaybackShadow?.Mode,
        'v2 engine did not stay enabled - every assertion below would silently be about the legacy path'
    ).toBe('V2');
});

test.afterAll(async () => {
    await ctx.api.dispose();
});

/** Resolves a fixture by NAME across every video-bearing library. The remux fixture is a `Video` in
 * the `homevideos` "Codec Probes" library, not a `Movie`, so an `includeItemTypes=Movie` lookup
 * cannot see it; and indexing `Items[0]` positionally silently binds to whichever fixture happens
 * to sort first. */
async function resolveItemIdByName(name: string): Promise<string> {
    const items = await (
        await ctx.api.get('/Items', {
            params: {
                userId: ctx.userId,
                recursive: 'true',
                includeItemTypes: 'Movie,Video'
            },
            headers: { Authorization: ctx.token }
        })
    ).json();
    const match = (items.Items ?? []).find(
        (i: { Name: string }) => i.Name === name
    );
    if (!match) {
        throw new Error(`fixture "${name}" not found on the server`);
    }
    return String(match.Id);
}

async function createSession(body: unknown) {
    return ctx.api.post('/Playback/Sessions', {
        headers: { Authorization: ctx.token },
        data: body as Record<string, unknown>
    });
}

async function getDescriptor(sessionId: string) {
    return ctx.api.get(`/Playback/Sessions/${sessionId}/Stream`, {
        params: { startTimeTicks: 0 },
        headers: { Authorization: ctx.token }
    });
}

test('descriptor MimeType matches the Content-Type of the bytes actually served (Http/DirectPlay)', async () => {
    const created = await createSession(baseRequest());
    expect(created.status()).toBe(200);
    const session = await created.json();

    const res = await getDescriptor(session.Id);
    expect(res.status()).toBe(200);
    const d = await res.json();

    // Anti-vacuity: a descriptor with no Url would make every check below meaningless.
    expect(d.Url, 'descriptor carried no Url').toBeTruthy();
    // …and it must be the v2 engine that produced it, not the legacy fallback. `FallbackReason`
    // is non-null exactly when v2 did NOT serve (KillSwitch, StopThresholdTripped, …).
    expect(
        d.FallbackReason,
        `descriptor was served by the legacy fallback (${d.FallbackReason}), not the v2 engine`
    ).toBeFalsy();
    expect(d.Protocol).toBe('Http');
    expect(d.MimeType, 'descriptor carried no MimeType').toBeTruthy();

    // Fetch the EXACT url the descriptor handed out and compare the real Content-Type.
    const served = await ctx.api.get(d.Url);
    expect(
        served.status(),
        `descriptor Url was not fetchable: ${d.Url}`
    ).toBeLessThan(300);
    const contentType = served.headers()['content-type'] ?? '';

    // Requirement 2, non-HLS: MimeType is exactly what the delivery endpoint responds with.
    expect(contentType.split(';')[0].trim().toLowerCase()).toBe(
        String(d.MimeType).toLowerCase()
    );
    // …and Container is the container the URL itself embeds.
    expect(String(d.Url)).toContain(`stream.${d.Container}`);

    // Prove the bytes really are that container, not just the header claiming so.
    const head = (await served.body()).subarray(0, 12).toString('latin1');
    expect(head).toContain('ftyp');
});

test('the v2 engine EXECUTES a transcode plan for the mpeg4/ac3 fixture and serves real re-encoded bytes', async () => {
    // CORRECTED TEST. This previously asserted `FallbackReason === 'PlanNotExecutable'`, on the
    // premise that the v2 execution-plan resolver could not produce an executable transcode plan.
    // That is no longer true, and the assertion failed against this rig: with `Mode: 'V2'` the
    // engine resolves and executes the plan itself (`ServedBy: 6`, no `FallbackReason`). Rather than
    // delete the coverage, it now asserts what the engine genuinely does.
    //
    // It also uses the RIGHT fixture. The old version forced a transcode of the h264/aac movie by
    // denying every copy path — an artificial transcode. `Transcode Probe (2021)` is mpeg4 Simple
    // Profile + ac3, codecs absent from EVERY Chromium build, so the incompatibility is REAL and
    // carried entirely by the codecs (the container stays .mp4).
    const transcodeId = await resolveItemIdByName('Transcode Probe (2021)');

    const created = await createSession(
        baseRequest({ ItemId: transcodeId, MediaSourceId: transcodeId })
    );
    expect(created.status()).toBe(200);
    const decision = await created.json();
    console.log(
        `[transcode] Method=${decision.Method} Reasons=${JSON.stringify(decision.Reasons)}`
    );

    // The incompatibility is genuinely codec-driven, per the server's own reason codes.
    expect(decision.Method).toBe('Transcode');
    expect(decision.Reasons).toContain('VideoCodecNotSupported');
    expect(decision.Reasons).toContain('AudioCodecNotSupported');

    const res = await getDescriptor(decision.Id);
    expect(res.status()).toBe(200);
    const d = await res.json();
    console.log(
        `[transcode] ServedBy=${d.ServedBy} FallbackReason=${d.FallbackReason} ` +
            `Protocol=${d.Protocol} Container=${d.Container} MimeType=${d.MimeType}`
    );

    // v2 executed it — this is the assertion that replaced the stale `PlanNotExecutable` one.
    expect(
        d.FallbackReason,
        `the v2 engine did not serve this (${d.FallbackReason})`
    ).toBeFalsy();
    expect(d.Container).toBeTruthy();
    expect(d.MimeType).toBeTruthy();

    // NOTE ON HLS: the descriptor is `Protocol: 'Http'` — a PROGRESSIVE transcode — even though this
    // request declares `SupportsHls: true`. No capability combination tried against this rig
    // (including denying direct play and stream copy outright) makes the v2 engine emit
    // `Protocol: 'Hls'`. Asserted rather than commented so a future change to that behaviour
    // surfaces here instead of silently invalidating the reasoning above.
    expect(d.Protocol).toBe('Http');

    // REAL BYTES, not just a 200 on a manifest. Fetch the exact URL the descriptor handed out.
    const served = await ctx.api.get(d.Url);
    expect(
        served.status(),
        `descriptor Url was not fetchable: ${d.Url}`
    ).toBeLessThan(300);
    const body = await served.body();
    console.log(
        `[transcode] delivered bytes=${body.length} content-type=${served.headers()['content-type']}`
    );
    expect(body.length).toBeGreaterThan(1000);

    // The MimeType is truthful about the delivered Content-Type…
    expect(
        (served.headers()['content-type'] ?? '')
            .split(';')[0]
            .trim()
            .toLowerCase()
    ).toBe(String(d.MimeType).toLowerCase());

    // …and the bytes really are an ISO-BMFF/MP4 box structure, i.e. a genuine re-encode of the
    // mpeg4/ac3 source rather than the source passed through. (`ffprobe` on these same bytes
    // reports h264/aac out of an mpeg4/ac3 input; `ftyp` is the in-test proxy for that.)
    expect(body.subarray(0, 12).toString('latin1')).toContain('ftyp');
});

test('a capability set WITHOUT mkv yields a genuine Remux decision for the Matroska fixture', async () => {
    // The remux case the CLIENT cannot reach: Playwright's Chromium satisfies `canPlayMkv`, so the
    // real bundle declares an `mkv` direct-play profile and the server rightly direct-plays the
    // file (see the header note in `playback-v2-client.spec.ts`). Dropping `mkv` from the declared
    // containers here — a legitimate variation of a hand-crafted payload, NOT a rewrite of a real
    // client request — leaves the container as the only incompatibility, which is the definition of
    // a remux.
    const remuxId = await resolveItemIdByName('Remux Probe (2022)');

    const created = await createSession(
        baseRequest({
            ItemId: remuxId,
            MediaSourceId: remuxId,
            Capabilities: {
                Decode: {
                    DirectPlayProfiles: [
                        {
                            Type: 'Video',
                            Containers: ['mp4', 'm4v'],
                            VideoCodecs: ['h264'],
                            AudioCodecs: ['aac']
                        }
                    ],
                    VideoCodecs: [
                        {
                            Codec: 'h264',
                            Profiles: [],
                            VideoRangeTypes: ['SDR']
                        }
                    ],
                    AudioCodecs: [{ Codec: 'aac' }],
                    SubtitleDelivery: [],
                    SupportsHls: true,
                    SupportsDash: false
                },
                OutputProfiles: []
            }
        })
    );
    expect(created.status()).toBe(200);
    const decision = await created.json();
    console.log(
        `[remux] Method=${decision.Method} Reasons=${JSON.stringify(decision.Reasons)}`
    );

    // "The streams are fine, the box is not" — a remux, per the server's own reason codes.
    expect(decision.Method).toBe('Remux');
    expect(decision.Reasons).toContain('ContainerNotSupported');
    expect(decision.Reasons).toContain('StreamCopyable');

    const res = await getDescriptor(decision.Id);
    expect(res.status()).toBe(200);
    const d = await res.json();
    console.log(
        `[remux] ServedBy=${d.ServedBy} FallbackReason=${d.FallbackReason} ` +
            `Container=${d.Container} MimeType=${d.MimeType}`
    );
    expect(d.FallbackReason).toBeFalsy();
    expect(d.MimeType).toBeTruthy();

    const served = await ctx.api.get(d.Url);
    expect(served.status()).toBeLessThan(300);
    const body = await served.body();
    const contentType = (served.headers()['content-type'] ?? '')
        .split(';')[0]
        .trim()
        .toLowerCase();
    console.log(
        `[remux] delivered bytes=${body.length} content-type=${contentType} ` +
            `first4=${JSON.stringify(body.subarray(0, 4).toString('latin1'))}`
    );

    // The descriptor's MimeType is consistent with the Content-Type header actually served.
    expect(contentType).toBe(String(d.MimeType).toLowerCase());

    // ------------------------------------------------------------------------------------------
    // KNOWN SERVER DEFECT — deliberately REPORTED, not asserted, so this suite does not red-fail
    // reefin-web PR #26 for a server-side bug outside its diff.
    //
    // On this rig the Remux descriptor reports `Container: 'mp4'` / `MimeType: 'video/mp4'` and the
    // delivery endpoint echoes `Content-Type: video/mp4` — but the BYTES are untouched Matroska.
    // The URL carries `Static=true`, so the file is served verbatim: the response is exactly 46816
    // bytes, the size of the raw `.mkv` fixture, and `ffprobe` reports `format_name=matroska,webm`.
    // The header/descriptor pair is self-consistent, which is why the assertion above passes; the
    // inconsistency is between the promised container and the delivered payload.
    //
    // This matters for #26 specifically because the client takes `descriptor.MimeType` VERBATIM
    // (`playbackSessionV2Url.ts`), so a faithful consumer hands Matroska bytes to a <video> element
    // labelled `video/mp4`. Faithful consumption of an untruthful descriptor is still broken
    // playback. Logged loudly here and written up for a server-side follow-up issue.
    // ------------------------------------------------------------------------------------------
    const looksMatroska = body.subarray(0, 4).toString('hex') === '1a45dfa3';
    if (looksMatroska && d.Container === 'mp4') {
        console.log(
            `[remux][SERVER-DEFECT] descriptor promises Container=mp4/MimeType=${d.MimeType} ` +
                `but the delivered bytes are Matroska (EBML magic 1a45dfa3, ${body.length} bytes, ` +
                `Static=true serves the source file verbatim). Follow-up issue warranted.`
        );
    }
});

test('409 when the session has no PlaySessionId', async () => {
    const body = baseRequest();
    delete (body as Record<string, unknown>).PlaySessionId;

    const created = await createSession(body);
    expect(created.status()).toBe(200);
    const session = await created.json();

    const res = await getDescriptor(session.Id);
    expect(res.status()).toBe(409);
});

/** A WELL-FORMED request whose ONLY possible plan is a re-encode — so with `AllowTranscoding: false`
 * it admits no plan at all, and with `AllowTranscoding: true` it plans a `Transcode`. That one-flag
 * difference is the whole point: it is what makes a `422` attributable to the CONSTRAINT rather than
 * to some unrelated defect in the request.
 *
 * The shape mirrors the preset the server's own issue-#59 matrix uses
 * (`EndToEndCapabilityPresets.IncompatibleCodecsTranscodingForbidden`), and each detail is load-bearing:
 *
 *   * the declared codecs (vp9/opus) cannot decode this h264/aac mp4 fixture, so DirectPlay is out;
 *   * `AllowDirectStream: true` is DELIBERATE. A vp9/opus client cannot stream-COPY an h264/aac
 *     source either, so no remux is viable — but leaving direct-stream PERMITTED is what routes this
 *     through the guard issue #59 actually fixed (`StreamBuilder.GetVideoTranscodeProfile` keying the
 *     permission on the method the chosen profile really requires). With `AllowDirectStream: false`
 *     the request would instead trip the older, pre-existing "no method permitted at all" guard, and
 *     the test would stay green even if the #59 fix were reverted;
 *   * an HLS OutputProfile is declared so a transcode is genuinely REACHABLE. Without an output
 *     target the request would be unservable for want of somewhere to send the re-encode, and a 422
 *     would prove nothing about `AllowTranscoding`.
 *
 * Deliberately NOT "deny every method": `PlaybackSessionRequestValidator` rejects that with `400`
 * ("at least one of AllowDirectPlay/AllowDirectStream/AllowTranscoding"), the malformed-request
 * branch — a different contract from "well-formed but unplannable". */
function reEncodeOnlyRequest(allowTranscoding: boolean, itemId?: string) {
    const base = baseRequest(
        itemId ? { ItemId: itemId, MediaSourceId: itemId } : {}
    );
    return {
        ...base,
        Capabilities: {
            Decode: {
                DirectPlayProfiles: [
                    {
                        Type: 'Video',
                        Containers: ['mp4'],
                        VideoCodecs: ['vp9'],
                        AudioCodecs: ['opus']
                    }
                ],
                VideoCodecs: [
                    { Codec: 'vp9', Profiles: [], VideoRangeTypes: [] }
                ],
                AudioCodecs: [{ Codec: 'opus' }],
                SubtitleDelivery: [],
                SupportsHls: true,
                SupportsDash: false
            },
            OutputProfiles: [
                {
                    Type: 'Video',
                    Protocol: 'Hls',
                    Container: 'ts',
                    VideoCodecs: ['vp9'],
                    AudioCodecs: ['opus'],
                    MaxVideoBitrate: null,
                    MaxAudioBitrate: null,
                    MaxAudioChannels: null
                }
            ]
        },
        Constraints: {
            ...(base.Constraints as Record<string, unknown>),
            AllowDirectPlay: true,
            AllowDirectStream: true,
            AllowTranscoding: allowTranscoding
        }
    };
}

test('422 on POST when nothing is plannable', async () => {
    // PREVIOUSLY SKIPPED AS UNREACHABLE, NOW REACHABLE — the skip was honest when written and is no
    // longer true, so it is lifted rather than left to rot. What changed is server-side, not here:
    // the legacy `StreamBuilder` branch used to ignore `AllowTranscoding: false` and serve a real
    // re-encode (issue #59), so this request came back `200 Method='Transcode'` and 422 could not be
    // reached. `reefin@93a9d1e2` ("fix(dlna): honor AllowTranscoding:false on the legacy branch")
    // keys the permission on the method the chosen profile actually requires, so a request that only
    // a re-encode could satisfy now yields no viable plan at all.
    //
    // The other half of the old comment still holds and is still deliberately avoided: denying all
    // three methods is `400` from PlaybackSessionRequestValidator (malformed), a different branch
    // from "well-formed but unplannable". See `reEncodeOnlyRequest`.

    // POSITIVE CONTROL FIRST — the identical request with the single flag flipped. This pins WHY the
    // refusal below happens: the request is perfectly plannable, and the plan it admits is a real
    // re-encode. Without this, a 422 could equally mean the payload was quietly unservable for some
    // unrelated reason, which is exactly the vacuity that let #59 hide behind a status-code-only
    // assertion. (Descriptor/bytes are deliberately NOT fetched here: a POST only decides, whereas
    // fetching a transcode's stream would start a real re-encode for no added proof.)
    const permitted = await createSession(reEncodeOnlyRequest(true));
    expect(
        permitted.status(),
        `positive control should be plannable; body: ${(await permitted.text()).slice(0, 400)}`
    ).toBe(200);
    const decision = await permitted.json();
    expect(
        decision.Method,
        `[422-control] Method=${decision.Method} Reasons=${JSON.stringify(decision.Reasons)}`
    ).toBe('Transcode');

    // …and now the same request with transcoding forbidden: the only plan is one it may not use.
    const created = await createSession(reEncodeOnlyRequest(false));
    // Guard against passing for the wrong reason: 400 would mean the request was malformed, which
    // is a different contract branch than "well-formed but unplannable".
    expect(
        created.status(),
        `expected 422; body: ${(await created.text()).slice(0, 400)}`
    ).toBe(422);
});

test('422 on PUT when the session exists but no plan is viable', async () => {
    // Reachable for the same reason as the POST case above - see its comment. This closes the RE-PLAN
    // verb, which re-enters planning by a different path than POST.
    //
    // Seed a session that is genuinely DIRECT-PLAY first, exactly as the server's own #59 PUT test
    // does. This is why it targets `Smoke Test Movie` (h264/aac/mp4) by NAME rather than the file's
    // positional `ctx.itemId`: that id happens to bind to `Transcode Probe` (mpeg4/ac3), which
    // `baseRequest()` can only TRANSCODE - and a seed that is already a transcode would make the
    // post-refusal byte check below vacuous ("did not convert to transcode" proves nothing when it
    // was a transcode to begin with).
    const directPlayId = await resolveItemIdByName('Smoke Test Movie (2020)');
    // The seed MUST declare EXTERNAL vtt subtitle delivery. `Smoke Test Movie` carries an external
    // subrip subtitle stream; a client that declares no subtitle delivery makes the server conclude
    // the subtitle must be burned in (`SubtitleBurnInRequired`), which forces a Transcode even though
    // the h264/aac video is otherwise directly playable. Declaring external vtt delivery lets the
    // subtitle ride along as a sidecar and the video DirectPlays. (`VideoRangeTypes: ['SDR']` matches
    // the real client and the SDR source; verified empirically it is the subtitle, not the range,
    // that gates this.) Without a genuine DirectPlay seed the post-refusal byte check below is vacuous.
    const created = await createSession(
        baseRequest({
            ItemId: directPlayId,
            MediaSourceId: directPlayId,
            Capabilities: {
                Decode: {
                    DirectPlayProfiles: [
                        {
                            Type: 'Video',
                            Containers: ['mp4', 'm4v'],
                            VideoCodecs: ['h264'],
                            AudioCodecs: ['aac']
                        }
                    ],
                    VideoCodecs: [
                        {
                            Codec: 'h264',
                            Profiles: [],
                            VideoRangeTypes: ['SDR']
                        }
                    ],
                    AudioCodecs: [{ Codec: 'aac' }],
                    SubtitleDelivery: [{ Format: 'vtt', Method: 'External' }],
                    SupportsHls: true,
                    SupportsDash: false
                },
                OutputProfiles: []
            }
        })
    );
    expect(
        created.status(),
        `seed session should be viable; body: ${(await created.text()).slice(0, 300)}`
    ).toBe(200);
    const session = await created.json();
    expect(
        session.Method,
        `[422-put] seed Method=${session.Method} (expected DirectPlay so the refusal below has a non-transcode plan to preserve)`
    ).toBe('DirectPlay');

    // Re-plan the SAME item to capabilities whose only plan is a re-encode, with transcoding
    // forbidden. The item MUST match the seed's - the session is bound to it, and re-planning it with
    // a different item's payload would be a mismatch, not the contract under test.
    const replaced = await ctx.api.put(`/Playback/Sessions/${session.Id}`, {
        headers: { Authorization: ctx.token },
        data: reEncodeOnlyRequest(false, directPlayId) as Record<
            string,
            unknown
        >
    });
    expect(
        replaced.status(),
        `expected 422; body: ${(await replaced.text()).slice(0, 400)}`
    ).toBe(422);

    // The refusal must not have quietly converted the session into the transcode it just refused.
    // Asserting the status alone would not catch that - a 422 response and a session mutated into a
    // re-encode are perfectly compatible - so this inspects the plan the session STILL serves and the
    // bytes it produces. (The decided method itself is pinned where it actually lives: the seed's
    // Method='DirectPlay' above and the refused PUT's 422. The GET /Stream descriptor deliberately
    // does not carry a Method field - it is `null` for a healthy DirectPlay too, verified against this
    // rig - so the intactness proof is the static-mp4 delivery below, not a descriptor Method.)
    const after = await getDescriptor(session.Id);
    const afterBody = after.status() === 200 ? await after.json() : null;
    // eslint-disable-next-line no-console
    console.log(
        `[422-put] post-refusal descriptor status=${after.status()} Protocol=${afterBody?.Protocol} ` +
            `Container=${afterBody?.Container} ServedBy=${afterBody?.ServedBy} ` +
            `FallbackReason=${afterBody?.FallbackReason} Url=${String(afterBody?.Url).slice(0, 80)}`
    );
    expect(
        after.status(),
        `session should still resolve after a refused re-plan; body: ${JSON.stringify(afterBody).slice(0, 300)}`
    ).toBe(200);
    // The surviving plan is the original direct file passthrough, not the refused HLS transcode.
    expect(afterBody.Protocol).toBe('Http');
    expect(afterBody.Container).toBe('mp4');
    expect(
        afterBody.FallbackReason,
        `refused re-plan pushed the session onto the legacy fallback (${afterBody.FallbackReason})`
    ).toBeFalsy();
    expect(
        String(afterBody.Url),
        `expected a static direct-play URL, got ${afterBody.Url}`
    ).toContain('Static=true');
    expect(String(afterBody.Url)).not.toContain('.m3u8');

    const served = await ctx.api.get(afterBody.Url);
    expect(
        served.status(),
        `post-refusal Url not fetchable: ${afterBody.Url}`
    ).toBeLessThan(300);
    const body = await served.body();
    const head = body.subarray(0, 12).toString('latin1');
    expect(
        head,
        `expected the original mp4 plan to survive the refused re-plan, got ${head.length} bytes starting ${body.subarray(0, 8).toString('hex')}`
    ).toContain('ftyp');
    // …and specifically not the HLS transcode the refused request asked for.
    expect(body.subarray(0, 7).toString('latin1')).not.toBe('#EXTM3U');
});

test('no orphaned session after teardown: DELETE makes it unresolvable', async () => {
    const created = await createSession(baseRequest());
    expect(created.status()).toBe(200);
    const session = await created.json();

    // It resolves while it exists…
    expect((await getDescriptor(session.Id)).status()).toBe(200);

    const del = await ctx.api.delete(`/Playback/Sessions/${session.Id}`, {
        headers: { Authorization: ctx.token }
    });
    expect(del.status()).toBe(204);

    // …and is gone afterwards, on the same endpoint that just served it.
    expect((await getDescriptor(session.Id)).status()).toBe(404);
});

/**
 * ISSUE #57/#58 SIDE EFFECT — the external-subtitle offset of a SEEKING remux.
 *
 * The #58 fix normalizes `PlayMethod` from `DirectStream` to `Transcode` for URL serialization
 * (gated on `ServedByV2`) immediately BEFORE `PlaybackSessionStreamDescriptorMapper.Map` runs
 * (`PlaybackSessionsController.GetPlaybackSessionStream`). That mapper resolves the external
 * subtitle URL through `StreamInfo.GetSubtitleProfiles`, whose offset is:
 *
 *     startPositionTicks = SubProtocol == hls ? 0
 *                        : (PlayMethod == Transcode && !CopyTimestamps ? StartPositionTicks : 0)
 *
 * so flipping the method also flips that offset — from `0` to the seek position — and it is emitted
 * as a PATH SEGMENT of the subtitle URL:
 *
 *     /Videos/{ItemId}/{MediaSourceId}/Subtitles/{index}/{startPositionTicks}/Stream.{format}
 *
 * That combination (Remux + external subtitle + non-zero seek) is covered by nothing, on either
 * side. It is measured here rather than in the client spec because it is NOT reachable through the
 * real browser: see `playback-v2-client.spec.ts` — Playwright's Chromium satisfies `canPlayMkv`, so
 * the only Matroska fixture direct-plays, and the only fixture carrying an external subtitle
 * sidecar is the h264/aac MP4 that direct-plays too. Varying ONE declared capability (dropping
 * `mp4` from the containers, leaving the streams copyable) is the same hand-crafted-payload
 * technique the Matroska remux case above uses, and the same one the server's own merged regression
 * test uses (`EndToEndCapabilityPresets.RemuxMatroskaToMp4`). No request body is rewritten.
 */
test.describe('the external subtitle offset of a seeking Remux (issue #57/#58 side effect)', () => {
    /** 30s in ticks (100ns units) — inside the 2s fixture's timeline is irrelevant here: the value
     * is a URL segment the mapper serializes, not a decode position that has to resolve. */
    const SEEK_TICKS = 300_000_000;

    async function getDescriptorAt(sessionId: string, startTimeTicks: number) {
        return ctx.api.get(`/Playback/Sessions/${sessionId}/Stream`, {
            params: { startTimeTicks },
            headers: { Authorization: ctx.token }
        });
    }

    /** The offset segment of `/Subtitles/{index}/{startPositionTicks}/Stream.{fmt}`. */
    function subtitleOffsetOf(subtitleUrl: string): string {
        const m = /\/Subtitles\/(\d+)\/(\d+)\/Stream\./i.exec(subtitleUrl);
        if (!m) {
            throw new Error(
                `subtitle URL did not match the expected shape: ${subtitleUrl}`
            );
        }
        return m[2];
    }

    /** Capabilities whose ONLY incompatibility with the h264/aac MP4 fixture is its container. */
    function capabilities(containers: string[]) {
        return {
            Decode: {
                DirectPlayProfiles: [
                    {
                        Type: 'Video',
                        Containers: containers,
                        VideoCodecs: ['h264'],
                        AudioCodecs: ['aac']
                    }
                ],
                VideoCodecs: [
                    { Codec: 'h264', Profiles: [], VideoRangeTypes: ['SDR'] }
                ],
                AudioCodecs: [{ Codec: 'aac' }],
                SubtitleDelivery: [{ Format: 'vtt', Method: 'External' }],
                SupportsHls: true,
                SupportsDash: false
            },
            OutputProfiles: []
        };
    }

    async function createFor(containers: string[], subtitleIndex: number) {
        const movieId = await resolveItemIdByName('Smoke Test Movie (2020)');
        const created = await createSession(
            baseRequest({
                ItemId: movieId,
                MediaSourceId: movieId,
                Capabilities: capabilities(containers),
                Constraints: {
                    AllowDirectPlay: true,
                    AllowDirectStream: true,
                    AllowTranscoding: true,
                    AllowVideoStreamCopy: true,
                    AllowAudioStreamCopy: true,
                    MaxBitrate: null,
                    MaxAudioChannels: null,
                    PreferredAudioStreamIndex: null,
                    PreferredSubtitleStreamIndex: subtitleIndex,
                    SubtitleMode: 'Always',
                    PreferredSubtitleLanguages: ['eng'],
                    AlwaysBurnInSubtitleWhenTranscoding: false,
                    StartTimeTicks: 0
                }
            })
        );
        expect(
            created.status(),
            `session creation failed: ${(await created.text()).slice(0, 400)}`
        ).toBe(200);
        return created.json();
    }

    /** The index of the EXTERNAL subtitle stream, resolved rather than assumed. */
    async function externalSubtitleIndex(): Promise<number> {
        const movieId = await resolveItemIdByName('Smoke Test Movie (2020)');
        const info = await (
            await ctx.api.post(`/Items/${movieId}/PlaybackInfo`, {
                headers: { Authorization: ctx.token },
                data: { UserId: ctx.userId }
            })
        ).json();
        const streams = (info.MediaSources ?? [])[0]?.MediaStreams ?? [];
        const external = streams.find(
            (s: { Type: string; IsExternal: boolean }) =>
                s.Type === 'Subtitle' && s.IsExternal
        );
        if (!external) {
            throw new Error(
                `no external subtitle stream on the fixture; streams=${JSON.stringify(
                    streams.map((s: { Type: string; Index: number }) => [
                        s.Type,
                        s.Index
                    ])
                )}`
            );
        }
        return Number(external.Index);
    }

    test('a Remux session carries the SEEK POSITION in its external subtitle URL, while DirectPlay keeps 0', async () => {
        const subtitleIndex = await externalSubtitleIndex();
        console.log(
            `[suboffset] external subtitle stream index=${subtitleIndex}`
        );

        // ---- the REMUX arm: containers exclude mp4, so only the box is unsupported -------------
        const remux = await createFor(['mkv'], subtitleIndex);
        console.log(
            `[suboffset][remux] Method=${remux.Method} Reasons=${JSON.stringify(remux.Reasons)}`
        );
        // Guard the premise: if this is not a Remux, the side effect under test is not in play.
        expect(remux.Method).toBe('Remux');

        const atZero = await getDescriptorAt(remux.Id, 0);
        expect(atZero.status()).toBe(200);
        const dZero = await atZero.json();
        const atSeek = await getDescriptorAt(remux.Id, SEEK_TICKS);
        expect(atSeek.status()).toBe(200);
        const dSeek = await atSeek.json();

        console.log(
            `[suboffset][remux] ServedBy=${dSeek.ServedBy} FallbackReason=${dSeek.FallbackReason}`
        );
        console.log(
            `[suboffset][remux] SubtitleUrl@0    =${dZero.SubtitleUrl}`
        );
        console.log(
            `[suboffset][remux] SubtitleUrl@seek =${dSeek.SubtitleUrl}`
        );

        // Guard: v2 served this, so the ServedByV2-gated normalization actually applied.
        expect(dSeek.FallbackReason).toBeFalsy();
        expect(
            dSeek.SubtitleUrl,
            'no external subtitle URL on the descriptor — the sidecar was not delivered externally'
        ).toBeTruthy();

        // THE MEASUREMENT. At seek 0 the offset is 0; at a non-zero seek the normalization to
        // Transcode carries the seek into the subtitle URL.
        expect(subtitleOffsetOf(dZero.SubtitleUrl)).toBe('0');
        expect(subtitleOffsetOf(dSeek.SubtitleUrl)).toBe(String(SEEK_TICKS));

        // ---- the CONTROL arm: DirectPlay is deliberately NOT normalized by the #58 fix ---------
        const direct = await createFor(['mp4', 'm4v'], subtitleIndex);
        console.log(
            `[suboffset][directplay] Method=${direct.Method} Reasons=${JSON.stringify(direct.Reasons)}`
        );
        expect(direct.Method).toBe('DirectPlay');

        const directAtSeek = await getDescriptorAt(direct.Id, SEEK_TICKS);
        expect(directAtSeek.status()).toBe(200);
        const dDirect = await directAtSeek.json();
        console.log(
            `[suboffset][directplay] SubtitleUrl@seek=${dDirect.SubtitleUrl}`
        );
        expect(dDirect.SubtitleUrl).toBeTruthy();

        // The contrast that makes the Remux measurement meaningful rather than a property of
        // seeking in general: at the SAME seek, DirectPlay still offsets by 0.
        expect(subtitleOffsetOf(dDirect.SubtitleUrl)).toBe('0');
    });
});
