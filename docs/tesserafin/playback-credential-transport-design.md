# #153-A1 — the Web credential transport, frozen

What the Web runtime does after A1: `playbackCapability` on every media-delivery URL,
`webSocketTicket` on every socket upgrade, and the durable session token only in an `Authorization`
header, only when minting or renewing. No `ApiKey`/`api_key` fallback anywhere on those paths.

This document freezes the design. `ci/credential-transport-inventory.mjs` is the gate that proves
the inventory it was designed against is still the inventory in the tree.

## 1. What Phase 0 measured

Twenty-two producer categories and four executable absence assertions, over first-party `src/`, the
generated SDK, the installed `jellyfin-apiclient` bundle and the production bundle; plus a real
203-request trace against a booted server with the production bundle
(`tests/playbackCredential/baselineTrace.spec.ts`).

Five first-party URL construction sites put the durable token into a URL:

| site | family | scope | item | media source | play session |
|---|---|---|---|---|---|
| `playbackmanager.js` `getAudioStreamUrl` | `/Audio/{id}/universal` | `Media` | yes | **not named** | client-invented counter, built **before** any PlaybackInfo call |
| `playbackmanager.js` `createStreamInfo` direct branch | `/{Videos,Audio}/{id}/stream.{c}` | `Media` | yes | `mediaSource.Id` | from PlaybackInfo |
| `apps/legacy/.../playback/video/index.js` | trickplay `.jpg`, written into a **CSS `background-image`** | `Trickplay` | yes | yes | player state |
| `htmlVideoPlayer/plugin.js` | `/FallbackFont/Fonts` | `Fonts` | **none** | **none** | player state |
| `htmlVideoPlayer/plugin.js` | `/FallbackFont/Fonts/{name}` | `Fonts` | **none** | **none** | player state |

Four URL families are produced by the **server** and consumed verbatim:

| producer | credential today | consumer |
|---|---|---|
| `MediaInfoHelper` → `StreamInfo.ToUrl(base, token, …)` → `MediaSource.TranscodingUrl` | `api_key=` | `apiClient.getUrl(mediaSource.TranscodingUrl)` |
| `StreamInfo.GetSubtitleStreamInfo` (`info.Url += "?ApiKey=" + accessToken`) | `ApiKey=` | `getSubtitleUrl()`, `<track src>`, libass `subUrl` |
| `MediaInfoHelper` attachment `DeliveryUrl` | **none at all** | `apiClient.getUrl(i.DeliveryUrl)` → libass fonts |
| `DynamicHlsController` playlist bodies (`Request.QueryString` echoed verbatim) | inherits the parent's | hls.js / native player |

Two consequences, both confirmed at runtime rather than reasoned:

* **HLS children inherit.** `hls1/main/0.mp4` carried exactly the master's query key set plus
  `actualSegmentLengthTicks,runtimeTicks`. A capability presented on the playlist request reaches
  every segment with no per-segment minting — and the capability secret therefore appears in a
  playlist BODY.
* **Range/HEAD is not browser-only.** `htmlAudioPlayer.enableHlsPlayer` issues a first-party `HEAD`
  through `utils/fetch` against the media URL to sniff `Content-Type`. The same capability has to
  satisfy the HEAD, the browser's Range GET and the plain GET.

**Attachments are broken on `main`**: A0 put `Policies.MediaDelivery` on the attachment route while
the Web fetches it with no credential at all. A1's `Attachments` capability is what repairs it.

## 2. Contract coverage — no extension required

Every family the Web actually uses is expressible by the merged A0 contract:

| family | demand | expressible |
|---|---|---|
| direct video/audio, HLS master/variant/segment | `Media` + item + media source | yes |
| universal audio | `Media` + item, media source `null`, the client's own `PlaySessionId` | yes — `PlaySessionId` is `[Required]` at mint but any string is accepted, and the demand refuses only on **mismatch** |
| legacy HLS (`/Videos/{id}/hls/main/0.ts`) | `Media` + item + media source **`null`** | yes — a **separate** null-media-source capability, never a widened one |
| subtitles + subtitle playlist | `Subtitles` + item + media source | yes |
| attachments | `Attachments` + item + media source | yes |
| trickplay tiles + playlist | `Trickplay` + item + media source | yes |
| fallback fonts | `Fonts`, **item-less** | yes — the only item-less scope, exactly as designed |
| WebSocket upgrade | `WebSocketTicketsApi` | yes |

**Live TV is out of scope, by the server's own design.** `/LiveTv/LiveRecordings/{id}/stream` and
`/LiveTv/LiveStreamFiles/{id}/stream.{c}` carry plain `[Authorize]`, deliberately not
`Policies.MediaDelivery`, and the A0 contract document says migrating them "belongs to the phase
that models it". The Web runtime does not reach them: no first-party producer, no caller of the
generated operations, and zero `livetv-delivery` requests in a real session. The only branch that
could turn a server-supplied `mediaSource.Path` into a request is gated by
`RequiredHttpHeaders.length`, and every live source whose `Path` is a `LiveStreamFiles` URL either
sets a `User-Agent` there (`M3UTunerHost`) or ships `SupportsDirectPlay = false` (`HdHomerunHost`).

**Limitation, stated rather than implied:** the web-side assertion is *structural* — it proves the
gate still exists in Web source. The condition that closes the hole lives in server code the Web
gate cannot see, and no tuner-backed runtime probe was run.

## 3. The async seam

`ApiClient.getUrl(name, params, serverAddress)` is synchronous string building. Minting is a network
round trip. Nothing asynchronous is hidden inside `getUrl`.

Instead: **mint at the existing asynchronous playback boundary, then pass an already-minted
credential into the synchronous builder as an ordinary query parameter.**

The boundaries that already exist:

* `playbackmanager.js` `createStreamInfo` runs inside `playInternal`, after the `PlaybackInfo`
  round trip resolves — item, media source and play session are all in hand.
* `getAudioStreamUrl` runs before any `PlaybackInfo` call, but its caller chain is promise-based and
  it invents its own `PlaySessionId`; the mint is awaited by the caller and the value threaded in.
* `htmlVideoPlayer` font loading is already inside `import('@jellyfin/libass-wasm').then(...)` and
  `Promise.all([...]).then(...)`.
* the trickplay thumb builder runs inside the scrubber handler; its capability is minted once when
  the player opens, not per thumb.

## 4. Per-instance ownership — no global provider

The broker is created **per `ApiClient`**, on the seam that already exists:
`connectionManager.js` caches `apiClient._sdk` (`@jellyfin/sdk`) and `apiClient._tesserafinSdk`
(`TesserafinApi`) and calls `.update()` on both at every re-login/token-refresh point.
`ServerConnections`'s `apiclientcreated` handler is where the broker is attached.

The broker mints through the **generated** `PlaybackCredentialsApi` and `WebSocketTicketsApi`, built
from `TesserafinApi.configuration` — which puts the durable token in the `Authorization` header and
nowhere else. No endpoint path or DTO shape is re-declared.

Two servers, two users or two `ApiClient` instances therefore cannot share a credential: they cannot
even reach each other's broker.

## 5. Cache identity

A cached capability is reused only when **every** authority-bearing dimension matches:

```
serverId | userId | sessionEpoch | deviceId | playSessionId | itemId(|null) | mediaSourceId(|null) | canonical sorted scope set
```

* `sessionEpoch` is a per-broker counter bumped whenever the observed access token changes. The
  token itself is never put in a key: a key is a string that can end up in a diagnostic.
* `null` is a **value**, not a wildcard — `itemId=null` and `itemId=<guid>` are different keys,
  matching the server's demand comparison where a null on the route side REFUSES a bound capability.
* the scope set is canonicalised (sorted, de-duplicated) so `[Media]` and `[Media,Media]` are one key
  and `[Media,Subtitles]` is a different one.

Dropping any single dimension is independently detectable, and Phase 4 mutates each one on its own.

Capabilities live in a `Map` on the broker instance. They are never written to `localStorage`,
IndexedDB, the credential store, the URL history or any persisted application state.

## 6. Scope minimisation

Each URL family mints the **narrowest** capability that family needs. There is no shared
`[Media,Subtitles,Attachments,Trickplay]` grant:

| family | scopes | item | media source |
|---|---|---|---|
| direct video/audio, HLS, universal audio | `[Media]` | the item | the media source, or `null` for universal audio |
| legacy HLS | `[Media]` | the item | **`null`** — a separate capability |
| subtitles | `[Subtitles]` | the item | the media source |
| attachments | `[Attachments]` | the item | the media source |
| trickplay | `[Trickplay]` | the item | the media source |
| fallback fonts | `[Fonts]` | **omitted** | **omitted** |

## 7. Renewal

The secret **does not rotate**. `renewPlaybackCapability` extends the same capability in place, so
the URL already handed to a media element stays valid and is never rebuilt.

* renewal is scheduled to fire only inside the **final five minutes** before `ExpiresAt`. Renewing
  earlier is a defect, not an optimisation, and the server answers
  `PlaybackCapabilityRenewalTooEarly` (400) if it is attempted.
* on renewal refusal or expiry the broker **fails closed**: the capability is dropped from the cache,
  its timer is cancelled, and the existing playback failure path surfaces honestly.
* there is no path that rebuilds a URL with `ApiKey`, and no path that mints using a URL credential —
  minting always authenticates in the header.

Timers are cancelled and capabilities dropped on: playback end, logout, server change, user change,
session change (token change), device change, and failed initialisation.

## 8. WebSocket

Measured baseline: **two physical upgrade attempts per ordinary session** — one carrying no query at
all (the sdk builds the socket URI before a token exists and axios drops the empty parameter) and one
carrying `ApiKey`.

All socket traffic goes through `@jellyfin/sdk`. `ServerConnections` already binds
`apiClient.subscribe = apiClient._sdk.subscribe.bind(apiClient._sdk)`, and `jellyfin-apiclient`'s own
`openWebSocket` has **zero first-party callers** — it is dead code in this app.

The design is two-layered, deliberately:

1. **A first-party socket service, injected per instance.** `Api.subscribe()` reads
   `if (!this.webSocket) { this.webSocket = new WebSocketService(...) }`, so assigning
   `api.webSocket` before the first subscribe diverts every caller — both `apiClient.subscribe(...)`
   and the direct `api.subscribe(...)` sites in hooks — onto code this repository owns. The mint then
   happens inside our own connect routine, so **every physical attempt**, first connect and every
   backoff retry alike, gets a fresh ticket by construction.

   This is what makes the "reuse a consumed ticket during reconnect" hostile control reach its
   assertion at all: `@jellyfin/sdk`'s `WebSocketService` reconnects from the **stored** `this.url`,
   so if that path were left in charge the control would be inert.

2. **The dependency can no longer build a credential-bearing socket URL.** The injection is a
   behavioural change; a bypass of it must not silently fall back to the durable token. Both packages
   are therefore patched:
   * `jellyfin-apiclient` — the existing repository-owned transform gains one anchor: the
     `?api_key=` fragment in `openWebSocket`. It is dead code, so it is replaced by a refusal.
   * `@jellyfin/sdk` — a **second** repository-owned transform, `scripts/patch-jellyfin-sdk.mjs`,
     removes the `{ [AUTHORIZATION_PARAMETER]: this.accessToken }` argument from the two socket URI
     constructions in `lib/api.js`.

   **This is an expansion of the dependency boundary the issue described**, which contemplated one
   patcher for one package. It is stated here rather than folded into the existing script: a second
   package, a second pinned version, a second pristine/patched hash pair. Both transforms keep the
   same properties — deterministic, idempotent, exact-anchor, hash-closed, failure-closed, verified
   against both the installed file and the production bundle — and neither introduces an install-time
   dependency.

Ticket rules, enforced by the first-party service:

* one ticket per physical upgrade attempt; a reconnect mints another;
* concurrent attempts never share a ticket;
* a refused, expired or consumed ticket is a failure, never a fallback;
* an attempt cancelled before the upgrade discards its ticket;
* an attempt made with no access token mints nothing — a credential-less attempt must not consume a
  ticket.

## 9. Fixtures — why no server branch

`ci/serve-e2e.sh` seeds four fixtures (H264+AAC mp4 with an `.en.srt`, MPEG-4 Part 2/AC-3 mp4, MKV
remux). Direct audio, universal audio, attachments, trickplay and fallback fonts have no fixture, and
the baseline trace shows it: only direct video, HLS and one subtitle were reached.

Editing the rig would mean a **server branch** and the whole server gate set. It is not necessary:
the rig and the browser run on the same host, and the server exposes everything needed through its
public API. The browser matrix therefore seeds its own fixtures — ffmpeg-generated media written to a
temp directory, added with `POST /Library/VirtualFolders`, with encoding configuration adjusted
through `POST /System/Configuration/encoding` for the fallback font path.

**Zero server files change in A1.**

## 10. What A1 does not do

* It does not migrate Live TV delivery. Those routes stay on the durable token, unmodelled, exactly
  as A0 left them.
* It does not touch `/Items/{id}/Download`, a general-API route where `AuthorizationContext` reads
  `ApiKey` by design and where a playback capability must never work.
* It does not change OpenAPI, the generated SDK, or SDK provenance.
* It does not claim short-lived URL credentials are safe to disclose. They are shorter-lived and
  narrower, and they still appear in playlist bodies, DOM attributes and CSS.
