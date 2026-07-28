# Vendored test-only third-party code

Nothing in this directory is shipped. It is loaded by the Playwright suite only, injected into an
already-built page at test time, and never imported by anything under `src/`.

## `axe.min.js`

| | |
|---|---|
| Package | [`axe-core`](https://www.npmjs.com/package/axe-core) |
| Version | `4.12.1` |
| Upstream file | `package/axe.min.js` inside `https://registry.npmjs.org/axe-core/-/axe-core-4.12.1.tgz` |
| SHA-256 | `66a8aaa95a8b044a7fd74a5435873bf04ff65a1ca75567c921b7509742085a14` |
| License | MPL-2.0 (Deque Systems) |

### Why it is vendored instead of being a devDependency

`axe-core` as a `devDependency` is the ordinary choice, and it is a reasonable thing to want here.
Two constraints in this repository's release process point the other way.

**1. The release-pair gate treats the lockfile as a production build input.**
`tesserafin/tesserafin` `ci/verify-release-pair.sh` proves that a published server image really
bundles a named web commit, and it allows the web checkout driving the suite to be *ahead* of the
bundled commit on exactly one condition — that every changed path is outside the production build's
inputs:

```
PRODUCTION_TOUCHED="$(printf '%s\n' "${WEB_DIFF}" \
  | grep -E '^(src/|webpack\.|package-lock\.json$|\.nvmrc$|config\.json$)' || true)"
```

and `package.json` is compared key by key with only `scripts` ignored. A `devDependency` changes
two disqualifying paths, so any commit carrying one can never again be validated against an image
built before it — including images whose shipped bytes are identical.

**2. The engine has no business in the production dependency graph.** It is injected into an
already-built page by the browser suite. It is never imported by anything under `src/`, never
resolved by webpack, and never reaches a shipped bundle. Declaring it in `package.json` would put a
559 KB browser library into the graph that `npm ci` installs for every build of this repository,
for a file that only Playwright ever reads.

Being explicit about what this does NOT buy: the commit that introduces this file also changes
`src/`, so the release image is being rebuilt anyway. Vendoring is not what keeps this change
test-only, and it should not be described that way.

### The cost, stated plainly

A committed 559 KB minified third-party artifact is not visible to a dependency scanner, and
supply-chain scanning is an open umbrella item (`tesserafin/tesserafin#95`, C2). The mitigation is
the pinning below, not an argument that the concern does not apply.

### How it is kept honest

The file is pinned by content, not by trust. `tests/e2e/support/axe.ts` hashes it and refuses to
inject it unless the digest matches the value recorded above, so a modified or substituted engine is
a test failure rather than something a reviewer has to notice.

### How this ends

This is a workaround for a gate that cannot currently express "devDependency-only". Replacing it
with a normal `devDependency` once the gate can is tracked separately; until then, updating the
engine means replacing the file and the recorded SHA-256 in the same commit.
