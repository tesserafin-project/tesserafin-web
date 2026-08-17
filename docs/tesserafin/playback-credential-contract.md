# Playback credential contract (S4)

The durable session access token travels in playback URLs. This document freezes what is proven,
what is contained here, and the contract a fix has to satisfy. It contains no credential, no URL and
no media path.

## What is proven

Measured against a production bundle served by a real Tesserafin server, driving real Direct Play and
a real software transcode:

1. **Disclosure.** The client wrote the complete playback URL to the browser console on every play,
   and the URL's `ApiKey` parameter is the page's own session access token — compared in memory
   against the token in the app's stored credentials. Two sinks did it unconditionally
   (`htmlVideoPlayer`, `htmlAudioPlayer`); three more printed the transcoding playlist URL on the
   live/HLS prefetch path.
2. **Structural exposure.** The credential is *in the URL* regardless of logging. The Web client puts
   it there for direct video/audio and for the audio `universal` endpoint; the server puts it there
   for the transcoding URL it returns in `PlaybackInfo`. Subtitle, fallback-font, attachment and
   trickplay URLs carry it too, and the trickplay one is written into a DOM style attribute.
3. **Privilege.** The server's `AuthorizationContext` accepts `ApiKey` (and, under legacy
   authorization, `api_key`) from the query string for **every** endpoint, not only media, and
   resolves it to the owning user's session. It is the same credential as the header token, not a
   media-scoped one. A draft advisory in this repository already records that a session token alone
   is enough to clear an ordinary account's password.
4. **Lifetime.** No expiry is applied when the token is resolved. It is invalidated by
   `POST /Sessions/Logout` or by deleting the device; nothing else ages it out.

## What S4-A contains

The console sinks only. After this change, both playback modes play with real bytes and advancing
`currentTime` while the number of console entries carrying the session credential is **zero**;
before it, each mode produced one. The structural exposure is untouched: **the credential still
travels in the URL**, and the loop that produced this document explicitly does not claim otherwise.

## What S4-B contains

S4-A removed the five playback sinks. S4-B closes the rest of the same class and stops it coming
back:

* `src/utils/fetch.js` printed the full URL on **six** paths — the request, the response with its
  status, the failure, and three inside `fetchWithTimeout`. `getFetchPromise` appends the query
  string to that URL before the request goes out, so an api-client call carrying `api_key`/`ApiKey`
  published the session credential on an ordinary request, with no playback involved. Those six now
  print the HTTP method, the status and an **endpoint category** — the first path segment and
  nothing else (`src/utils/urlCategory.ts`). No origin, no query string, no fragment, no identifier.
* `playbackmanager` printed `item.Url` when no player matched; it prints the item id instead.
* The sign-in page printed the `url` query parameter it had failed to decode — an
  attacker-supplyable redirect target arriving on the sign-in URL. The value is gone; the decode
  failure is the diagnosis.
* `scripts/verify-console-url-hygiene.mjs` is the permanent guard. It walks a TypeScript AST over
  `src/` and fails the build when any `console.*` is handed a URL-valued expression — including
  ``console.debug(`playing url: ${val}`)``, where only the prose says what the value is, so renaming
  the variable does not defeat it. A message that merely mentions the word does not fail. Exceptions
  live in `scripts/console-url-hygiene.allowlist.json` with a written reason and a class; an
  exception that stops matching fails the gate, so the file cannot rot into a blanket permission.
  Today there are six, all server **origins** (connection diagnostics) or in-app routes.
  `scripts/console-url-hygiene.test.mjs` proves the gate refuses the exact line #75 was opened
  about, and each shape it could return in.

## The disclosure is not playback-scoped

Found by the bundle scan above, and it is the larger finding of the two.

`jellyfin-apiclient@1.11.0` — a runtime dependency, present in the production bundle as
`node_modules.jellyfin-apiclient.bundle.js` — does this in `openWebSocket`:

```
var e = this.accessToken();
… url += "api_key=" + e; url += "&deviceId=" + this.deviceId();
console.log("opening web socket with url: " + url)
```

So the session access token is written to the console **on sign-in**, with no playback involved.
The same package also ships its own `ajax`/`fetchWithTimeout`/`ConnectionManager` copies of the
url-printing lines this repository just retired.

Consequences, stated plainly:

* The affected population is *everyone who signed in*, not *everyone who played something*. S4-A's
  framing — a disclosure on every play — understated it.
* Nothing in this repository fixes it. `overrides` pins versions; it does not rewrite a dependency's
  `console.log`. A patch mechanism (`patch-package` or a vendored fork) is a new install-time hook
  and a new supply-chain surface, and belongs in its own change with its own review, not on a P0
  branch that is otherwise clean.
* The bundle gate therefore **reports** dependency sinks on every run and **fails** only on ours.
  A gate that cannot be satisfied gets deleted; one that keeps saying the same true thing every run
  keeps the debt visible.

## Exposure assessment

**Measured on this tree, 2026-08-14.** The question is whether the console entry ever left the
browser.

* **No console capture exists in this client.** There is no `console` wrapping or reassignment, no
  `window.onerror` or `unhandledrejection` handler that records anything, and no error-boundary
  path that ships a payload.
* **No third-party error reporter or analytics is a dependency.** Neither `dependencies` nor
  `devDependencies` contains Sentry, Bugsnag, Rollbar, LogRocket, Datadog, PostHog, Mixpanel,
  Amplitude, Raygun, TrackJS or New Relic — none, under any name.
* **The server's client-log upload is never called.** `POST /ClientLog/Document` exists only as a
  generated SDK wrapper (`src/lib/tesserafin-sdk/generated/api/system-api.ts`) and as the
  `AllowClientLogUpload` server setting. No application code calls it, so no console content was
  written to the server's log directory by this client. The dashboard's log view reads the
  **server's** own logs; it never sees a browser console.

**Therefore there are no accessible traces to purge and no tokens to revoke on this evidence.** The
disclosure was confined to the browser console of the person signed in, where it was readable by
anyone with access to that session: devtools, a screen-share or recording, a browser extension with
console access, or a console dump pasted into a support thread. That is a real disclosure — it is
simply not one this client collected centrally.

Three limits, stated rather than glossed. The dependency sink above is **not fixed** — after this
change the shipped client still prints the token on sign-in, from `jellyfin-apiclient`. Operators
who deploy their own capture (a wrapper injected
by a reverse proxy, a browser extension, a managed-browser policy) are outside what this repository
can measure, and should treat playback-era console dumps as credential-bearing and re-authenticate
the affected users. And the console was never the only exposure: **the credential is still in the
URL**, so it still reaches reverse-proxy access logs and the network panel. That is the transport
defect, tracked separately from this one.

## Candidate contracts

| | A. keep token in URL, redact logs | B. HttpOnly cookie | C. short-lived playback capability | D. header injection (fetch/MSE/service worker) |
| --- | --- | --- | --- | --- |
| plain `<video>`/`<audio>` | yes | yes | yes | **no** — the element issues its own requests; MSE requires demuxing every container the product plays, a service worker adds an origin-scoped intercept the app does not have today |
| Range / seeking | yes | yes | yes | via MSE only |
| HLS manifest + child segments | yes | yes | yes if the capability is carried by the server into the URLs it emits | hls.js can attach headers, the native path cannot |
| cross-origin / CORS | yes | **fragile** — third-party cookie rules and `SameSite` break a separately-hosted server; needs `credentials: 'include'` and an explicit `Access-Control-Allow-Credentials` origin | yes | yes |
| logout / revocation | inherits session revocation | inherits session revocation | **must be explicit** — bind to the session and invalidate with it | inherits |
| long playback | yes | yes | needs renewal before expiry, and renewal must not fall back to the durable token | yes |
| concurrent sessions | yes | one cookie jar per browser profile; two accounts in one browser collide | yes, capability is per play session | yes |
| other clients (Android/TV) | unchanged | cookie handling differs per platform | unchanged if the capability is server-minted and optional | not portable |
| proxy / access logs | **fails** — the credential is the log line | not in the URL | short-lived value in the URL, still sensitive | not in the URL |
| replay / escalation | full account privilege if the URL leaks | cookie is not readable by script | bounded by scope and expiry, which must be documented | bounded by TLS |
| recovery without falling back | n/a | must not fall back to `ApiKey` on 401 | must not fall back to the durable token on expiry | must not fall back |

**A is containment only** and cannot be the boundary: it leaves a full-privilege credential in
reverse-proxy logs, browser history and referrers.

**Recommended: C**, with B as the fallback for deployments that terminate on the same origin.

### If C is selected, the capability must be

* unusable as authentication for the general API — rejected by `AuthorizationContext` for anything
  outside media delivery, which is a server change, not a client convention;
* bound to the user **and** the play session, and to the smallest workable media scope (item plus
  media source);
* short-lived with an explicit expiry, and renewable only through an authenticated call that carries
  the durable token in a header — never in a URL;
* invalidated when the owning session ends (logout, device deletion, password change);
* usable by manifests, child segments, range requests, subtitles, fonts, attachments and trickplay
  images, or those paths keep the old exposure;
* documented as sensitive in logs: short-lived is not non-sensitive;
* explicit about replay: within its lifetime, anyone holding it can fetch that media.

**Contract impact.** C needs a server endpoint or DTO, so it changes the canonical OpenAPI surface
and the generated SDK, and must be sequenced **after** R1-P's reconciliation of those files. S4-A
changes none of them.

## C is selected, and A0 built it

**Decided.** C is the transport, with B retained only as a bounded same-origin mode. R1-P's
reconciliation landed (server master `3700ed42`, web `ade4fa52`), so the sequencing constraint above
is satisfied and #153-A0 implemented the server primitives against it. **A0-R1 then repaired four
defects in that implementation, and A0-R2 a fifth**, so the accepted server source is now
`d3c02e46`. Both `3c12e19f` (A0) and `d57d780a` (R1) are superseded evidence, for the reasons
findings 2 and 6 below record.

The authoritative server contract — TTLs, renewal window, scope set, query parameter names, error
vocabulary, revocation seams, restart behaviour and the multi-instance limit — lives in the **server**
repository at `docs/playback-credential-server-contract.md`. It is not duplicated here, because two
copies of a frozen contract drift and the server's is the one the code has to satisfy. The summary:

| | |
|---|---|
| playback capability | `playbackCapability`, 15 min, renewable only in its final 5 min |
| WebSocket ticket | `webSocketTicket`, 30 s, one successful consumption |
| entropy | 256 bits, SHA-256 verifier at rest, presented value never stored |
| bound to | user, session, device, play session, item, media source, scope set — compared **exactly**, in both directions, since A0-R1 |
| revoked by | logout, device deletion, password change, session end, play-session end |
| restart | in-memory, so both die with the process — matching sessions, which already do |

### Seven things A0, and its R1, R2 and R3 repairs, measured that this document did not know

**1. The web client does not build the credential URL.** Every `ApiKey=`/`api_key=` occurrence under
`src/` is a *comment describing* the defect — including the ones in this document's own supporting
files. The construction is inside `jellyfin-apiclient`, a prebuilt dependency bundle, in `getUrl` and
`openWebSocket`. There is no web line to edit that would change the transport, which is why A0 is
server-only and why the eventual migration has to go through the dependency.

**2. The primary direct-stream routes were not authorization-gated at all — and that was a live
disclosure, not a scoping note.** `GetVideoStream` and `GetAudioStream` carried no `[Authorize]`,
and the server sets `DefaultPolicy` with no `FallbackPolicy`, so an endpoint without `[Authorize]`
is genuinely anonymous. A0 read this as a compatibility constraint and made the capability *narrow*
a presented credential on those routes rather than become required, on the grounds that requiring
it would reject requests that succeed today.

R1 measured what those requests actually were. Against a real seeded item, with **no credential of
any kind**:

```
GET  /Videos/{id}/stream?static=true          -> 200, the source file byte for byte
GET  /Audio/{id}/stream?static=true           -> 200, the source file byte for byte
GET  /Videos/{id}/stream (Range: bytes=0-15)  -> 206
HEAD /Videos/{id}/stream?static=true          -> 200, the real Content-Length
GET  /Videos/{id}/{ms}/Subtitles/2/Stream.vtt -> 200, the real cue text
```

Fourteen endpoints in all, counting the `GET`/`HEAD` pairs, the two legacy HLS segment families and
the attachment route; plus two Live TV stream routes anonymous for the same reason. The requests
A0 declined to reject were requests carrying no credential. **R1 requires the policy on all
fourteen**, which costs no compatibility: the routes that already carried it answer identically
with the token in the `ApiKey` query parameter, because `AuthorizationContext` reads that key
before the endpoint is known. This is reported separately as a P0 against `master`, since the
disclosure predates A0 and exists in every image built from it.

**3. Fourteen HLS routes are invisible to the contract.** `DynamicHlsController` and
`HlsSegmentController` are both `[ApiExplorerSettings(IgnoreApi = true)]`, so `master.m3u8`,
`main.m3u8`, `live.m3u8` and every segment route appear nowhere in `openapi/openapi.json`. The
OpenAPI diff for A0 is therefore **not** the list of routes the capability protects. R1's route
inventory reads `EndpointDataSource` rather than controller `MethodInfo` for exactly this reason —
`ApiExplorerSettings` hides an endpoint from the explorer, not from routing — and counts the two
controllers by `ControllerActionDescriptor.ControllerTypeInfo`, which is what settles the figure at
fourteen against actual metadata.

**4. No behavioural test can prove the general-API boundary on its own.** A capability presented to
`/Items` is refused today because the value is not a device token, not because the boundary held. A
hostile control that taught `AuthorizationContext` to read `playbackCapability` — the one change that
would make a capability a general-API credential — left the integration suite green. The boundary is
now held by a gate that asserts the query keys that path may read are exactly `{ApiKey, api_key}`.

**5. A0's own evidence could not see A0's own defects.** The most important measurement R1 made is
about the evidence rather than the code. With the anonymous direct-video hole reopened as a hostile
control, **all eighty of A0's own tests stayed green** — the structural route table (26), the
credential primitives in isolation (45), and the nine general-endpoint requests. The structural test
cannot see it: removing a policy adds no offender to its "outside the inventory" sweep, and its
per-route theory only asks whether the `[RequiresPlaybackCapability]` attribute is present, which it
still is. R1's request-level matrix and endpoint-metadata inventory both go red on the same
mutation. This is finding 4 one level up: evidence passing for a reason unrelated to the property it
claims to prove.

R1 also found that binding was compared only when the capability *and* the route both named
something, so a capability minted for one item satisfied every route that did not name one; and that
minting validated nothing at all — any item id, any media source, any play session, any integer in
the scopes array. Both are repaired, and both now have request-level evidence.

**6. The WebSocket ticket authenticated the handshake and produced a socket nobody could use.**
*New in R2, and only visible through the real upgrade pipeline.* A ticket-only upgrade completed —
the socket reported `Open` — and was then torn down: the session listener's watchlist stayed empty
and the first send failed with *"The remote end closed the connection"*. The durable-token upgrade
was unaffected.

`WebSocketManager.AuthenticateUpgrade` returned an `AuthorizationInfo` and left `context.User`
anonymous, while every WebSocket listener re-derives its session from the **principal**:
`SessionWebSocketListener.ProcessWebSocketConnectedAsync` calls
`RequestHelpers.GetSession(httpContext)`, which reads the user id, client, version, device id and
device name off `context.User`. With an anonymous principal that resolves nothing and throws. The
durable-token path never hit it because the authentication middleware had already populated the
principal by the time the upgrade ran.

The primitive tests could not see this, and neither could the contract: `ConsumeWebSocketTicket`
was correct in every respect. What was missing was everything downstream of consumption. The fix
builds the same internal claims a durable token produces, sourced from the session the ticket
names — a session is identified downstream by `(deviceId, client, version)`, so guessing would have
attached the socket to a *different* session from the one the ticket is bound to.

Two of R2's own tests were also wrong, and hostile controls said so. A replay test that closed the
socket before replaying was refused by session revocation rather than by single-use consumption, so
it would have passed against a store with no single-use guarantee at all. And logout turned out to
revoke through **two** seams — `RevokeDevice` in `Logout` and `RevokeSession` in `OnSessionEnded` —
so no single-seam mutation could ever be anything but inert. That redundancy is deliberate and the
source says so; it is recorded here because "the control removes two calls" should read as
necessity, not convenience.

**7. R2's own repair treated consumption as redemption, and the socket attached to whatever session
the empty claims happened to name.** *New in R3.* R2 resolved the ticket's session with
`Sessions.FirstOrDefault(...)` and then read its client, version and device name through `?.`. A
ticket naming a session that is **no longer live** therefore produced an *authenticated* connection
carrying three empty strings — and an empty client plus an empty device id is a perfectly usable
session key, because `RequestHelpers.GetSession` rebuilds the key from exactly those claims and
`LogSessionActivity` **creates** a session when the key it is handed matches none. The same shape
held for a user id that no longer resolved, and nothing compared the ticket's own bindings against
the session it named, so a live ticket could name a live session belonging to a different user or a
different device.

A consumed ticket proves only that the value was minted, has not expired and has not been used.
R3 requires four things after consumption and before the socket is accepted: the session must be
live, the user must still resolve, the session's device must be the ticket's device, and the
session's user must be the ticket's user. Every failure refuses; none falls back to the durable
token; the ticket stays spent. Client, version, device id and device name now come from the resolved
session only — nothing in the identity comes from the request.

R3 also found that the two authentication paths had each written their own copy of the nine-claim
list, and that the copies **had already drifted**: `CustomAuthenticationHandler` emitted
`Tesserafin-UserId` as `Guid.Empty` formatted `"N"` when no user resolved, while the ticket path
emitted an empty string. There is now a single `AuthorizationInfo` → `ClaimsIdentity` projector,
shared by both; a caller decides only the authentication scheme.

**The instrument mattered more than the tests.** R2 graded acceptance on the session listener's
watchlist. That watchlist is populated inside `KeepAliveWebSocket`, *downstream* of
`RequestHelpers.GetSession`, so a socket that **is** accepted and then dies resolving its session
leaves it untouched and is indistinguishable from a refusal — which is the exact shape every one of
R3's cases produces. Graded on the watchlist alone, every hostile control would have been inert.
R3 added a recorder that runs inside the same listener loop, before anything can throw, so
"did `AcceptWebSocketAsync` return" is answered unconditionally. This is finding 5 a third time:
evidence that passes for a reason unrelated to the property it claims to prove.

Three of R3's ten cases were **already green** against R2's candidate — exact-session attachment,
request-override refusal, and principal parity. They are recorded as regression guards, not as
defect proofs; their whole evidentiary value is that three hostile controls turn them red.

### What is still true

The credential is **still in the URL** after A0 and after R1, R2 and R3. The primitives exist and are proven;
no runtime consumer uses them yet, and #153 stays open until the web players and the WebSocket
client migrate. Nothing here claims the exposure is closed. R1 closed a *different* exposure that
was open the whole time.

**Reserved to A1, and not proven here:** renewal across a long read — that a capability survives a
playback longer than its fifteen-minute lifetime by renewing inside its final five minutes, against
a real long read rather than a hand-moved clock. R1 proves the renewal window at the primitive and
HTTP levels only.

## Classification

* **Proven, with evidence:** disclosure to the console (fixed here); the credential in the URL; its
  general-API privilege; the absence of an expiry check.
* **Demonstrated prerequisites:** to *see* the console entry, an attacker needs access to the
  browser session (devtools, a screen-share, an extension, or a support dump). Reading it from a
  reverse-proxy access log needs access to that log.
* **Measured and negative:** central collection of the console. No capture path, no reporter
  dependency, no call to the server's client-log upload — see *Exposure assessment* above.
* **Plausible but unproven here:** referrer leakage and cache/history retention. Neither was
  measured, and neither is claimed.
* **Not claimed:** remote compromise. Nothing here shows an unauthenticated remote path to the
  credential.

Server #241 already documents query-string credentials publicly as a proxy-log constraint, so the
*existence* of the pattern is not secret. What is new is the console sink and the measured privilege
of the value. Recommended handling: a **public issue** for the structural transport change, because
the pattern is already public and the fix needs open design; the console disclosure is fixed in the
same change and does not need an embargo of its own.
