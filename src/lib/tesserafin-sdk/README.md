# `tesserafin-sdk`

Typed API client generated from the `reefin` server's OpenAPI spec. Successor to `@jellyfin/sdk`
(which is generated from **Jellyfin's** spec, not Reefin's - see
`docs/tesserafin/design-tesserafin-api-layer.md` for why that matters and what this replaces).

**Status: one real consumer.** `apps/dashboard/features/playback/api/` (the playback diagnostics
feature) calls the generated `SystemApi` class directly - see "What's migrated" below. The
connection layer (`useApi()`, `ServerConnections`, `utils/jellyfin-apiclient/compat.ts`) still hands
out a `@jellyfin/sdk` `Api` instance; see "What's not done here". Its one migrated piece is the
minimum-server-version boundary: `connectionManager.js` imports `MINIMUM_VERSION` from `versions.ts`
below rather than from `@jellyfin/sdk/lib/versions` (tesserafin-web#65).

## Layout

```
src/lib/tesserafin-sdk/
  spec/
    openapi.json      # pinned copy of the last spec used to generate (committed)
    version.json       # metadata about that spec: title, version, path/schema counts, source, timestamp
                       # PLUS the provenance record - see "Provenance (schema 2)" below
    generated-manifest.json  # path + sha256 of every file under generated/ (committed, generated)
  generated/            # openapi-generator-cli output (typescript-axios). Committed. Do not hand-edit.
  versions.ts           # MINIMUM_VERSION derived from the pinned spec, NOT from @jellyfin/sdk's
  index.ts              # barrel re-export of generated/, PLUS the TesserafinSdk/TesserafinApi/createTesserafinApi
                         # construction wrapper and the TESSERAFIN_CLIENT_IDENTITY constant (see below)
  README.md             # this file
```

`generated/` and `spec/openapi.json` are committed on purpose, not `.gitignore`d: every
regeneration is then a normal code-review diff, showing both the contract change (spec/) and its
consequence (generated/) together - see `docs/tesserafin/design-tesserafin-api-layer.md` §4.1 and §6.

## Regenerating

```sh
npm run generate:tesserafin-sdk
```

The script (`scripts/generate-tesserafin-sdk.mjs`) resolves a spec source in this order, first match
wins:

1. `TESSERAFIN_OPENAPI_SPEC` env var - a local file path or an `http(s)://` URL
   (e.g. `TESSERAFIN_OPENAPI_SPEC=http://localhost:8096/api-docs/openapi.json npm run generate:tesserafin-sdk`).
2. A `reefin` server checkout at `../reefin` (sibling to this repo), reading the integration test
   artifact that `OpenApiSpecTests.GetSpec_ReturnsCorrectResponse` writes
   (`tests/Reefin.Server.Integration.Tests/bin/{Debug,Release}/net10.0/openapi.json`, Debug
   preferred when both exist since it's more likely to be fresh).
3. A running dev server, default `http://localhost:8096` (override with `TESSERAFIN_DEV_SERVER_URL`),
   `GET /api-docs/openapi.json`.
4. The previously pinned `spec/openapi.json` in this repo, so the command stays runnable offline
   (e.g. to re-apply a template/generator-flag change without a server around).

Before generating, the script applies one fix to the spec (see `fixSchema()` in the script for the
full rationale): it drops the inline `enum` array on any parameter/property that has **both**
`enum` and `allOf: [{ $ref }]` pointing at the same named enum schema. Reefin's Swashbuckle output
emits that redundant shape for every enum parameter (257 occurrences in the current spec) and
`openapi-generator-cli`'s `typescript-axios` template (7.11.0) cannot parse it - it tries to import
each enum literal as a type name, producing invalid TypeScript
(`import type { 'Drop' } from '../models';`). This mirrors what `@jellyfin/sdk`'s own `fix-schema`
script does for its own (very similar, Swashbuckle-originated) spec quirks - not a Reefin-specific
workaround, a Swashbuckle/openapi-generator interaction.

Generator config: `openapitools.json` at the repo root pins the generator JAR version (`7.11.0`,
under `generator-cli.version`). `@openapitools/openapi-generator-cli` itself is a pinned
devDependency (`2.34.0` - the exact version `@jellyfin/sdk` uses to build itself), invoked through
`npx` so it always resolves to that pinned local copy.

### ID-object detection (`unwrapIdSchemas()`) - now a detector, not a rewrite

This function used to *unwrap* single-property "ID wrapper" component schemas: strongly-typed IDs
(e.g. `PlaybackSessionId { Value: string }`) travel as a plain string on the wire, but Swashbuckle's
schema reflection described the CLR object, so without a correction the generator produced route
parameters typed as an object and interpolated `"[object Object]"` into the URL.

**That workaround is why the defect went unnoticed here for so long.** It made the generated client
correct while the *published contract* stayed wrong for every other consumer - including the mobile
client, which does not use this generator. That is server issue #226, fixed by server PR #227: the
canonical contract now describes the scalar directly.

The transform is therefore **kept and inverted** rather than deleted. It normalizes nothing. It
scans, and if a future contract reintroduces an ID-object it **throws**, naming every offending
schema, and generation stops. Deleting it would have been smaller, but it would also have thrown
away the only thing on this side that can notice the next occurrence of this class of defect - and
the whole lesson of #226 is that silent normalization is the hazard.

Its predicate is deliberately narrow: a single property named exactly `Value`. This contract carries
around thirty legitimate single-property DTOs (`PingRequestDto`, `SeekRequestDto`, `QuickConnectDto`,
…) whose sole property is named something else; none is an opaque identifier and none is affected.

Current state against the pinned contract: **0 affected schemas**. Pinned by
`src/lib/tesserafin-sdk/idObjectContract.test.ts`, which asserts both that it is a no-op today and
that it fails loudly - rather than silently correcting - if the shape returns.

### deepObject query serialization (`scripts/openapi-templates/`)

The corrected contract declares `explode: true` on the eight `streamOptions` parameters, naming
`?streamOptions[key]=value`. openapi-generator's stock `typescript-axios` template expands an
exploded object *without* the parameter name, emitting `?key=value`. This server's model binder
accepts that too, but acceptance by one binder is not permission for a generated client to ignore
the contract it was generated from.

Generation therefore passes `--template-dir scripts/openapi-templates/typescript-axios`, which
overrides exactly one template (`apiInner.mustache`); openapi-generator falls back to its built-in
copy for every other file. The corrected branch is the generator's own
exploded/non-primitive/non-array branch - i.e. precisely deepObject semantics - so it names no
route, parameter or operation, and scalar and array serialization are untouched.

Because a vendored template is a fork, `npm run verify:openapi-templates` fails if the vendored copy
differs from the pinned generator's built-in template by anything other than the single declared
hunk. A generator bump that touches this template fails loudly instead of silently reverting the
correction or discarding an upstream fix. The resulting URLs are pinned by
`src/lib/tesserafin-sdk/deepObjectSerialization.test.ts`, which drives the real client through a stub
axios and asserts the query string actually produced.

Finally, the script strips the `/* eslint-disable */` line the `typescript-axios` template
unconditionally emits in every generated file's header (`stripEslintDisableHeaders()`) - dead
weight since this repo has had no ESLint since RFC-0002 step 5 (Biome doesn't read that pragma).
Without this the regenerated tree would never match what's committed, even with zero spec changes.

## Freshness check (`verify:tesserafin-sdk-fresh`)

```sh
npm run verify:tesserafin-sdk-fresh
```

Regenerates the SDK **strictly from the spec already committed** at `spec/openapi.json`
(`TESSERAFIN_OPENAPI_SPEC` forced to that file, bypassing the sibling-checkout/dev-server resolution
order above on purpose - this check must be reproducible regardless of what else is checked out
next to this repo) and fails if that regeneration produces any diff on `generated/` or
`spec/openapi.json`. It also asserts `spec/version.json` carries an explicit, non-null spec
version (`version`, `xTesserafinVersion`, `serverVersion`, `webAppVersion`) - a stale/never-pinned
version is treated as a failure, not a silent gap. `generatedAt`/`source` churn in `version.json`
is expected on every run and is not part of the check (the file is reset to its committed content
afterwards either way, so a run never leaves the working tree dirty as a side effect).

**Version skew: resolved by the 1.0 epoch.** This package and the server both carry `1.0.0` now,
so `serverVersion` and `webAppVersion` agree and `versionSkewNote` is null. The long-standing
`12.0.0` / `13.0.0` skew recorded here previously was an artefact of the two inherited upstream
version lines; both were reset to `1.0.0` when Tesserafin opened its public version epoch (see
`docs/versioning-policy.md` in the server repository). The skew machinery is retained on purpose:
`versionSkewNote` still records any future disagreement explicitly, and the check still prints it
as an informational note rather than papering over it with a fabricated newer spec.

**Local Docker equivalent** (CI quota is currently exhausted - see
`docs/tesserafin/design-tesserafin-api-layer.md` for the CI pipeline this substitutes for locally):

```sh
docker run --rm -v "$PWD":/workspace -w /workspace node:24-bookworm bash -c "
  apt-get update && apt-get install -y --no-install-recommends default-jre-headless &&
  npm ci --no-audit &&
  npm run verify:tesserafin-sdk-fresh
"
```

(`openapi-generator-cli` needs a JVM - `node:24-bookworm` doesn't ship one, hence the `apt-get`
step; `node:24` per `.nvmrc`.)

## Provenance (schema 2)

`spec/version.json` records where the pinned bytes came from, and the server repository's
`ci/verify-sdk-provenance.sh` checks that record against its own canonical contract on every pull
request and every push to its default branch.

### Why the schema changed

Schema 1 identified a generated SDK by **the git commit its contract came from**, and the server
gate required that commit to be an *ancestor* of the server commit under test. That requirement is
unsatisfiable on a branch with `required_linear_history`, which the server's `master` has:

- to generate the SDK for a contract change, you need a server commit that already carries the new
  canonical bytes — before the merge, the only one is on the pull request branch;
- after the merge, `master` carries those bytes at a **different** commit, because squash and
  rebase — the only merge methods such a branch permits — both rewrite the SHA.

Both conditions cannot hold at once. Proven on server PR #245: head `32413914a5…` is not an
ancestor of the `master` it produced. Every previous contract move worked around it by merging
knowingly red and repairing afterwards (server #218/#219, #227/#230).

### What replaced it

Schema 2 identifies the SDK by **the content it was generated from**. `scripts/generate-tesserafin-sdk.mjs`
consumes exactly one thing from the server — the canonical `openapi/openapi.json` bytes — so two
server commits carrying byte-identical *locked* canonical contracts produce a byte-identical
transport boundary, whatever GitHub did to the commit identity in between.

`sourceCommit` is still mandatory. It stopped being the compatibility predicate; it did not stop
being audit evidence, and it must still exist, resolve in the server repository, be a full
40-character SHA, and have both its canonical bytes and its contract lock match.

This is not the old rule with a hole in it. Schema 2 records — and both verifiers **recompute from
bytes**, never read as an assertion:

| Field | Covers |
|---|---|
| `provenanceSchema` | `2`. Dispatches the verification mode. An unknown value is refused, never assumed compatible |
| `sourceRepository` | the exact `owner/name` of the server repository |
| `sourceCommit` | full 40-character server commit SHA |
| `canonicalSpecSha256` | the **raw** `openapi/openapi.json` bytes as committed on the server |
| `specSha256` | the **transformed** `spec/openapi.json` bytes in this repository |
| `transformVersion` | which canonical→mirror pipeline produced one from the other (`applyTransforms`) |
| `generator` | `name`, `cliVersion` (package.json), `generatorVersion` (openapitools.json) |
| `generatedManifestSha256` | the exact bytes of `spec/generated-manifest.json` |
| `generatedFileCount` | how many files that manifest lists |

`generatedAt`, `source`, `sourceRef`, `title`, `pathCount`, `schemaCount` and `versionSkewNote` are
informational and take part in no compatibility decision.

The key set is **closed**: an unrecognised field is a failure, not something to ignore. A field no
verifier reads is a field no verifier enforces.

### `generated-manifest.json`

Every file under `generated/`, recursively — path and sha256, sorted by path in byte order.
Nothing is excluded, not even dotfiles such as `.openapi-generator/FILES`. Nothing outside that
directory is covered.

It exists because regeneration alone could never prove the tree. The freshness check regenerates
and requires `git status` to stay clean, which catches a *modified* or *deleted* file — but an
**extra** file was invisible: the generator used to only `mkdirSync` `generated/`, so a file nobody
generates was never removed, regeneration left it untouched and `git status` had nothing to say.
Two things now close that: the generator clears `generated/` first, and an unlisted file fails the
manifest comparison.

### Reporting

The server gate reports the ancestry it computed even though it no longer requires it:

- `ANCESTOR` — the pin is on the server's history, as during an ordinary regeneration;
- `CONTENT_EQUIVALENT_NON_ANCESTOR` — the pin was rewritten by a squash or rebase, and every
  content proof passed anyway.

The second is a successful result **only** after all fourteen proofs pass. It is a label on a
verified pin, never a reason to skip a check.

See server issue #246 for the full protocol, and `ci/verify-web-provenance.sh` plus
`ci/tests/web-provenance-fixtures.test.sh` in the server repository for the implementation and its
35 synthetic-history controls.

## Client construction wrapper (`index.ts`)

`TesserafinSdk`/`TesserafinApi`/`createTesserafinApi()` mirror `@jellyfin/sdk`'s `Jellyfin`/`Api`/`createApi`
shape exactly (same constructor parameters, same `basePath`/`clientInfo`/`deviceInfo`/`accessToken`/
`axiosInstance`/`authorizationHeader`/`configuration` surface), deliberately narrower - no
WebSocket, no deprecated auth convenience methods, those are connection-layer concerns.

**`TESSERAFIN_CLIENT_IDENTITY`** is the single named constant for the protocol-level client identity
(`Client="..."` in the `Authorization` header). It is still `'Tesserafin Web'`
(`docs/tesserafin/branding-audit.md` categorie 1 - renaming it needs a coordinated server-side session
migration, not just a client-side edit) - what changes here is that there is now exactly **one**
place that value lives on the `tesserafin-sdk` side, instead of the two currently-coupled call sites
(`src/components/apphost.js:11` and `src/utils/image.ts:84`) the legacy stack still has.

**Not wired into `useApi()`/the connection layer yet.** `TesserafinApi`/`createTesserafinApi()` exist as the
construction-point target for a future PR (design doc §8 PR3: swap `compat.ts`'s `toApi()` over).
Building a second, independent client identity into a feature *before* that swap would risk the
server seeing two different `DeviceId`s for what is really one browser session - see
`playbackDiagnosticsApi.ts`'s `systemApiFor()` for how the migrated playback feature avoids that
today (reuses the existing `@jellyfin/sdk` session's `basePath`/`axiosInstance`/
`authorizationHeader` to configure the generated `SystemApi` class, rather than constructing a
`TesserafinApi` from scratch).

## Why generation, not hand-written types

See `docs/tesserafin/design-tesserafin-api-layer.md` in full, short version: the `reefin` OpenAPI spec is a
verified superset of the Jellyfin API (inherited routes like `/Users`, `/Items` **and** Reefin-only
routes like `/System/PlaybackDiagnostics/Sessions` live in the same spec), so the realistic target
is replacing `@jellyfin/sdk` wholesale rather than adding a second client next to it. Generating with
the same tool/template `@jellyfin/sdk` itself uses keeps the call-site shape identical
(`getUserApi(api).getCurrentUser()`-style classes), which is what makes migrating the ~325 current
`@jellyfin/sdk` import sites a mechanical swap of the construction point rather than a rewrite of
every call site.

## What's migrated

- **`apps/dashboard/features/playback/api/`** (design doc §8 PR2): `playbackDiagnosticsApi.ts` calls
  the generated `SystemApi` class (`getPlaybackSessions`/`getPlaybackSession`/`exportFixture`)
  instead of raw `axiosInstance.get()` calls against hand-mirrored routes. `types.ts` derives its
  exported types from the generated models (`DeepRequired<T>`, see that file's header comment) rather
  than retyping the C# DTOs by hand - the one exception is `DiagnosticTimelineEntry.Stage`, generated
  as a plain `string` (not modeled as an OpenAPI enum server-side), kept as a hand-maintained literal
  union. No component (`DiagnosticDrawer`, `ReasonTree`, etc.) or hook
  (`usePlaybackSessions`/`usePlaybackSessionDetail`/`useExportFixture`) changed - the exported type/
  function names and shapes are unchanged, only what backs them.

## What's not done here (see design doc §7/§8 for the follow-up PRs)

- **Connection layer not migrated.** `useApi()`, `ServerConnections`/`connectionManager.js`,
  `utils/jellyfin-apiclient/compat.ts` (`toApi()`) still hand out a `@jellyfin/sdk` `Api`. The single
  exception is `connectionManager.js`'s default minimum server version, which now comes from
  `versions.ts` (tesserafin-web#65) - the `Api` construction path itself is unchanged.
- **CI contract-check job (design doc §6) not added.** The script and pinned `spec/version.json`
  give it what it needs (a version to diff against), but the `openapi-diff` GitHub Actions job that
  would consume it isn't part of this change.
- **Spec source is a local file snapshot, not a live `reefin` server.** No `reefin` dev server was
  running when this was generated; the spec came from priority (2) above (the sibling `reefin`
  checkout's test artifact, still reporting server version `12.0.0` while `tesserafin-web`'s own
  `package.json` is at `13.0.0` - a live drift the design doc's §6 contract-check would have caught
  automatically; noted, not blocking). Re-run against a live server before relying on this for
  anything beyond review.
- **Other `@jellyfin/sdk` call sites (~325 files) and the rest of `jellyfin-apiclient` (~136 files)
  untouched**, as intended for this PR - design doc §7 migrates by vertical slice, not in bulk.
