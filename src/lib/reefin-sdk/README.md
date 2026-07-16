# `reefin-sdk`

Typed API client generated from the `reefin` server's OpenAPI spec. Successor to `@jellyfin/sdk`
(which is generated from **Jellyfin's** spec, not Reefin's - see
`docs/reefin/design-reefin-api-layer.md` for why that matters and what this replaces).

**Status: one real consumer.** `apps/dashboard/features/playback/api/` (the playback diagnostics
feature) calls the generated `SystemApi` class directly - see "What's migrated" below. The
connection layer (`useApi()`, `ServerConnections`, `utils/jellyfin-apiclient/compat.ts`) is still
untouched and still hands out a `@jellyfin/sdk` `Api` instance; see "What's not done here".

## Layout

```
src/lib/reefin-sdk/
  spec/
    openapi.json      # pinned copy of the last spec used to generate (committed)
    version.json       # metadata about that spec: title, version, path/schema counts, source, timestamp
  generated/            # openapi-generator-cli output (typescript-axios). Committed. Do not hand-edit.
  versions.ts           # MINIMUM_VERSION derived from the pinned spec, NOT from @jellyfin/sdk's
  index.ts              # barrel re-export of generated/, PLUS the ReefinSdk/ReefinApi/createReefinApi
                         # construction wrapper and the REEFIN_CLIENT_IDENTITY constant (see below)
  README.md             # this file
```

`generated/` and `spec/openapi.json` are committed on purpose, not `.gitignore`d: every
regeneration is then a normal code-review diff, showing both the contract change (spec/) and its
consequence (generated/) together - see `docs/reefin/design-reefin-api-layer.md` §4.1 and §6.

## Regenerating

```sh
npm run generate:reefin-sdk
```

The script (`scripts/generate-reefin-sdk.mjs`) resolves a spec source in this order, first match
wins:

1. `REEFIN_OPENAPI_SPEC` env var - a local file path or an `http(s)://` URL
   (e.g. `REEFIN_OPENAPI_SPEC=http://localhost:8096/api-docs/openapi.json npm run generate:reefin-sdk`).
2. A `reefin` server checkout at `../reefin` (sibling to this repo), reading the integration test
   artifact that `OpenApiSpecTests.GetSpec_ReturnsCorrectResponse` writes
   (`tests/Reefin.Server.Integration.Tests/bin/{Debug,Release}/net10.0/openapi.json`, Debug
   preferred when both exist since it's more likely to be fresh).
3. A running dev server, default `http://localhost:8096` (override with `REEFIN_DEV_SERVER_URL`),
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

The script also unwraps single-property "ID wrapper" component schemas (`unwrapIdSchemas()`) -
Reefin's strongly-typed IDs (e.g. `PlaybackSessionId { Value: string }`) serialize as a plain string
on the wire via a custom converter Swashbuckle's schema reflection doesn't know about, so without
this the generator produces route parameters typed as an object (`id: PlaybackSessionId`) that get
interpolated into the URL as `"[object Object]"`. See the function's doc comment in the script for
the full story.

## Client construction wrapper (`index.ts`)

`ReefinSdk`/`ReefinApi`/`createReefinApi()` mirror `@jellyfin/sdk`'s `Jellyfin`/`Api`/`createApi`
shape exactly (same constructor parameters, same `basePath`/`clientInfo`/`deviceInfo`/`accessToken`/
`axiosInstance`/`authorizationHeader`/`configuration` surface), deliberately narrower - no
WebSocket, no deprecated auth convenience methods, those are connection-layer concerns.

**`REEFIN_CLIENT_IDENTITY`** is the single named constant for the protocol-level client identity
(`Client="..."` in the `Authorization` header). It is still `'Jellyfin Web'`
(`docs/reefin/branding-audit.md` categorie 1 - renaming it needs a coordinated server-side session
migration, not just a client-side edit) - what changes here is that there is now exactly **one**
place that value lives on the `reefin-sdk` side, instead of the two currently-coupled call sites
(`src/components/apphost.js:11` and `src/utils/image.ts:84`) the legacy stack still has.

**Not wired into `useApi()`/the connection layer yet.** `ReefinApi`/`createReefinApi()` exist as the
construction-point target for a future PR (design doc §8 PR3: swap `compat.ts`'s `toApi()` over).
Building a second, independent client identity into a feature *before* that swap would risk the
server seeing two different `DeviceId`s for what is really one browser session - see
`playbackDiagnosticsApi.ts`'s `systemApiFor()` for how the migrated playback feature avoids that
today (reuses the existing `@jellyfin/sdk` session's `basePath`/`axiosInstance`/
`authorizationHeader` to configure the generated `SystemApi` class, rather than constructing a
`ReefinApi` from scratch).

## Why generation, not hand-written types

See `docs/reefin/design-reefin-api-layer.md` in full, short version: the `reefin` OpenAPI spec is a
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
  `utils/jellyfin-apiclient/compat.ts` (`toApi()`) are untouched and still hand out a `@jellyfin/sdk`
  `Api`. `ReefinApi`/`createReefinApi()` above are not called by anything yet.
- **CI contract-check job (design doc §6) not added.** The script and pinned `spec/version.json`
  give it what it needs (a version to diff against), but the `openapi-diff` GitHub Actions job that
  would consume it isn't part of this change.
- **Spec source is a local file snapshot, not a live `reefin` server.** No `reefin` dev server was
  running when this was generated; the spec came from priority (2) above (the sibling `reefin`
  checkout's test artifact, still reporting server version `12.0.0` while `reefin-web`'s own
  `package.json` is at `13.0.0` - a live drift the design doc's §6 contract-check would have caught
  automatically; noted, not blocking). Re-run against a live server before relying on this for
  anything beyond review.
- **Other `@jellyfin/sdk` call sites (~325 files) and the rest of `jellyfin-apiclient` (~136 files)
  untouched**, as intended for this PR - design doc §7 migrates by vertical slice, not in bulk.
