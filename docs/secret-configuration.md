# Secret and build-configuration model — Tesserafin Web

A frontend has a property no backend has: **everything it is built with is published.** A
value compiled into a bundle is not hidden by minification, not hidden by a hash in the
filename and not hidden by being served over HTTPS — it is one "view source" away from every
visitor. This document records where configuration actually comes from in this repository, and
which of it is public by construction.

No credential value appears in this document, and none may be added to it.

Related: [`docs/local-ci.md`](local-ci.md) (how to run the secret scan locally),
[`tesserafin-project/tesserafin` `docs/secret-configuration.md`](https://github.com/tesserafin-project/tesserafin/blob/master/docs/secret-configuration.md)
(the server and container half of the model).

---

## 1. Build-time variables are public

Webpack's `DefinePlugin` substitutes a small, fixed set of values into the bundle at build
time (`webpack.common.js`):

| Definition | Source | What it is |
| --- | --- | --- |
| `__JF_BUILD_VERSION__` | `JELLYFIN_VERSION`, or `"Dev Server"` under `WEBPACK_SERVE` | build label |
| `__USE_SYSTEM_FONTS__` | `USE_SYSTEM_FONTS` | font strategy flag |
| `__WEBPACK_SERVE__` | `WEBPACK_SERVE` | dev-server flag |

All three are build metadata. None is a credential, and none may become one.

**The rule this table exists to state:** any environment variable read at build time ends up
verbatim in `dist/`. There is no such thing as a "private" build-time variable in a browser
application. If a future feature appears to need one, it does not need a build-time variable —
it needs a server endpoint.

The bundle is also audited for content that does not belong in it by the existing
`scripts/verify-runtime-origins.mjs` and `scripts/verify-no-runtime-jellyfin.mjs` gates.

## 2. Local `.env` files

Not tracked, and now ignored explicitly: `.gitignore` covers `.env` and its `.env.*` variants,
alongside the `.envrc` entry that was already there. That rule is preventive — nothing secret
is expected in a web build — and it costs nothing to have in place before it is needed.

There is **no `.env.example`** in this repository, because there is no build-time variable an
operator has to set. If one is ever added, it must contain commented placeholders only.

## 3. `config.json`

Two distinct files share a name, and confusing them is the trap:

* **`src/config.json` is tracked.** It is the compiled-in default web configuration — menu
  links, default preferences, feature toggles. It contains no credential and must not.
* **A deployment-level `config.json` is ignored** by the existing `.gitignore` entry and is
  fetched at run time (`src/scripts/settings/webSettings.js`, `src/hooks/useWebConfig.tsx`).
  It is *local deployment configuration*: whatever it holds is served to every browser that
  loads the app, so it must never contain a reusable credential.

Neither file is a secret channel. Both are public the moment the app is served.

## 4. Browser authentication material

Described from the code rather than from assumption, because inventing storage behaviour in a
security document is worse than omitting it.

* The application does **not** implement its own credential persistence. It instantiates the
  `Credentials` provider supplied by the third-party `jellyfin-apiclient` package
  (`src/lib/jellyfin-apiclient/ServerConnections.js`), and that package owns how a server
  record and its `AccessToken` are persisted in the browser — under the `jellyfin_credentials`
  key in `localStorage`.
* The app's own preference layer, `AppSettings`
  (`src/scripts/settings/appSettings.js`), also uses `localStorage`, for preferences only.
* An `AccessToken` is issued by the server at sign-in and travels on subsequent requests; the
  generated SDK sends it as a bearer credential (`src/lib/tesserafin-sdk/generated/common.ts`).

What follows from that, stated plainly rather than dressed up: **a session token in
`localStorage` is readable by any script running on the origin.** That is the existing runtime
model inherited with the fork, it is not changed here, and this document does not claim it is
stronger than it is. Changing it is a product decision, not a scanning one.

What this repository *can* guarantee, and does: no token, no password and no provider key is
ever committed. The gate in §6 is what enforces that.

## 5. No server or provider credential belongs here

A server-side credential — a metadata provider API key, a database credential, a registry
token — has no legitimate home in web source, web tests, the bundle or the build
configuration. Provider keys are operator-supplied on the **server**, stored under
`/config/plugins/configurations`, and never leave it.

This is not hypothetical for this repository. The only two post-fork findings in its history
are the two commits of a **negative-login** end-to-end fixture — a value deliberately passed to
`signIn()` to be rejected, then searched for in the console output to assert the server never
echoes a submitted password. It was conclusively not a secret, and it was closed in
[PR #96](https://github.com/tesserafin-project/tesserafin-web/pull/96) by assembling the value
from fragments at run time, **not** by suppressing the rule. Both commits remain immutable and
are baselined by exact fingerprint, classified as what they are rather than as inherited
history.

## 6. What the repository-owned gate does and does not do

`ci/secret-scan.sh` scans the current tree and the complete history, fails closed on three
verdicts (`0` clean, `1` findings, `2` indeterminate), and runs automatically on every pull
request, every push to `main`, and weekly. See [`docs/local-ci.md`](local-ci.md) to run it
locally.

It **detects**. It does not **prevent**. By the time it runs, GitHub has already accepted the
push. Preventing the push requires GitHub-native push protection, which requires GitHub Secret
Protection, which a private repository on a free organisation plan does not have — tracked by
[tesserafin-project/tesserafin#96](https://github.com/tesserafin-project/tesserafin/issues/96)
and [#94](https://github.com/tesserafin-project/tesserafin/issues/94).

## 7. If a credential is committed anyway

1. **Rotate it first.** Deleting the commit does not un-publish it.
2. **Do not rewrite history.** The historical baseline records inherited findings with their
   provenance and disposition — exact fingerprints only, never a path-wide, rule-wide or
   regex-wide suppression.
3. **Do not add the fingerprint to `.gitleaksignore` to make CI green.** A new finding needs an
   owner disposition. A baselined historical fingerprint cannot excuse a current-tree
   recurrence of the same value, and there is a control that proves it.
