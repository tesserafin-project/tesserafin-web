# Web delivery budget

How much this repository is allowed to make a cold visitor download, how that is measured, and
what the numbers do and do not mean.

Enforced by `scripts/verify-delivery-budget.mjs` against `webpack.delivery-budget.json`. Run
locally with:

```
npm run build:production      # also emits delivery-stats/stats.json
npm run verify:delivery-budget    # gate: fails the build on a regression
npm run report:delivery-budget    # same table, never fails - "what do we measure today?"
npm run test:delivery-budget      # controls for the verifier itself
npm run test:delivery-ledger      # server-free browser corroboration (needs the build)
```

`npm run validate:full` runs the controls and the gate. In hosted CI both run inside the already
required `Build 🏗️ / Run production build 🏗️` job (`.github/workflows/__package.yml`), so the
contract is a required check without inventing a new status-check name.

## Four different questions

These are four separate measurements. Confusing any two of them is how a codebase ends up with a
green budget and a slow product.

| # | Question | Owned by | Status |
| --- | --- | --- | --- |
| 1 | How big is `main.tesserafin.bundle.js`? | `webpack.performance-budget.json` + webpack's own `performance` block + `scripts/verify-bundle-budget.mjs` | Unchanged, still enforced |
| 2 | How many bytes does a cold visitor download before the app can start? | this document | Added |
| 3 | What does an async route or feature cost when it is opened? | the progressive-delivery boundaries below | Asserted as membership, not budgeted in bytes |
| 4 | LCP, INP, playback-start latency | browser measurement | **Not measured here, and not substitutable by bytes** |

Question 1 was the only one with a gate. `webpack.prod.js` sets
`maxEntrypointSize: Number.MAX_SAFE_INTEGER` on purpose - `splitChunks` fans the entrypoint out
across two dozen assets, so the entrypoint sum was never a meaningful "bundle principal" number -
but the consequence was that only 390 KiB of a 2 079 KiB initial delivery was under any ceiling.
Every vendor chunk could grow without CI noticing. That is the gap this budget closes.

Bytes are an input to question 4, not a proxy for it. This gate can be green while the app feels
slow. Nothing here should ever be quoted as an LCP or INP result.

## What is counted

**`initial`** - every script and stylesheet the emitted `dist/index.html` asks for. Not "every
initial chunk": `webpack.common.js` declares one entrypoint per `themes/*.scss`, and those
stylesheets are fetched one at a time by the theme manager at runtime, never by the document. The
set is read out of the finished `index.html` (after `optimization.realContentHash` has settled the
filenames) and cross-checked against the entrypoints listed in `htmlEntrypoints`; if the two
disagree, the verifier refuses rather than re-baselining.

Each emitted asset is counted **once**. `runtime.bundle.js` belongs to both the `main.tesserafin`
and `serviceworker` entrypoints; it contributes its bytes a single time.

**`startup`** - `initial`, plus the assets of every async chunk group whose `import()` was issued
by a module listed in `bootModules` (today: `./index.jsx`, the application entry). This tier is the
anti-bypass control: moving a static start-up import behind `import()` moves bytes from `initial`
to `startup` and leaves the total unchanged, so the refactor gains nothing.

It is deliberately conservative: iOS styles, TV fonts and the default font set are mutually
exclusive at runtime but all counted, because which branch a visitor takes is not a build-time
fact.

**Not counted, and why:** theme stylesheets (runtime, one at a time), fonts and images
(`asset/resource`, fetched by the browser only when a glyph or an image is actually rendered -
`unicode-range` subsetting means most Noto subsets are never requested), and every async route
chunk. An asset type that is neither `.js` nor `.css` appearing inside the counted set is a hard
failure, not a silent exclusion.

## Baseline

Measured on `main` at `1cb72daa15ccbddaf8e095c0d541e04911cc17d8` (squash merge of #130), from a
clean worktree - `git describe --always --dirty` must not report `-dirty`, because
`__COMMIT_SHA__` is compiled into the main bundle and the suffix adds six bytes.

| Metric | `initial` | `startup` |
| --- | ---: | ---: |
| assets | 25 | 44 |
| raw JS | 1 957 619 B | - |
| raw CSS | 171 812 B | - |
| raw total | 2 129 431 B | 3 223 410 B |
| gzip total | 544 413 B | 903 957 B |
| brotli total | 459 076 B | 571 444 B |

`main.tesserafin.bundle.js` alone: 389 979 B raw, against its own unchanged 460 800 B ceiling.
That is **18.3 %** of the initial delivery it was standing in for.

### Ten largest initial contributors

| asset | raw | gzip | brotli |
| --- | ---: | ---: | ---: |
| `main.tesserafin.bundle.js` | 389 979 | 106 266 | 87 635 |
| `node_modules.@mui.material.bundle.js` | 377 658 | 100 072 | 79 731 |
| `node_modules.@jellyfin.sdk.bundle.js` | 347 560 | 38 927 | 28 901 |
| `node_modules.react-dom.bundle.js` | 128 912 | 41 379 | 36 157 |
| `43539.<hash>.css` | 109 594 | 17 551 | 14 780 |
| `node_modules.jellyfin-apiclient.bundle.js` | 88 028 | 19 192 | 16 358 |
| `node_modules.jquery.bundle.js` | 87 257 | 30 457 | 27 598 |
| `node_modules.date-fns.esm.bundle.js` | 76 845 | 15 812 | 13 023 |
| `main.tesserafin.<hash>.css` | 62 218 | 12 869 | 11 431 |
| `43539.bundle.js` | 56 742 | 20 899 | 18 692 |

### Boot-time `import()` (the `startup` tier's extra bytes)

| issued by `./index.jsx` | raw | brotli |
| --- | ---: | ---: |
| `./styles/fonts.noto.scss` | 1 020 179 | 91 175 |
| `./components/nowPlayingBar/nowPlayingBar` | 62 802 | 15 089 |
| `./components/notifications/notifications` | 3 667 | 1 319 |
| `./styles/fonts.figtree.scss` | 2 388 | 474 |
| `./components/playback/volumeosd` | 2 311 | 878 |
| `./components/playback/playbackorientation` | 855 | 355 |
| `./components/playback/remotecontrolautoplay` | 673 | 356 |
| `./styles/fonts.scss` | 598 | 339 |
| `./styles/fonts.sized.scss` | 331 | 204 |
| `./styles/ios.scss` | 175 | 141 |
| `./components/playback/playerSelectionMenu` | 0 (already initial) | - |

The Noto stylesheet dominates the tier in raw bytes and compresses extremely well (1 020 073 B raw
to 91 175 B brotli) because it is thousands of near-identical `@font-face` rules. The font *files*
those rules point at are not counted: `unicode-range` means a subset is fetched only when a glyph
in that range is rendered.

## Compression parameters

Node built-ins only. No compression dependency is added, and nothing compressed for measurement is
written to `dist/`.

* gzip - `zlib.gzipSync(buffer, { level: 9 })`, zlib defaults otherwise.
* brotli - `zlib.brotliCompressSync(buffer, { params: { BROTLI_PARAM_QUALITY: 11 } })`.
  `BROTLI_PARAM_SIZE_HINT` is deliberately **not** set: it changes the output size, and deriving it
  from the input length would make the number depend on a parameter nobody reviews.
* Each asset is compressed **separately** and the sizes are summed. Concatenating first would give
  a smaller, dishonest number - they are separate HTTP responses with separate compression
  contexts.

## The rounding rule

Every byte ceiling is the measurement **rounded up to the next whole KiB (1024 B)**. Asset counts
take **no** margin: the measured count is the ceiling.

The KiB margin is not headroom for features. It exists because a handful of bytes legitimately move
between a local build and a CI build: `__COMMIT_SHA__` comes from `git describe --always --dirty`
and `__JF_BUILD_VERSION__` is `'Release'` locally but the full commit SHA in
`.github/workflows/__package.yml`. Without the margin the gate would fail for reasons that have
nothing to do with delivery.

One asymmetry worth knowing before a future bump: `initial.assetCount` covers a small, stable set,
so any movement in it is a real change. `startup.assetCount` counts whole chunk *groups*, and
`splitChunks` will extract a newly shared module out of one of them into two files - a count bump
whose byte totals are unchanged is a chunk split, not growth. Say which one it is in the pull
request.

A regression raises a ceiling only by an explicit, reviewed edit to `webpack.delivery-budget.json`,
with before/after numbers in the pull request. There is no `--update-baseline` flag and the
verifier never writes the file - it only prints what the rounding rule would produce, as guidance
for the person who has to justify the change.

## Progressive-delivery boundaries

Module-level, not asset-level: a Theme Studio chunk group also *references* shared initial assets
like `node_modules.@mui.material.bundle.js`, so asking "is any asset shared?" would be permanently
red and meaningless. The question asked instead is "does any module matching this pattern live in
a chunk that the counted delivery set is made of?"

| id | pattern | rule |
| --- | --- | --- |
| `theme-studio` | `^\./apps/modern/(features/themeStudio\|routes/user/themeStudio)/` | Theme Studio is an authoring tool reached from Display preferences (#119), not a viewer destination. A viewer who never opens it must never download it. |
| `theme-authoring-validation` | `^\./themes/platform/(validateManifest\|validateTokens)` | Manifest and token validation is authoring/compiler work (#115, #117). The viewer resolves an already-valid presentation; it does not validate one at boot. |

The boundaries track **delivered** modules, not source imports. Adding
`import './apps/modern/features/themeStudio/tokenModel'` to `src/index.jsx` does *not* trip them,
because that module is types and constants with no used export and webpack drops it entirely -
nothing is delivered, so nothing is flagged. Importing and actually retaining a Theme Studio module
does trip them, naming each module and the chunk/asset edge it arrived on.

Scope-hoisted modules are expanded before the check. `ModuleConcatenationPlugin` merges modules
into a single `ConcatenatedModule` whose identifier is a summary (`./index.jsx + 8 modules`);
recording the summary would hide every merged member, and the boundary would report clean because
it never saw them.

### Acceptance rule inherited by #129 Step 1b

> The future modern Item Details route must be an async route, and must not expand the ordinary
> boot graph merely because it exists.

No empty guard is declared for files that do not exist yet. The rule is enforced by the budgets
above: the migration has to leave them green without raising a ceiling for code no viewer loads at
boot.

## Determinism

Two clean production builds of the **same commit** produce a byte-identical
`delivery-stats/stats.json` and a byte-identical JSON report, content hashes included. The stats
artifact records no timestamp, no absolute path and no build-host identity; every collection in it
is sorted, and module identities are webpack's own repository-relative `readableIdentifier`.

Across *different* commits the raw sizes stay put but the compressed ones move by a few hundred
bytes, because `__COMMIT_SHA__` is compiled into the main bundle: the length is the same, the bytes
are not, and gzip/brotli notice. That is precisely what the next-whole-KiB margin absorbs, and it
is why a determinism comparison must fix the commit.

`webpack --json` is not used: on this project it writes a ~530 MB dump that Node cannot even read
back (`ERR_STRING_TOO_LONG`) and that embeds absolute worktree paths. `delivery-stats/stats.json`
is a few hundred KB, git-ignored, and uploaded as a short-retention CI artifact.

## Browser corroboration

`npm run test:delivery-ledger` (`tests/delivery/`, `playwright.delivery.config.ts`) opens the
production build in a cold Chromium with the cache disabled and records what is actually
requested. It asserts resource **identity and membership** only. It asserts **no durations** -
wall-clock numbers on a shared runner are environment noise, and a flaky performance gate teaches
people to re-run CI rather than read it.

It proves, server-free:

* the statically computed initial set is exactly what `index.html` references, and the browser
  fetches all of it;
* ordinary boot fetches no Theme Studio route chunk;
* navigating to `#/themestudio` is what first requests it - React Router resolves the route's
  `lazy()` loader before the `ConnectionRequired` gate decides anything, so the request is
  observable without a session.

**Known limitation.** With no Tesserafin server there is no session, so the authenticated routes
(Home, Library) cannot be driven here, and this suite therefore cannot show "Home boot does not
fetch Theme Studio code" - only "boot does not". The repository has no tracked way to start a
server and this suite deliberately does not grow one. The deterministic webpack graph remains the
normative gate.

**Observed, not gated.** The real browser boot fetches more than the `startup` tier counts: the
plugin set (`./plugins/` lazy context), the locale dictionary (`./strings/`), the active theme
stylesheet, and the route chunk for wherever the router lands. Those are all one-of-N selections
from lazy contexts - counting the whole context would budget 100+ locales and every plugin, which
is not what anyone downloads. They are therefore visible in the ledger's log output and excluded
from the ceilings. The corollary is the honest limit of the anti-bypass property: it is anchored at
the application entry module, and a dynamic import introduced further down the boot path would not
be caught by the `startup` tier. `bootModules` is the reviewed place to extend that anchor, and the
verifier fails closed if a listed anchor disappears from the initial graph.

## Related, deliberately not fixed here

This is a measurement contract, not a remediation. The baseline records today's numbers including
known weight that already has its own issue:

* #74 - the Google Cast sender SDK loads at start-up rather than on demand.
* #75 - production console logging on normal flows.
* The `./apps/modern/routes/` lazy context (`components/router/AsyncRoute.tsx`) turns every file
  under the routes directory into its own async chunk, including test files. Pre-existing, async,
  and out of scope here.
