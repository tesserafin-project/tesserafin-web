# The no-unassumed-Jellyfin boundary (B1, tesserafin-web #54)

Tesserafin Web is a fork of Jellyfin Web. Jellyfin is therefore present all over
this repository, and almost none of that presence is a defect. #54 asks a narrow
question:

> does Tesserafin *need* anything the Jellyfin project operates, at runtime or in
> its automation?

This document answers it, names what was removed to make the answer "no", and
records what deliberately stays.

## Classification

Every reference is one of six classes. Only classes 5 and 6 violate B1.

| Class | Meaning | Verdict |
| ----- | ------- | ------- |
| 1 | Inherited package or module identity (`@jellyfin/sdk`, `jellyfin-apiclient`, `@jellyfin/ux-web`, the `JELLYFIN_VERSION` build variable, the `main.jellyfin` webpack chunk name) | Allowed |
| 2 | Legal attribution and historical documentation | Allowed |
| 3 | Developer-only upstream synchronisation (the local `upstream` git remote) | Allowed, documented below |
| 4 | Inert documentation hyperlink — an `href` a user may click, which the application never fetches | Allowed, inventoried |
| 5 | Runtime network dependency on an upstream-operated service | **Forbidden** |
| 6 | Active automation or deployment targeting Jellyfin infrastructure or requiring a Jellyfin credential | **Forbidden** |

The enforcement lives in two places, one static and one observed:

- `scripts/verify-no-runtime-jellyfin.mjs` — wired into `npm run validate:full`.
  Fails closed on a new upstream host in a request-shaped expression, on any
  `(file, host)` pair missing from `.github/jellyfin-boundary-allowlist.json`, on
  a shipped or built client configuration that names a non-local server, on a
  built bundle carrying an upstream *service* host, on any workflow that reaches
  Jellyfin infrastructure, and on a misdirected `origin` remote.
- `tests/e2e/no-runtime-jellyfin.spec.ts` — records every non-local origin a real
  browser reaches while driving the B1 flows against the release image, and fails
  if any of them is upstream-operated.

## What was removed (class 6)

| Path | Disposition | Why |
| ---- | ----------- | --- |
| `.github/workflows/schedule.yml` | Deleted | Its only job was the upstream stale bot: gated on `contains(github.repository, 'jellyfin/')` so it could never act here, yet its daily `cron` fired a workflow run every day, and it wanted the Jellyfin bot credential. |
| `.github/workflows/workflow_run.yml` | Deleted | Carried the *ungated* deployment path. Its `deploy` job called `__deploy.yml` with no repository condition at all, and the workflow remained `workflow_dispatch`-able, so one manual dispatch would have attempted a deployment to upstream infrastructure. |
| `.github/workflows/__deploy.yml` | Deleted | Published the built bundle to the upstream project's Cloudflare Pages project, using the Jellyfin project's Cloudflare account and bot credential. Tesserafin owns none of the three. |
| `.github/workflows/__job_messages.yml` | Deleted | Only consumer was `__deploy.yml`; required the Jellyfin bot credential and hard-coded the upstream preview host. |
| `.github/workflows/__automation.yml` | Deleted | Merge-conflict labelling through the Jellyfin bot credential; only consumer was `workflow_run.yml`. |
| `.github/workflows/push.yml` — `deploy` job | Removed in place, with a note where it stood | Same deployment path as `__deploy.yml`, reachable only on the upstream repository. The condition was the only thing preventing a deployment to infrastructure Tesserafin does not own. |
| `.github/workflows/__package.yml` — “Update config.json for testing” step | Removed in place, with a note where it stood | **The one live class 6 finding.** The step was not gated on the repository, so on every pull request and every push to `main` *in this repository* it rewrote the freshly built bundle to `multiserver: true` with the Jellyfin project's public demo server as its only entry. The artifact's first runtime action would have been a call to an upstream-operated service. |
| `.github/renovate.json` — `github>jellyfin/.github//renovate-presets/nodejs` | Replaced with `config:recommended` | Renovate is active automation, and it resolved its base configuration from a repository the Jellyfin project owns. The dependency rules this repository actually cares about (`@jellyfin/sdk` on the `unstable` tag, the `dompurify` major hold, `hls.js` priority) are declared locally in the same file and are untouched. |

No deployment path replaces any of these. `push.yml` still builds the production
bundle and uploads it as a run artifact; that is everything this repository
publishes from CI.

## What stays

### Class 3 — the `upstream` git remote

`git remote -v` in a developer checkout shows:

```
origin    https://github.com/tesserafin-project/tesserafin-web.git
upstream  https://github.com/jellyfin/jellyfin-web
```

`upstream` is **developer-only synchronisation**: it exists so a maintainer can
fetch upstream history to compare or cherry-pick. Nothing in the product, the
build, the test suite or the workflows reads it — no workflow performs a
`git remote add`, and GitHub-hosted checkouts have only `origin`. The gate
asserts `origin` really is `tesserafin-project/tesserafin-web` and that any
Jellyfin-pointing remote is named in this document; it does not require the
remote to be deleted.

### Class 4 — inert documentation hyperlinks

Twenty-six occurrences across eight files, every one an `href` on a help
button or a documentation link: the dashboard help-link table, the transcoding
and general-settings help links, the setup wizard's per-collection-type help
buttons, and the subtitle editor's external-files link. The application never
fetches any of them; a user may click one and leave.

They stay because replacing them requires Tesserafin documentation to exist
first, which is E1 work. `.github/jellyfin-boundary-allowlist.json` records each
one, and the E2E origin recorder proves that none is reached during onboarding,
authentication, library browse, search, detail or playback.

`ConnectionErrorPage.tsx` deserves a specific note: its only upstream link sits
in the `ServerUpdateNeeded` branch. The `Unavailable` branch — the one B1's
network-failure criterion exercises — renders `MessageUnableToConnectToServer`
and contains no upstream reference at all.

### Class 2 — attribution

`.github/SUPPORT.md` already states that Tesserafin is a fork of Jellyfin Web,
is not affiliated with the Jellyfin project, and that Tesserafin support requests
must not be directed at Jellyfin's community channels. The issue templates and
the pull-request template still link Jellyfin's Code of Conduct and contributing
guide; rewriting them in Tesserafin's own voice is presentation work and belongs
to B2/E1.

## One finding deliberately left open

`src/apps/dashboard/routes/plugins/plugin.tsx` defines

```ts
// Plugins from this url will be trusted and not prompt for confirmation when installing
const TRUSTED_REPO_URL = 'https://repo.jellyfin.org/';
```

This is **not** a class 5 runtime dependency: the web client never contacts that
host. Plugin repositories are fetched by the *server*, and the constant only
decides whether the install-confirmation dialog is skipped for a repository whose
URL starts with it.

It is, however, an inherited trust decision in Tesserafin's favour of an
upstream-operated origin, and it survives into the built bundle. It is recorded
in the allowlist as `inherited-trust-allowlist` rather than being silently
classified as inert, so it is visible rather than forgotten.

Changing it is not B1 work: it would alter shipped runtime bytes and therefore
force a new web-assets publication, a server Dockerfile re-pin and a full A1/A3/A7
re-run, for a dialog that only an administrator installing a plugin ever sees.
It belongs to the plugin/trust review, not to the functional release candidate.
