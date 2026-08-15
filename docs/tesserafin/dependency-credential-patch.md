# Containing `jellyfin-apiclient`'s credential logging

`jellyfin-apiclient@1.11.0` publishes the durable session credential to the browser console. This
document records what it discloses, what `scripts/patch-jellyfin-apiclient.mjs` does about it, and
the condition under which that script should be deleted rather than maintained.

Issue: **#152**. Related credential-transport defect: **#153**. Related console-volume scope: **#75**.

## Why a dependency needed patching at all

tesserafin-web #154 removed the first-party console sinks and added an AST gate over `src/`. Neither
reaches a dependency's own bundled `console.log`, and `overrides` pins a version — it does not
rewrite one. The package ships a single prebuilt artifact, `dist/jellyfin-apiclient.js`, and the
statements are inside it.

The clearest case is `openWebSocket`:

```js
var e = this.accessToken();
url += "api_key=" + e;
console.log("opening web socket with url: " + url);
```

That token is not media-scoped: the server accepts `ApiKey`/`api_key` from the query string on every
endpoint and resolves it to the owning user's session, with no expiry applied. It fires on every
sign-in, so the affected population is *everyone who signed in*, not everyone who played something.

## The closed inventory

The published bundle contains **56** `console.*` calls. Every distinct call text occurs exactly once,
which is what makes an exact-fragment rewrite deterministic rather than a guess.

**13 are credential-capable and are rewritten.** `credentials` means the value is the credential
itself; `url` means the value is a full request or socket url, which can carry `ApiKey`/`api_key`.

| # | Category | Statement | Replaced with |
| ---: | --- | --- | --- |
| 0 | credentials | `openWebSocket` — the socket url built with `api_key=<accessToken()>` (**#152**) | `"opening web socket"` |
| 1 | credentials | the credentials-store read — prints the whole `jellyfin_credentials` document, `AccessToken` included | `"loaded stored credentials"` |
| 2 | url | `fetchWithFailover` — the request url | `"Requesting"` |
| 3 | url | `BitrateTest` — a `getUrl()` result, query parameters included | `"Requesting BitrateTest"` |
| 4 | url | ajax without automatic networking — the request url | `"Requesting without automatic networking"` |
| 5 | url | request failure — url plus the error | `"Request failed: " + error` |
| 6 | url | request timeout — the request url | `"Request timed out"` |
| 7 | url | `ConnectionManager` request — the request url | `"ConnectionManager requesting"` |
| 8 | url | `ConnectionManager` response — status plus url | `"ConnectionManager response status: " + status` |
| 9 | url | `ConnectionManager` failure — the request url | `"ConnectionManager request failed"` |
| 10 | url | `fetchWithTimeout` entry — timeout plus url | `"fetchWithTimeout: timeoutMs: " + ms` |
| 11 | url | `fetchWithTimeout` success — the request url | `"fetchWithTimeout: succeeded connecting"` |
| 12 | url | `fetchWithTimeout` timeout — the request url | `"fetchWithTimeout: timed out connecting"` |

Entry 1 is an addition beyond the "url sink" framing this work started from. It is not a url, but it
prints the stored credentials document verbatim, which is the same defect class as #152 and strictly
worse in what it reveals. Leaving it while shipping a fix for the WebSocket line would have been
indefensible.

No replacement interprets or reformats a url. Each is a constant, or a constant plus a value that is
already safe (an HTTP status, a timeout in milliseconds, an error object). A control asserts that no
replacement interpolates a url-valued variable, so a url cannot return under a new message prefix.

**Considered and deliberately retained:**

* the server-**address** lines — `getTryConnectPromise`, `Reconnect failed/succeeded to`,
  `connectToAddress`, `tryReconnect`, `Setting server address to`. An origin the user typed or the
  server advertised carries no credential: the token does not exist until a connection succeeds, and
  which candidate failed is the whole diagnosis. This is the same classification
  `scripts/console-url-hygiene.allowlist.json` already applies to the first-party copies.
* `console.log("unable to parse json content: " + e)` — prints a response body only when that body
  is *not* JSON, so it is neither a url sink nor a credential sink on any parseable response.
* the remaining ordinary diagnostics (`web socket closed`, `Begin connect`, KeepAlive debug lines,
  and so on), which carry no url and no credential.

## The patcher's boundary

`scripts/patch-jellyfin-apiclient.mjs` runs from `postinstall` and is pinned three ways:

| Pin | Value |
| --- | --- |
| package | `jellyfin-apiclient` |
| version | exactly `1.11.0` |
| pristine `dist/jellyfin-apiclient.js` | `b39363f92f6946407d57623068699520e26bd9e784c93aabf9754544aad04832` |
| patched `dist/jellyfin-apiclient.js` | `49aef09f849a52bdcfb05129110c5d8cc2820e4e082451cb062062fac659948b` |

Exactly three states are recognised. Pristine content is patched and re-verified; exactly-patched
content is accepted unchanged; **anything else is a failure**, never a silent skip. That covers a
changed version, a changed pristine hash, a missing or duplicated fragment, partially patched
content, a symlinked package directory, and a path that escapes the package root.

### Reading and writing the target safely

Both filesystem operations are install-time, security-sensitive code, and both were repaired after
review:

**Reading.** `O_NOFOLLOW` is the strongest symlink guard and is used wherever it exists. Node
exports it only under `#ifdef O_NOFOLLOW`, and Windows does not define it — so the obvious
`O_RDONLY | fsConstants.O_NOFOLLOW` evaluates to `0 | undefined` === `0` there: a plain,
symlink-**following** open, with no error and no warning, while every Ubuntu check stays green.
`openVerified()` resolves the constant into an explicit `null` instead, and reconstructs the same
guarantee from metadata so the two paths converge:

1. `fstat` the descriptor — it must be a regular file;
2. `lstat` the pathname without following it — it must be a regular file and **not** a symlink
   (unconditional, so this is redundant with `O_NOFOLLOW` and *is* the guarantee without it);
3. compare identity — the object behind the descriptor must be the object the pathname names, so a
   swap between the open and the check cannot redirect anything.

Every read is then of the descriptor, never of the pathname again. Where a filesystem reports no
inode, the fallback comparison is corroboration rather than identity, and the non-symlink `lstat`
carries the guarantee — that is stated plainly in the code rather than dressed up.

**Writing.** The temporary sibling is created with `wx` (`O_CREAT | O_EXCL | O_WRONLY`) under an
unpredictable per-invocation name, and written through that descriptor. The previous form wrote a
fixed `.s4d1.tmp` name with plain `writeFileSync`, which **follows** a symlink already sitting there
— a write-anywhere primitive at `npm ci` time for anyone able to create one file in `dist/`.
Cleanup unlinks only the path this invocation exclusively created; a pre-existing file whose name
merely resembles one of ours is never read, written or deleted.

`dist/jellyfin-apiclient.js.map` is deleted, and the pointer to it removed as part of the hashed
transform. The map embeds the pre-minification sources, so it carries every fragment being removed;
leaving it would make "no unsafe fragment remains in the installed package" false. Nothing consumes a
dependency map in a production build — `source-map-loader` is development-only.

The patcher never prints file content. Diagnostics name a fragment by its index in the table.

### Why not `patch-package`

A patching dependency is a new install-time supply-chain surface, added to close a supply-chain
disclosure. This script has no dependency beyond Node's standard library and is reviewable in one
sitting.

### `postinstall` is not the gate

`npm ci --ignore-scripts` leaves the package pristine, so a skipped lifecycle hook must not be able
to produce a green build. `verify:jellyfin-apiclient-patch` fails on pristine content and runs as its
own leg of the required quality-checks matrix. `verify:console-url-hygiene:bundle` is the second
line: since #152 it fails on **any** retired sink in the shipped bundle, dependency or first-party.

## When to delete this

Delete the script, its controls, its CI legs and this document when **either**:

* `jellyfin-apiclient` is replaced by the SDK-based client; or
* an upstream release is published whose bundle is independently verified to contain none of the
  fragments above.

Bumping the version alone does not satisfy that. An unpinned version makes the patcher exit 1 on
purpose — the prompt to re-inventory the new bundle, not to widen the pin.

## What this does not fix

The credential is still **in the url** (#153). Chromium writes its own `WebSocket connection to
'…' failed` message when a socket connection fails, quoting the url — including its `api_key`
parameter — because the browser quotes it, not because any script logged it. No change to this
repository or to its dependencies can remove that; only moving the credential out of the url can.
The runtime regression counts and reports those events separately, and bounds them, so the bucket
cannot become somewhere a real disclosure hides.
