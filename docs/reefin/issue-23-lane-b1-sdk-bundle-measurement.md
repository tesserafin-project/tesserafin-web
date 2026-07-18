# Issue #23 — LANE B item 1: exact webpack measurement of `src/lib/reefin-sdk` in the main bundle

Measurement only. Every source edit below was applied, built, measured, and **reverted**; the
worktree's `src/` is byte-identical to `origin/main`. Nothing merged, budget never raised.

All numbers are **raw minified bytes of `dist/main.jellyfin.bundle.js`** — the exact currency
`webpack.performance-budget.json` and `scripts/verify-bundle-budget.mjs` enforce. Reproduced on
`origin/main` in worktree `perf/sdk-bundle-eviction`.

## TL;DR

1. **Two premises from issue #41 are empirically false.** The barrel is *not* dragging the whole
   SDK into main (tree-shaking already works — 34 of 47 generated API classes are entirely absent),
   and `routes/home.tsx` / `routes/index.tsx` are **already in lazy chunks** and cost main nothing.
2. **The stated baseline is stale.** Measured **443189 bytes**, not 435017. Real margin is
   **17611 bytes (17.2 KiB)**, so **13109 bytes** must go to reach a 30 KiB margin.
3. **The levers are conjunctive, not additive** — this is the central finding. Two independent
   eager anchors each pull the *same* concatenated `generated/api.ts + 49 modules` scope into main.
   Removing either one alone is nearly worthless (1780 B / 9082 B). Removing **both**
   frees **70707 bytes**.
4. **30 KiB is reachable — but only via the combination.** Combined levers leave the main bundle at
   **372482 bytes**, a margin of **88318 bytes (86.2 KiB)**, ~6.7x the 13109 required.

## Budget arithmetic

| Quantity | Bytes | KiB |
| --- | ---: | ---: |
| Budget (`webpack.performance-budget.json`) | 460800 | 450.0 |
| **Measured baseline** `main.jellyfin.bundle.js` | **443189** | **432.8** |
| Current real margin | 17611 | 17.2 |
| Target margin | 30720 | 30.0 |
| Max bundle size to hit target | 430080 | 420.0 |
| **Must shave** | **13109** | **12.8** |

### On the stale baseline

Issue #41 carried 435017 bytes / ~25.2 KiB margin. A fresh `origin/main` production build gives
**443189**. The two reconcile: #41's own "needs ~13706 more bytes" implies a baseline near 443786,
matching the measured 443189 to within ~600 bytes. **The ~13 KiB gap is real; the 435017 figure is
not.** Everything below uses 443189.

## Method — and why the obvious methods give wrong answers

- **Stats module `size` is useless here.** `webpack --json` reports the concatenated
  `generated/api.ts + 49 modules` at **1767552 bytes** — *pre-minification* source that terser then
  almost entirely deletes. Quoting it would overstate recoverable bytes ~28x.
- **Grepping for class names is useless here.** Terser mangles them; `MovieApi` is absent from the
  minified text whether or not its code is present.
- **What works — endpoint string literals.** URL paths are not manglable. Probing each generated
  API class's `localVarPath` literals against the minified bundle gives a reliable verdict, and is
  **self-validating**: the classes known to be used hit *every* probe. It was further confirmed
  end-to-end — the combined-lever build drove `/Items/Counts`, `/Shows/NextUp`,
  `/UserViews/GroupingOptions`, `/System/Configuration`, `/Playback/Sessions` all from 1 → 0.
- **Byte deltas come only from real rebuilds**, never from stats.
- **A control build was run.** The throwaway `webpack.measure.js` (prod + different `output.path` +
  `performance.hints:false`) on unmodified source reproduced **443189 exactly**, proving the
  measurement rig itself is byte-neutral.

Temporary helpers used (not for merge): `scripts/check-sdk-presence.mjs`,
`scripts/analyze-sdk-stats.mjs`, `scripts/_stub-reefin-sdk.js`, `webpack.stubsdk.js`,
`webpack.measure.js`.

## Finding 1 — tree-shaking already works

Per-class endpoint-literal probe against `dist/main.jellyfin.bundle.js`:

| Generated API class | In main bundle? | Evidence |
| --- | --- | --- |
| `system-api.ts` | **PRESENT** | 16/16 path literals hit |
| `library-api.ts` | **PRESENT** | 15/15 path literals hit |
| `show-api.ts` | **PRESENT** | 2/2 (`/Shows/NextUp`, `/Shows/Upcoming`) |
| `user-view-api.ts` | **PRESENT** | 2/2 (`/UserViews`, `/UserViews/GroupingOptions`) |
| `playback-api.ts` | **PRESENT** | 1/1 (`/Playback/Sessions`) |
| `live-tv-api.ts` (23 probes) | absent | 0 hits |
| `sync-play-api.ts` (22 probes) | absent | 0 hits |
| `authentication-api.ts` (11 probes) | absent | 0 hits |
| `item-lookup-api.ts` (10 probes) | absent | 0 hits |
| `movie-api`, `video-api`, `audio-api`, `image-api`, `session-api`, `plugin-api`, `startup-api`, `user-api`, … | absent | 0 hits |

**34 of 47 classes are gone entirely.** Rows showing `hits=1` on generic prefixes (`/Artists`,
`/Sessions`, `/Trailers`, `/Collections`, `/UserItems`) are **substring collisions** with unrelated
`jellyfin-apiclient` code, not real retention.

So **"import a narrow generated path instead of the barrel" recovers almost nothing on its own** —
the unused classes are already dropped. Measured: **1780 bytes** (see Levers).

## Finding 2 — the issuer table (reachability, not additive bytes)

Bytes are **not** additive per issuer: 19 issuer entries share the same few SDK modules, so removing
one frees nothing unless it is the *last eager* reference. The table is keyed on **which chunk the
issuer lives in**, which is what actually determines main-bundle cost.

| Issuer | Chunk | Pulls from SDK | Kind | Recoverable? |
| --- | --- | --- | --- | --- |
| `utils/jellyfin-apiclient/compat.ts` | **main.jellyfin** | `REEFIN_CLIENT_IDENTITY`, `ReefinApi`, `ReefinSdk` | **value** | **ANCHOR 1** |
| `lib/jellyfin-apiclient/ServerConnections.js (+4)` | **main.jellyfin** | barrel (via `compat.ts`) | value | anchor 1 |
| `components/playback/playbackmanager.js (+10)` | **main.jellyfin** | barrel (via `playbackSessionV2Url`) | value | **ANCHOR 2** |
| `scripts/playbackSessionV2Url.ts` | **main.jellyfin** | `Configuration`, **`PlaybackApi`**, 2 enums | **value** | anchor 2 |
| `scripts/reefinPlaybackCapabilities.ts` | **main.jellyfin** | 4 enums (+ ~10 types) | value (enums) | rides anchor 2 |
| `scripts/playbackSessionShadowTrigger.ts` | **main.jellyfin** | — (defers to lazy shadow) | — | already done (PR #21) |
| `hooks/useApi.tsx` | main.jellyfin | `ReefinApi` | **type-only** | zero cost already |
| `scripts/playbackSessionShadow.ts` | `playback-shadow` | client + models | value | already lazy |
| `apps/dashboard/routes/index.tsx (+28)` | `index` | barrel | value | **already lazy** |
| `apps/dashboard/features/storage/api/useSystemStorage.ts` | `index` | `getSystemApi`, `ReefinApi` | value+type | already lazy |
| `apps/dashboard/features/storage/components/StorageListItem.tsx` | `index` | `FolderStorageDto` | type-only | zero |
| `apps/dashboard/features/storage/utils/space.ts` | `index` | `FolderStorageDto` | type-only | zero |
| `apps/dashboard/routes/playback/diagnostics.tsx (+18)` | `playback-diagnostics` | barrel | value | **already lazy** |
| `apps/dashboard/features/playback/api/playbackDiagnosticsApi.ts` | `playback-diagnostics` | `Configuration`, `SystemApi` | value | already lazy |
| `apps/dashboard/features/playback/api/types.ts` | `playback-diagnostics` | ~14 `PlaybackDecision*` | **type-only** | zero |
| `apps/dashboard/features/playback/utils/compareClientCapabilities.ts` | `playback-diagnostics` | 6 `PlaybackDecision*` | **type-only** | zero |
| `apps/modern/routes/home.tsx (+11)` | `#4738` | `BaseItemKind` | value (enum) | **already lazy** |
| `apps/modern/features/home/api/{useFavoriteItems,useLatestMedia,useNextUp,useResumeItems,useUserViews}.ts` | `#4738` | `getLibraryApi`/`getShowApi`/`getUserViewApi`, enums | value | already lazy |
| `apps/modern/features/home/{components/FavoritesTab.tsx,components/HomeTab.tsx,utils/mediaCardProps.ts,utils/latestMediaViews.ts}` | `#4738` | `BaseItemKind`/`CollectionType`/`ImageType` + types | value/type | already lazy |

**Only two independent anchor paths keep the SDK in main.** 13 of the 19 issuer entries are already
in lazy chunks — including `routes/home.tsx` and `routes/index.tsx`, both cited in #41 as the
problem. Lazy-loading them recovers **zero**; that work is already done.

## Finding 3 — the real mechanism

Every generated API module sits inside one webpack-concatenated scope,
`./lib/reefin-sdk/generated/api.ts + 49 modules`, reached by `harmony side effect evaluation`
(there is **no `sideEffects` field** anywhere in `package.json`). Whichever chunk that scope is
placed in must carry the code of every class any chunk uses. Two eager main-bundle paths each
force that scope into main:

- **Anchor 1 — the barrel.** `src/lib/reefin-sdk/index.ts` does `export * from './generated'` *and*
  `import { Configuration, LibraryApi, ShowApi, SystemApi, UserViewApi } from './generated'`.
  `compat.ts` (eager in main, via `ServerConnections.js`) value-imports `ReefinSdk`, so the whole
  barrel module — and the concatenated generated scope — is evaluated in main.
- **Anchor 2 — the v2 playback path.** `playbackmanager.js:38` *statically* imports
  `scripts/playbackSessionV2Url.ts`, which value-imports `PlaybackApi` + `Configuration` + 2 enums
  from the generated tree. Same concatenated scope, second independent route into main.

Because either anchor alone suffices to place the scope in main, **cutting one leaves the scope
exactly where it was.** That is why the individual levers measure near zero and the combination
measures ~70 KB. Note `ReefinApi`/`ReefinSdk` genuinely need only `Configuration` — nothing in the
eager path legitimately requires the API classes.

## Levers, all measured (real builds, clean, zero webpack warnings)

Levers are named after the **anchor** they remove, because that is the only granularity at which
they are coherent (see Finding 3).

| # | Lever (anchor removed) | Main bundle | Saved |
| --- | --- | ---: | ---: |
| — | Baseline (`origin/main`) | 443189 | — |
| **A+N** | **Anchor 1 — the barrel.** Split the 4 `getXxxApi` helpers into `lib/reefin-sdk/apis.ts` (A) **and** drop `export * from './generated'`, narrow to `./generated/configuration`, repoint 23 consumers to `lib/reefin-sdk/generated` (N) | 441409 | **1780** |
| **B** | **Anchor 2 — the v2 playback path.** Lazy-load `playbackSessionV2Url` from `playbackmanager.js` (PR #21's `playback-shadow` pattern) | 434107 | **9082** |
| **A+N+B** | **Both anchors removed** | **372482** | **70707** |
| — | *Reference ceiling: entire `lib/reefin-sdk` aliased to a stub* | 379460 | 63729 |

A and N are **not separable levers** and are not reported as such: dropping `export *` while the
helpers still live in the barrel re-anchors the 4 API classes, and moving the helpers out while
`export *` remains still evaluates the concatenated scope. Each only pays off with the other. (For
completeness: the helper-split A, measured on its own before N was applied, accounted for 300 of
the 1780 — a sub-step, not a lever.)

Lever B alone (9082) closely corroborates issue #41's independent 8769-byte figure for lazy-loading
the v2 playback path — good cross-validation of the rig.

The combination beats the stub ceiling (70707 > 63729) because lazy-loading `playbackSessionV2Url`
also evicts non-SDK consumer code (`reefinPlaybackCapabilities.ts`, ~792 lines) that the stub build
kept.

## Verdict

**Yes — 30 KiB of real margin is reachable, but only via the A+N+B combination.**

| Option | Resulting margin | Clears 30 KiB? |
| --- | ---: | --- |
| Anchor 1 only (A+N) | 19391 B (18.9 KiB) | No |
| Anchor 2 only (B) | 26693 B (26.1 KiB) | **No** — falls 4027 B short |
| **Both anchors (A+N+B)** | **88318 B (86.2 KiB)** | **Yes, ~6.7x over** |

Recommended sequence:

1. **Lever B** — mirror PR #21's `playbackSessionShadowTrigger` pattern for
   `applyV2PlaybackUrlToStreamInfo`. Established precedent in this codebase, single call site.
2. **Lever N** — remove `export * from './generated'` from the barrel, import `Configuration` from
   `./generated/configuration`, repoint the 23 consumers to `lib/reefin-sdk/generated`. Mechanical,
   import-path-only.
3. **Lever A** — move the 4 `getXxxApi` helpers to `lib/reefin-sdk/apis.ts` so the barrel's eager
   surface never references an API class. **Must ship with N**, in the same change: N without A (or
   A without N) leaves anchor 1 intact and measures ~0.

No client is duplicated, no manual wrapper is written, no generated code is hand-edited, and the
budget is not raised. B alone is the cheapest single step but **does not reach the target** — all
three are required.

## Caveats

- Do **not** expect the levers to add up. A+N+B (70707) is ~7x the sum of the parts (11162); a
  partial rollout of any subset will look like it "did nothing". Land them together or verify
  after each.
- The 1780 B figure for anchor 1 (A+N) is real but only unlocks value once B removes anchor 2.
  A and N must land together; neither is independently useful.
- Lever B's dynamic import makes `applyV2PlaybackUrlToStreamInfo` return a Promise. The existing
  call site (`playbackmanager.js:3485`) already `await`s it, so the change is contained — but that
  is a behaviour-adjacent detail to confirm in the implementation PR, not in this measurement pass.
- The stub ceiling (63729) is an upper bound used only as a sanity check; the A+N+B number is the
  real measurement.
