# `reefin-sdk`

Typed API client generated from the `reefin` server's OpenAPI spec. Successor to `@jellyfin/sdk`
(which is generated from **Jellyfin's** spec, not Reefin's - see
`docs/reefin/design-reefin-api-layer.md` for why that matters and what this replaces).

**Status: pipeline only.** Nothing in the rest of the app imports from this module yet - see
"What's not done here" below.

## Layout

```
src/lib/reefin-sdk/
  spec/
    openapi.json      # pinned copy of the last spec used to generate (committed)
    version.json       # metadata about that spec: title, version, path/schema counts, source, timestamp
  generated/            # openapi-generator-cli output (typescript-axios). Committed. Do not hand-edit.
  versions.ts           # MINIMUM_VERSION derived from the pinned spec, NOT from @jellyfin/sdk's
  index.ts              # barrel re-export of generated/ (not consumed anywhere yet)
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

## Why generation, not hand-written types

See `docs/reefin/design-reefin-api-layer.md` in full, short version: the `reefin` OpenAPI spec is a
verified superset of the Jellyfin API (inherited routes like `/Users`, `/Items` **and** Reefin-only
routes like `/System/PlaybackDiagnostics/Sessions` live in the same spec), so the realistic target
is replacing `@jellyfin/sdk` wholesale rather than adding a second client next to it. Generating with
the same tool/template `@jellyfin/sdk` itself uses keeps the call-site shape identical
(`getUserApi(api).getCurrentUser()`-style classes), which is what makes migrating the ~325 current
`@jellyfin/sdk` import sites a mechanical swap of the construction point rather than a rewrite of
every call site.

## What's not done here (see design doc §7/§8 for the follow-up PRs)

- **No consumer migrated.** `useApi()`, `ServerConnections`/`connectionManager.js`,
  `utils/jellyfin-apiclient/compat.ts` (`toApi()`) are untouched. `index.ts` exists so the generated
  output has a stable entry point to wire up next, not because anything imports it yet.
- **No `Jellyfin`/`Api`/`createApi` wrapper class.** `@jellyfin/sdk` wraps its generated
  `*Api` classes in a `Jellyfin` class that builds the `Authorization` header (client name/version,
  device name/id - the exact hook design-reefin-api-layer.md §4.4 identifies for the client-identity
  renaming) and hands out a configured `Api` instance. `generated/configuration.ts` here only has the
  raw `Configuration` class from the generator; building the equivalent convenience wrapper is part
  of wiring a consumer (design doc §8 PR3), not this pipeline step.
- **CI contract-check job (design doc §6) not added.** The script and pinned `spec/version.json`
  give it what it needs (a version to diff against), but the `openapi-diff` GitHub Actions job that
  would consume it isn't part of this change.
- **Spec source is a local file snapshot, not a live `reefin` server.** No `reefin` dev server was
  running when this was generated; the spec came from priority (2) above (the sibling `reefin`
  checkout's test artifact). Re-run against a live server before relying on this for anything beyond
  review.
