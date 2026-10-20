# Production console hygiene (#75)

Status: implementation and regression controls prepared; release-image acceptance pending.
This change does not close #75 or change the server's DS5/BoxSet behavior.

## Findings and disposition

- `ConnectionManager._getOrAddApiClient` first searches `_apiClients`; creation and
  `apiclientcreated` happen only on a miss. Both SDK adapters are initialized with
  `??=`. Sixteen returns are not sixteen connections. The return trace is removed;
  the regression test makes sixteen further lookups and requires one client, one
  instance of each adapter, and no HTTP call.
- `ConnectionRequired` intentionally resolves `null` after `firstConnection` is
  set. That path validates the existing user/session instead of reconnecting.
  `firstConnection?.State` therefore printed `undefined` on ordinary reuse. Its
  diagnostic now explicitly identifies reuse; access decisions are unchanged.
- Boot, connection, router/view, local-player, bitrate, track and session tracing
  use the small `utils/debug` helper. It is silent in production unless this
  browser's `tesserafin.debug` storage key is exactly `true`. Development remains
  verbose. Denied storage keeps production quiet. No global console override or
  bundler-wide console stripping is installed.
- Router/view options and player-capability/state dumps are reduced to event
  labels. Existing warnings/errors remain visible. Malformed socket JSON,
  configuration getter failures and service-worker registration failures are
  classified as warnings rather than routine `log` messages.
- The URL hygiene AST gate also recognizes the diagnostic helper's named import,
  including a renamed import. The existing syntactic/data-flow limitations and
  playback-credential runtime backstop still apply. Opt-in is not permission to
  print credentials or media URLs.

Enable locally with `localStorage.setItem('tesserafin.debug', 'true')`; disable
with `localStorage.removeItem('tesserafin.debug')`. The switch is read per call.
The normal-flow acceptance runs with fresh contexts and diagnostics disabled.

## Automated acceptance

`npm run test:console-controls` checks the helper and the counting gate, including
debug-only over-budget output, dependency warnings/errors, unattributed output,
uncaught page errors and isolation between observation windows. It runs in hosted
quality CI and `npm run validate`. The URL controls include helper regressions.

`npm run test:console-production` drives five real browser flows:

| Flow | Functional prerequisite | First-party log/debug ceiling |
| --- | --- | ---: |
| First sign-in | Fresh context reaches authenticated Home | 0 |
| Library navigation | Movies library displays the seeded movie | 0 |
| Item detail | Search reaches the visible detail heading | 0 |
| Direct Play | Video advances; server reports DirectPlay; media bytes fetched | 0 |
| Transcoded playback | Video advances; server reports Transcode and transcoding info; media bytes fetched | 0 |

These are **targets, not observed counts**. Do not increase them just to accept
remaining chatter. Each flow also requires zero warnings/errors from either
first-party or dependency code, zero unattributed messages and zero uncaught page
errors. There are currently no severity exceptions. Dependencies' other output
is separately counted and attached; it does not consume the first-party budget.

The observer uses the emitting asset, not message-text prefixes. `node_modules.*`
matches the production webpack cache group; copied `libraries/` workers are also
dependency code. Other production bundle/chunk scripts are first-party. Unknown
origins, browser messages and missing locations fail closed. Reports contain only
counts, flow names and image identity, never console payloads or credentials.

Non-playback flows include two seconds of trailing effects. Playback additionally
observes three seconds after the video advances. This is a bounded normal-flow
check, not long-duration playback or every optional plugin's acceptance.

## Running against an image

1. Build the candidate with `npm ci` and `npm run build:production`.
2. Run an isolated instance of the release server image serving that exact
   production `dist/`. Seed the existing E2E fixture contract: `smokeadmin`, a Movies
   library with H.264/AAC `Smoke Test Movie` and MPEG-4/AC-3 `Transcode Probe`.
   The server repository's `ci/serve-e2e.sh` and `ci/verify-release-pair.sh` document
   these fixtures. A source-only server run is useful diagnosis but does not
   satisfy #75's release-image gate.
3. Set `TESSERAFIN_E2E_BASE_URL`, `TESSERAFIN_E2E_USER`,
   `TESSERAFIN_E2E_PASSWORD`, and `TESSERAFIN_CONSOLE_IMAGE` to the image's immutable
   `name@sha256:...` reference (or local image `sha256:...` ID).
4. Install Chromium with `npx playwright install chromium`, then run
   `npm run test:console-production` from the Web checkout.

The preflight hashes the served entry, lazy/vendor chunks and service worker
against the local production `dist/`, refusing an old bundle. The image reference
is recorded caller-supplied provenance; the test does not independently inspect
the container daemon. Keep the container launch/inspection evidence with the
counts. No image, tag, release, registry permission or server change is produced
by this Web test.

## Remaining acceptance

The five real release-image measurements and their per-flow counts have not been
run in this workspace. No green production-flow result is claimed. Keep the PR
draft and #75 open until these pass on the actual candidate image; investigate
any warning/error or remaining trace individually. The ordinary quality/build
checks and unit/negative controls cannot stand in for that evidence.
