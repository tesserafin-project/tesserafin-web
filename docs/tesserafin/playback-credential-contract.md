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

## Classification

* **Proven, with evidence:** disclosure to the console (fixed here); the credential in the URL; its
  general-API privilege; the absence of an expiry check.
* **Demonstrated prerequisites:** to *see* the console entry, an attacker needs access to the
  browser session (devtools, a screen-share, an extension, or a support dump). Reading it from a
  reverse-proxy access log needs access to that log.
* **Plausible but unproven here:** referrer leakage, cache/history retention, third-party error
  reporters. None was measured, and none is claimed.
* **Not claimed:** remote compromise. Nothing here shows an unauthenticated remote path to the
  credential.

Server #241 already documents query-string credentials publicly as a proxy-log constraint, so the
*existence* of the pattern is not secret. What is new is the console sink and the measured privilege
of the value. Recommended handling: a **public issue** for the structural transport change, because
the pattern is already public and the fix needs open design; the console disclosure is fixed in the
same change and does not need an embargo of its own.
