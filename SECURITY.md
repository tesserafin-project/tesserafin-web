# Security policy — Tesserafin Web

This policy covers the **`tesserafin-project/tesserafin-web`** repository: the
Tesserafin browser client. The Tesserafin server has its own policy with the same
contract and a different scope — see
[`tesserafin-project/tesserafin/SECURITY.md`](https://github.com/tesserafin-project/tesserafin/blob/master/SECURITY.md).

## 1. Supported versions

**Tesserafin has not published its first Stable release yet.** Public Tesserafin
SemVer begins at `1.0.0`; the `13.x` web and `12.x` server numbers inherited from
upstream history describe a lineage, not a Tesserafin release history. This is
recorded authoritatively in the server repository's
[`docs/versioning-policy.md`](https://github.com/tesserafin-project/tesserafin/blob/master/docs/versioning-policy.md),
which governs both repositories — the server and the web client share one version
number.

Consequently:

* Reports concerning the **current release candidate and the current default branch
  (`main`)** are accepted.
* Reports concerning the pre-release development web-assets images are accepted, but
  those images are internal, unsupported development artifacts and carry no
  compatibility or support promise.
* **Once public releases begin, the latest Stable release is the supported public
  line.** This section will be updated at that point.

There are no beta, nightly or long-term-support channels. Do not assume one exists.

## 2. Confidential reporting

**Use the repository's Security tab and select "Report a vulnerability" to submit a
private vulnerability report. Do not open a public issue for a suspected
vulnerability.**

That form opens a private security advisory readable only by you and the Tesserafin
maintainers. Never report a suspected vulnerability through a public issue, a public
discussion, a pasted log, an ordinary pull request, or any other public channel:
doing so discloses the problem to everyone before a fix exists. This also means the
general support route in [`.github/SUPPORT.md`](./.github/SUPPORT.md) is **not** the
route for a suspected vulnerability.

**Ordinary bugs belong in public issues.** A crash, a rendering defect, a broken
playback path, or any other defect with no security impact is reported the normal
way, in this repository's public issue tracker — not through the private advisory
form. If you are unsure which one applies, use the private form; a maintainer will
move it to a public issue if it turns out to carry no security impact.

**No Tesserafin email address is currently advertised.** The private advisory form
above is the only confidential intake channel this project operates, and this policy
will not publish an invented or personal address in place of one. If you genuinely
cannot use the GitHub form, open a public issue that says only that — with **no**
vulnerability detail of any kind — and a maintainer will arrange another route.

Tesserafin Web is a fork of Jellyfin Web. Tesserafin issues are not upstream issues:
do not route Tesserafin vulnerability reports to the Jellyfin project's security or
support channels, and do not assume any upstream security promise, response time or
contact applies here.

## 3. Response expectations

These are **targets, not guarantees**. Tesserafin is maintained by volunteers and
makes no contractual commitment of anyone's time.

| Stage | Target |
| --- | --- |
| Acknowledgement that the report was received | within **7 calendar days** |
| Initial assessment, or a request for more information | within **14 calendar days** |
| Coordinated updates while investigation or remediation continues | at a cadence agreed with the reporter |
| Disclosure timing | agreed with the reporter when practical |

If a target is missed, the report is not dismissed — it is late. Nothing in this
section creates an entitlement to a fix, a timeline, or a specific outcome.

## 4. What to include in a report

* The **affected repository and component** — for example authentication or session
  handling, the playback UI, a specific route or view, the service worker, or the
  build/dependency chain.
* The **version or exact commit**, and where relevant the web-assets image digest or
  the server build the client was talking to, so the report can be reproduced against
  the same artifact.
* **Reproducible steps**, in the smallest form that still triggers the problem —
  including browser and version, since this is a browser client.
* The **impact**: what an attacker gains, and what precondition or privilege level
  they need to start from.
* **Minimal proof** — the least evidence that demonstrates the issue.

Do **not** include live credentials, API keys, session tokens, access tokens,
production data, or personal data belonging to anyone other than yourself. Browser
artefacts are easy to over-share: strip access tokens and session identifiers from
HAR files, DevTools exports, `localStorage` dumps, console logs and screenshots
before attaching them. If a report cannot be made without such a value, say so in the
private advisory and wait for a maintainer to arrange a safe transfer — never send it
through a public one.

## 5. Coordinated disclosure and researcher conduct

* Allow the maintainers **reasonable time to investigate and patch** before publishing
  any detail. Timing is agreed with the reporter where practical.
* Test only against instances you own or are explicitly authorised to test.
* **Avoid destructive testing**: no data deletion or corruption, no persistence or
  backdoors, no denial of service or other service disruption, no lateral movement,
  and no access to data belonging to unrelated users.
* Stop at the point where the vulnerability is demonstrated. Do not extract more data
  than the minimum needed to prove it.
* **There is no bug-bounty programme and no reward, payment or recognition is
  promised**, unless a future written programme published by the project says
  otherwise.

## 6. Diagnostics and privacy

Tesserafin's diagnostics posture is a published decision, not an implicit one. Read
it before attaching diagnostic output to a report. The decision lives in the server
repository because that is where the diagnostics are produced and stored:

* **Policy decision:**
  [tesserafin-project/tesserafin#80 — historical diagnostic surfaces and the scope of the #75 closure test](https://github.com/tesserafin-project/tesserafin/issues/80)
  (closed as completed; the decision and its per-surface rulings are in its closure
  comments).
* **Implementation:**
  [tesserafin-project/tesserafin#85 — slice 75a, closed contract-mapping diagnostic behind the existing shadow gate](https://github.com/tesserafin-project/tesserafin/pull/85)
  and
  [tesserafin-project/tesserafin#86 — slice 75b, bounded single-pass structural scan of the request body](https://github.com/tesserafin-project/tesserafin/pull/86).
* **Open follow-ups:**
  [tesserafin-project/tesserafin#82 — strict UUID type for `PlaybackAttemptId` (future contract)](https://github.com/tesserafin-project/tesserafin/issues/82),
  [tesserafin-project/tesserafin#83 — structured `DivergenceSummary` codes (future, conditional)](https://github.com/tesserafin-project/tesserafin/issues/83),
  [tesserafin-project/tesserafin#84 — shareable redacted fixture export (future)](https://github.com/tesserafin-project/tesserafin/issues/84).

What that means in practice:

* **Diagnostic collection is bounded and structured.** Shadow diagnostic records are
  captured only when the shadow mode actually ran, are held in memory, are evicted on
  the session lifecycle, and introduce no separate persistence. Divergence summaries
  are server-generated; no client string is interpolated into them.
* **The client's obligation:** `PlaybackAttemptId` is a correlation value. Official
  clients **must** generate a fresh random UUID per playback attempt and **must never**
  put a stable installation or device identifier in it — that would turn a
  per-attempt correlation value into a cross-attempt tracker. See [tesserafin-project/tesserafin#82](https://github.com/tesserafin-project/tesserafin/issues/82).
* **The elevated fixture export must not be assumed safe for public sharing.** It is a
  deliberate pull by an elevated administrator, never produced or uploaded
  automatically, and it contains diagnostic capabilities and identifiers. Treat its
  output as sensitive by default.
* **tesserafin-project/tesserafin#84's shareable redacted export is future work, not a delivered feature.** There
  is currently no redaction pass you can rely on. Do not treat any existing export as
  pre-redacted.
* **Reporters must redact before sharing evidence**: remove tokens, API keys, session
  identifiers, user and device identifiers, absolute filesystem paths, internal
  hostnames and network addresses, and any media metadata you do not intend to
  disclose.

## 7. Scope of this policy

**In scope for this repository:**

* the browser client itself — rendering, routing, views and their client-side logic;
* authentication and session handling in the browser, including token storage,
  session lifetime and sign-out;
* the playback UI and the client half of the playback lifecycle, including teardown
  and error paths;
* the dependency and build chain — `npm` dependencies, bundler configuration and
  build output;
* the bundled web assets and the web-assets container image published from this
  repository, including anything the server serves from that bundle.

**Out of scope here** (report against the correct repository instead):

* the HTTP API, playback decisions, transcoding, the server container runtime,
  server-side diagnostics and server packaging — see
  [Tesserafin Server's policy](https://github.com/tesserafin-project/tesserafin/blob/master/SECURITY.md);
* upstream Jellyfin Web code as shipped by upstream, and upstream infrastructure;
* findings that require a privilege level the attacker is already assumed to hold
  legitimately, unless the report shows a privilege boundary being crossed;
* missing hardening with no demonstrated impact, and automated scanner output with no
  reproduction.

Enforced CI, including static security analysis, is **not** yet restored across both
repositories — that gap is tracked in
[tesserafin-project/tesserafin#94](https://github.com/tesserafin-project/tesserafin/issues/94)
and is not a substitute for this policy, nor is this policy a substitute for it.
