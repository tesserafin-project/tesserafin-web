# Issue #43 — what the browser actually guarantees at teardown

Companion to `reefin`'s `docs/issue43-design-playback-session-lifecycle.md` §6. Everything
below was **measured**, not read off documentation, because the design's correctness depends
on knowing which of these signals can be relied on and the honest answer is "fewer than you
would hope".

## Method

A local Node HTTP server records every request it receives (method, session id, triggering
event, transport). A probe page registers `DELETE`-issuing handlers on `visibilitychange`,
`pagehide` and `beforeunload`, each issuing **two** requests — one plain `fetch`, one
`fetch(..., { keepalive: true })` — distinguished by a query parameter. Playwright then drives
real teardown scenarios against Chromium 1228 (bundled with `@playwright/test` 1.61.1).

The measurement is read **off the server's log, never off the page**. This distinction is the
whole point: a `fetch()` the page successfully *creates* during unload is indistinguishable,
from inside the page, from one that is created and then destroyed with the document. Only
arrival at the server proves delivery.

Harness: `teardown-measure.mjs` (run out-of-tree, scratchpad — it is a measurement, not a
shipped test). Each scenario waits 1.5 s after the teardown before judging a request absent.

## Results

| Scenario | plain `fetch` DELETE | `keepalive: true` DELETE |
|---|---|---|
| Navigate away (same tab) | delivered (`beforeunload`, `pagehide`, `visibilitychange`) | delivered (all three) |
| **Tab closed** | **dropped** | delivered (`pagehide`, `visibilitychange`) |
| **Browser process closed** | **dropped** | **dropped** |
| Hidden without unload (tab switch) | not sent | not sent |

Raw output:

```
navigate-away  ["beforeunload:plain","beforeunload:keepalive","pagehide:keepalive",
                "pagehide:plain","visibilitychange:keepalive","visibilitychange:plain"]
tab-close      ["pagehide:keepalive","visibilitychange:keepalive"]
browser-kill   []
hidden-only    []
```

## `navigator.sendBeacon` cannot do this at all

Probed directly in-page:

```
sendBeaconExists: true
sendBeaconArity: 1          // (url) — plus an optional data argument
sendBeaconAcceptsMethod: "no-method-parameter"
```

`sendBeacon` has **no method parameter**: it issues `POST`, always. The `Playback/Sessions`
teardown is `DELETE`. So `sendBeacon` is not a weaker alternative here — it is not an option.
Any design that reaches for it for this teardown is wrong at the API level, before
reliability is even discussed.

## What this means, stated without rounding up

1. **`keepalive: true` is mandatory, not an optimisation.** Tab close — an entirely ordinary
   way to stop watching something — drops the plain `fetch` and delivers the keepalive one.
   That single row is the difference between a teardown that usually works and one that
   usually does not.
2. **There is no guarantee.** Closing the browser delivered *nothing*, by either transport.
   No event and no transport survives process death. Any claim of guaranteed teardown is
   false, and the design does not make one.
3. **`beforeunload` adds nothing over `pagehide`.** It fired only in the scenario where
   `pagehide` also fired, and it is the event known to be skipped on bfcache eviction. It is
   not worth registering, and it carries a real cost (registering `beforeunload` can make a
   page ineligible for the back/forward cache).
4. **`pagehide` and `visibilitychange` both fired on tab close**, which is why the
   implementation listens to both and deduplicates rather than picking one.

### Caveat on the `hidden-only` row

Headless Chromium did not deliver a `visibilitychange` for a background tab in this harness,
so that row measures "the probe sent nothing", **not** "a real browser sends nothing when the
user switches tabs". On real mobile browsers `visibilitychange → hidden` is frequently the
*only* teardown signal delivered, and it fires on ordinary tab switches where playback is
still live.

This cuts against us rather than for us, so the implementation treats it as a hazard: the
`visibilitychange` handler only *flushes a teardown that is already owed*, and never initiates
one for a session still playing. A design that tore down on `hidden` would kill live playback
every time a mobile user switched apps.

## Consequence for the design

Client `DELETE` is a best-effort promptness optimisation. **Correctness rests on the server**:
`PlaybackSessionManager` reaps on `PlaybackStopped` and `TranscodingJobEnded`, with
`SweepExpired`'s 6 h TTL as the backstop that covers every case in the "dropped" column above.
</content>
