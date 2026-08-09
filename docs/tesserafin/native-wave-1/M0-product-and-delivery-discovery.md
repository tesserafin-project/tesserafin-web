# Native Wave 1 — M0: product and delivery discovery

- **Status**: Draft for maintainer review. **M0 is not complete and is not proposed for closure.**
- **Milestone**: [`tesserafin#222`](https://github.com/tesserafin-project/tesserafin/issues/222)
- **Umbrella**: [`tesserafin#221`](https://github.com/tesserafin-project/tesserafin/issues/221)
- **Fixed inputs**: [RFC-0006 — Native-client foundation](../RFC-0006-native-client-foundation.md)
  and [RFC-0008 — Paid native-client distribution, Tesserafin accounts and entitlements](../RFC-0008-paid-client-distribution-and-entitlements.md),
  both **Accepted 2026-08-09**.
- **Evidence**: every material claim cites an ID from
  [`M0-evidence-register.md`](./M0-evidence-register.md). External sources were accessed
  **2026-08-09**.
- **Baselines observed**: `tesserafin-web` `main` = `2da3ce4c0b39718cb3602b50712d23d2c70f6f4f`;
  `tesserafin` `master` = `1cca371cbaeef63a03e055eab158b8a51759f92f` (I-09).

> **This document creates no application, no repository, no dependency and no store resource.**
> `tesserafin-mobile` does not exist and is not created here. No Android or Kotlin code is written.
> No library or version is selected. No package identifier is registered.

## Reading convention

Four kinds of statement appear below, and they are never blended into one sentence:

| Tag | Meaning |
| --- | --- |
| **`FACT`** | Evidenced. Carries an evidence ID. If the source moves, the fact moves with it. |
| **`REC`** | A recommendation this document makes, and defends. Reviewable, arguable, not yet decided. |
| **`ASSUMPTION`** | Provisional. Stated explicitly so it can be falsified cheaply rather than discovered late. |
| **`OWNER`** | Not this document's to decide. Every one of these appears in §14. |

Where a statement would otherwise read as a platform rule but is Tesserafin's own judgement, it is
tagged **`REC`**. That distinction is load-bearing: `minSdk`, for example, is a Tesserafin decision
with consequences, not something any store requires.

---

## 1. Executive summary

This is the first bounded iteration of M0. It reconciles the two accepted RFCs against the server and
Web implementation as they actually stand today, re-verifies the Android channel constraints that
RFC-0008 §15 requires to be re-verified before any implementation issue is opened, and turns the
result into two separate flow inventories (phone/tablet and TV), a commercial state model, a
repository boundary, a reduced M1 proposal and ten owner questions.

**The five findings that change what wave 1 should do:**

1. **Code-based TV pairing already exists on the household server — but it cannot be a household's
   first sign-in.** `/QuickConnect/Initiate`, `/Connect`, `/Enabled` and `/Authorize` are in the
   committed contract, and `QuickConnectAvailable` defaults to `true`. Decisively,
   `/QuickConnect/Authorize` requires an **already-authenticated session** (I-03). So a television is
   a fine *second* client and cannot be a household's *first* one without either remote text entry or
   a server capability that does not exist today (§7.4).
2. **Server auto-discovery exists, defaults on, and lives outside the OpenAPI contract.** A UDP
   responder on port 7359 returns `ServerDiscoveryInfo { Address, Id, Name, EndpointAddress }`
   (I-04). A generated transport layer cannot produce it; a native client must implement the
   datagram exchange by hand, inside layer 2's server-identity semantic (T-05).
3. **The Play target-API rule now differs between phone and TV, and the deadline is 22 days after
   this document was written.** New apps and updates must target API 36; Android TV must target
   API 34 or higher; enforcement begins **31 August 2026** (P-01). One `targetSdk 36` satisfies both
   rows, but Android 16 also turns predictive back on by default and removes the edge-to-edge opt-out
   (P-13) — so "raise targetSdk" is shell work, not a build-file line.
4. **A single Play listing serving phone, tablet and TV is the supported shape** — Google's own
   recommendation, achieved with a leanback launcher activity plus
   `android.software.leanback` and `android.hardware.touchscreen` declared `required="false"`
   (P-08). Jellyfin ships two packages (X-02), but its phone client is a WebView wrapper (X-01) and
   Tesserafin's is not (T-04, T-11) — so their reason to split is not ours.
5. **AppLlama's corpus is iOS-only** — "28,600+ screens from 700+ top-earning iOS apps" (A-01) — and
   its terms explicitly permit the research this project proposed while forbidding every shortcut the
   loop had already banned (A-02, A-03). The verdict is **`DEFER PRO UNTIL VISUAL DESIGN`** (§12).

**What this iteration did not settle**, and says so rather than guessing: thirteen named evidence gaps
(register §F), of which G-01 (Android version reach) and G-03 (Play Console TV form-factor
mechanics) are the two that most directly limit §4 and §14 Q1/Q3.

**No hard stop fired.** RFC-0006 and RFC-0008 do not contradict each other on any M0 decision; no
current store rule makes an accepted D2 decision impossible (§2.3); no branch or PR already owns this
document scope (I-09); AppLlama's terms permit the proposed use (A-02); no credential, purchase or
account was needed; and the branch carries two Markdown files and nothing else.

---

## 2. Fixed RFC inputs

### 2.1 What is already decided

**`FACT`** These are inputs. Nothing in this document reopens them; where a section appears to
approach one, it is drawing a consequence, not renegotiating.

| Input | Source |
| --- | --- |
| Web is the desktop/browser reference client; native clients embed no part of it | T-01, T-11 |
| Wave 1 is Android + Android TV; no native Windows/macOS/Linux client is planned | T-03 |
| KMP carries protocol, session and domain logic only, and only where it genuinely reduces duplication; UI is native per platform | T-04 |
| Three contract layers; layer 2 owns the eleven cross-client semantics; layer 1 is not the domain model | T-05 |
| A client declares a minimum supported server, tolerates unknown fields and enum members, and **fails closed with a named reason** when compatibility cannot be established | T-06 |
| Shared semantics, explicitly **not** pixel-identical rendering; accessibility invariants inherited by every renderer, stricter of platform-or-theme wins | T-08 |
| Twelve responsibilities are permanently platform-owned | T-09 |
| Media access is never coupled to the licensing control plane; nothing about a household's media reaches Tesserafin infrastructure by default; no secret ships in a client | T-10 |
| An entitlement activates the official native app on a device and does nothing else; no tiering; an unentitled install is not a brick | T-12, T-13 |
| Android: free download, full unlock by one non-consumable in-app purchase — decided now because free→paid is irreversible | T-14 |
| Sign-in is OAuth 2.0 code + PKCE `S256` in the **system browser**, public client, no password field in the app, first-party identity only at launch, passkey-first | T-16 |
| Device-bound, non-bearer, asymmetrically signed lease; 30-day lease + 14-day grace; 44-day maximum revocation delay, conditional on the sunset guarantee | T-17, T-18, T-21 |
| Seat / device / shared household device are distinct; individual = 1 seat / 5 devices | T-19 |

### 2.2 Traceability — M0 concerns against the RFCs and the implementation

Statuses are limited to the seven `#222` permits: `fixed`, `supported by current server`,
`client-owned`, `server prerequisite`, `commercial-service prerequisite`,
`unresolved owner decision`, `deferred`.

| M0 concern | RFC source | Existing implementation evidence | Native requirement | Status |
| --- | --- | --- | --- | --- |
| Household-server authentication | RFC-0006 §3.2 (session lifecycle) | `/Users/AuthenticateByName`, `/Users/AuthenticateWithQuickConnect`, `/Sessions/Logout`, `/Users/Me` in the committed contract (I-02) | Native sign-in against the household server, session stored in platform-protected storage (T-09) | supported by current server |
| Server discovery | RFC-0006 §3.2 (server discovery and connection identity) | `AutoDiscoveryHost` UDP :7359, `NetworkConfiguration.AutoDiscovery = true`, `ServerDiscoveryInfo` (I-04) | A hand-written datagram exchange inside layer 2 — the generator cannot emit it | supported by current server |
| Manual server entry | RFC-0006 §3.2 | No contract dependency; the client holds the address | Always available as the fallback when discovery returns nothing (G-09) | client-owned |
| TV pairing without text entry, household's **second** client | RFC-0006 §3.2 | QuickConnect present and enabled by default (I-03) | Client implements initiate/poll; user authorises from a signed-in client | supported by current server |
| TV pairing as a household's **first** client | RFC-0006 §3.2 | `/QuickConnect/Authorize` requires `DefaultAuthorization` (I-03) — no unauthenticated path exists | A first-sign-in pairing that does not presuppose an existing session | **server prerequisite** (§7.4) |
| QR-code pairing | — | Nothing in the contract (I-03) | Not required by any RFC; not invented here | deferred |
| Generated API/SDK provenance | RFC-0006 §4.1 | `contract.lock.json` `(1.0.0, c18438ee…)` (I-01); Web SDK pinned to `sourceCommit 1d0e91b7…` / `specSha256 d234d2a8…`; `ci/web-pair.lock.json` (I-07) | The same `(version, sha256)` pinning and a native pair lock, honestly representing slack between pins | client-owned |
| Minimum supported server | RFC-0006 §4.2 | `versions.ts` derives `MINIMUM_VERSION` from the pinned spec (I-07) | Same pattern; no upstream package's version number | client-owned |
| Compatibility failure behaviour | RFC-0006 §4.3 | Web `ConnectionManager` emits `ServerUpdateNeeded` (I-07) | Fail closed, named reason, distinguishable from unreachable and from session-expired | client-owned |
| Content-pack semantics | RFC-0006 §3.2; content-pack contract §4.4.1 | `/ContentPacks*`, `/Items/{itemId}/ContentPacks`; preference on `UserConfiguration`, read/written via `/Users/Me` and `/Users/{userId}/Configuration` (I-05) | Observe the server-side preference; never re-derive it per client | supported by current server |
| Theme semantics | RFC-0006 §5.1; RFC-0007 | `/Branding/Css` is a Web-shaped surface; `renderers.android` / `renderers.tv` slots reserved but unimplemented (I-08) | Consume generated serialisations of the `tesserafin-design` schema, never a parallel redefinition | deferred |
| Playback decision semantics | RFC-0006 §3.2 | `/Items/{itemId}/PlaybackInfo` and `/System/PlaybackDiagnostics/*` present; RFC-0006 records diagnostics `null` by default and v2 in shadow, off (I-06) | Express *absent-because-legacy* versus *absent-because-nothing*; never a confident wrong explanation | supported by current server, **partially** — see G-10 |
| Playback conformance fixtures | RFC-0006 §4.5 | `/System/PlaybackDiagnostics/Sessions/{id}/Fixture` already exports one (I-06) | Generalise this shape; do not invent a second one | supported by current server |
| User permissions | RFC-0006 §3.2 | `/Users/{userId}/Policy` (I-02) | Render "you may not" as the server's answer; never evaluate authorization client-side | supported by current server |
| Session revocation observable mid-use | RFC-0006 §3.2; `#221` gate 2 | `/Sessions/Logout` present; revocation-by-another-party not established (G-08) | A client must react to an invalidated session without data loss | supported by current server, **unverified** — see G-08 |
| Web first-run and playback flows | RFC-0006 §1.3 | Web remains the reference client | Native clients take no Web code and no Web layout | fixed |
| Tesserafin account, purchase, lease, activation | RFC-0008 §5–§9 | Nothing exists — no account service, no entitlement issuer | Every commercial surface | **commercial-service prerequisite** |
| Passkey-first sign-in on Android | RFC-0008 §5.4 | — | Digital Asset Links hosted on a Tesserafin-controlled domain (P-17) | commercial-service prerequisite |
| Sunset / exit mechanism | RFC-0008 §11.1 | — | Precondition of the **first paid release**, and the condition on which the 30 + 14 offline policy was accepted (T-18, T-21) | commercial-service prerequisite |
| Application identifier and store topology | RFC-0008 §4.3 | — | Permanent under P-02 | **unresolved owner decision** (Q1, Q2) |
| Play developer account ownership | RFC-0008 §4.3 | — | Determines signing (P-18) and testing obligations (P-19, G-04) | **unresolved owner decision** (Q4) |
| Supported Android / Android TV range | — | — | A Tesserafin recommendation, not a store rule | **unresolved owner decision** (Q3) |
| `tesserafin-mobile` creation | RFC-0006 §2.1 | Repository absent (I-09) | Explicit maintainer approval (`#222` criterion 7) | **unresolved owner decision** (Q10) |
| iOS / tvOS, webOS / Tizen | RFC-0006 §2.2; RFC-0008 §4.1 | — | Waves 2 and 3 | deferred |

### 2.3 RFC-0008 §15 currency re-check (required before any derived implementation issue)

**`FACT`** RFC-0008 §15 states that "before any implementation issue derived from this RFC is opened,
§2 must be re-verified against the same primary sources." M1 is such an issue. The Android-relevant
tags were re-read on 2026-08-09:

| RFC-0008 tag | Re-read as | Verdict |
| --- | --- | --- |
| `[G-POL]` Payments policy | P-03 | **Unchanged in substance.** Play billing is still mandatory for in-app digital purchases; the exemption list still does not describe a paid media client; anti-steering language intact. |
| `[G-INT]` Billing integration | P-04 | **Unchanged in substance**, and additionally supplies PENDING-state semantics RFC-0008 did not record: entitlement is granted only on `PURCHASED`, and the three-day acknowledgement window starts at the `PENDING → PURCHASED` transition. |
| `[G-SEC]` Security and verification | P-05 | **Unchanged in substance.** `purchaseToken` as globally unique primary key; `orderId` explicitly unsuitable; `Purchases.products:get`; `Orders:refund` with `revoke=true`; `setObfuscatedAccountId`. |
| `[G-RTDN]` Real-time developer notifications | P-06 | **Unchanged in substance**, including the rule that a notification is a trigger to re-query, never the fact itself. |
| `[G-PRICE]` Free/paid pricing | P-02 | **Unchanged in substance.** Free → paid remains impossible under the same package name. |
| `[G-KS]` Keystore | P-07 | **Unchanged in substance.** Key material never enters the app process; TEE/StrongBox binding; `getSecurityLevel()`; ECDSA/ECDH P-256 in StrongBox. |

**`FACT`** RFC-0008 §15 says "§2", not "§2.1", so the standards row is in scope as well. `[R-8252]`
(OAuth 2.0 for Native Apps), `[R-7636]` (PKCE) and `[OIDC]` (OpenID Connect Core 1.0) are **published
documents that are immutable at the URLs RFC-0008 cites**; the re-check is satisfied by construction,
and RFC-0008 §5.3's system-browser-plus-PKCE requirement (T-16) is unaffected. The webOS and Tizen
rows (RFC-0008 §2.3, §2.4) are out of scope for wave 1 and were deliberately not re-read; RFC-0008
§4.5 already requires them to be re-verified at the point webOS is scheduled.

**`FACT`** No re-read rule makes an accepted D2 decision impossible. Specifically, P-02 still
supports RFC-0008 §4.3's reason for deciding the Android pricing model now, and P-03 still supports
§4.3's anti-steering construction. **The "current store rule makes an accepted D2 decision
impossible" hard stop does not fire.**

**`FACT`** Two items in this re-check are *new information* rather than confirmation, and both
belong to a milestone later than M1: the PENDING-state grant rule (P-04) and the three-day
acknowledgement deadline (P-04). They are carried into the commercial state model (§8) so they are
not rediscovered during implementation.

---

## 3. Product identity

### 3.1 Display names

**`REC`** The application is called **Tesserafin** on both form factors. Not "Tesserafin Mobile", not
"Tesserafin TV", not a suffixed variant.

**Reason.** RFC-0006 §5.2's whole architecture is that two official clients are *recognisably the
same product* without being pixel-identical (T-08). A name suffix is the cheapest possible way to
tell a user they are holding a lesser or different thing, and it would contradict RFC-0008 §3.2(4)'s
"no tiering, no degraded mode" (T-12) at the very first surface a user sees. The TV launcher banner
must contain the app name (P-09, TV-BN), and "Tesserafin" is what it should say.

**`FACT`** If one Play listing serves both form factors (§4.1), there is one store title anyway; the
in-app and launcher labels are the only place a divergence could appear.

### 3.2 Provisional application identifier

**`OWNER`** — Q2. Not registered here, and irreversible in practice (P-02).

**`REC`** **`org.tesserafin.android`**, single application ID for phone, tablet and TV.

**Reason.** RFC-0008 §5.1 names `tesserafin.org` as the official infrastructure domain (T-16), so
`org.tesserafin.*` is the corpus-consistent reverse-domain form and is the same namespace the
Digital Asset Links file for passkeys will have to be served from (P-17). The `.android` leaf keeps
`org.tesserafin.ios` and `org.tesserafin.tizen` available for waves 2 and 3 without renaming anything.

**Viable alternative.** `org.tesserafin.app`, on the argument that the platform is not part of the
product's identity. Rejected as the recommendation because it forecloses a per-platform namespace
that costs nothing to keep, and because on a store where one listing is per-platform anyway the
platform *is* part of the artefact's identity.

**Rejected outright.** Any identifier containing `mobile`, because the same package will run on
televisions and the name would be wrong on the larger half of wave 1. Note that the *repository* is
named `tesserafin-mobile` by RFC-0006 §2.1 (T-02) — that is a repository name, decided, and it does
not oblige the application identifier to match it.

**`FACT`** Whatever is chosen is permanent for the free-download-plus-in-app-unlock model: changing
it later means a new listing and the loss of every install and review (P-02).

### 3.3 What the identity may not imply

**`FACT`** The application name and store listing must not suggest that a Tesserafin account is
needed to use a Tesserafin server, because it is not (T-10, T-12). Store-listing copy is out of scope
here and is flagged for the milestone that writes it.

---

## 4. Platform and store topology

### 4.1 One listing or two

**`REC`** **One Play listing, one application ID, one artefact serving phone, tablet and Android TV.**

**`FACT`** The supported mechanism is documented (P-08): a `LEANBACK_LAUNCHER` activity marks the app
as TV-enabled, `<uses-feature android:name="android.software.leanback" android:required="false" />`
keeps it installable on handhelds, and `<uses-feature android:name="android.hardware.touchscreen"
android:required="false" />` is mandatory — "Otherwise, your app doesn't appear in Google Play on TV
devices." Google's own guidance: "We recommend that you have a single app that supports both mobile
devices and TV devices."

**`FACT`** Two distinct banner artefacts are required and they are not interchangeable: an **in-app**
`android:banner` drawable at **320 × 180 px xhdpi** with the app name burned in and one variant per
supported language (P-08, P-09 TV-LB/TV-BN), and a **store-listing** banner at **1280 × 720 px**,
JPEG or 24-bit PNG without alpha, plus at least one Android TV screenshot before the app can be
published (P-20).

**Viable alternative.** Two listings and two packages, as Jellyfin does — `org.jellyfin.mobile` and
`org.jellyfin.androidtv` (X-01, X-02).

**Why the alternative is not recommended.** Jellyfin's split is explained by its own asymmetry: the
phone client is a WebView wrapper by its README's own description (X-01) and the TV client is not.
Tesserafin has decided both are native (T-04) and has rejected WebView wrappers outright (T-11), so
the structural reason for the split does not transfer. Against splitting: two listings means two
review surfaces, two release trains, two sets of store assets, and — critically under RFC-0008 §4.6
(T-15) — **two SKUs where one entitlement is intended**, which multiplies the purchase-recognition
problem for no product benefit. A user who owns Tesserafin on their phone and installs it on the
television should not meet a purchase screen.

**`ASSUMPTION`** That a single Play entry can be distributed to the TV form factor without a separate
app record. P-08 and P-20 both describe TV distribution as a property of an app rather than a
separate app, but the Play Console mechanics — a form-factor opt-in switch, and whether a TV build is
reviewed separately — were not confirmed (**G-03**). This assumption is cheap to falsify in the Play
Console once an account exists (Q4) and does not block M1.

### 4.2 Release-channel topology

**`REC`** Four channels, in this order, for a single listing:

1. **Internal testing** — up to 100 testers (P-19). This is where every M1–M4 artefact lands.
2. **Closed testing** — required as a gate before production for personal developer accounts created
   after 13 November 2023 (P-19); whether it binds Tesserafin depends on Q4.
3. **Open testing** — optional, and recommended to be *skipped* for a paid-unlock product until the
   sunset mechanism (T-21) exists, because an open test is a public release in every way that matters
   to a purchaser.
4. **Production** — gated on Track B in `#221`, not on Track A completeness.

**`FACT`** The content of the closed-testing requirement was not read this iteration (**G-04**).

### 4.3 Signing

**`FACT`** New apps are automatically enrolled in Play App Signing with Google-generated keys; Google
holds the **app signing key** used to sign delivered APKs, and the developer holds an **upload key**
(RSA ≥ 2048, in a `.jks`/`.keystore`) used to sign bundles before upload (P-18).

**`REC`** Accept Play App Signing. It is the documented default, it removes a key-custody problem
from a single-maintainer project, and RFC-0008 §4.3 already names "Google Play app signing / the
Play-managed signing key" as the package-signing authority (T-14) — this is not a new decision, only
its confirmation.

**`FACT`** The **upload key** is the maintainer's real custody obligation, and it is independent of
the lease signing key in RFC-0008 §7.3, which is never published and never lives in a repository
(T-21). Two different keys, two different threat models; M1's release/debug boundary must not blur
them.

---

## 5. Initial user vertical

### 5.1 The boundary this section draws

**`FACT`** RFC-0006 §2.2 chose Android first because the wave "exercises the most of this foundation
at once: a phone and a ten-foot remote-driven surface from one shared logic layer" (T-03). The first
vertical is therefore judged by one question: *does it force the layer-1/layer-2/layer-3 split to be
real?* Anything that does not is a candidate for deferral no matter how visible it is.

**`FACT`** The commercial account and the household-server login are **two different credentials on
two different trust planes that are never joined** (T-16, RFC-0008 §5.2). The first vertical touches
only the media plane. A user completing the entire first vertical never sees a Tesserafin account,
and that is correct, not a gap.

### 5.2 Phone/tablet first vertical — assessment of the ten candidate steps

| # | Candidate step | Verdict | Reason |
| --- | --- | --- | --- |
| 1 | Launch | **In** | Trivially required. |
| 2 | Discover **or** manually enter a local server | **In, both paths** | Discovery is supported and default-on (I-04) but unproven on real home networks (G-09). Shipping only discovery would make a first run fail with nothing to do. Manual entry is the shipped pattern in the self-hosted category (X-07). |
| 3 | Authenticate against that server | **In** | `/Users/AuthenticateByName` (I-02). Exercises layer 2's session lifecycle (T-05). |
| 4 | Browse a library | **In** | The minimum that proves the generated transport and the semantic layer both work. |
| 5 | Open item details | **In** | — |
| 6 | Display content-pack semantics | **In, reduced** | Read-only. The client **observes** `ContentPackBrowsingPreference` from `/Users/Me` and never re-derives it (I-05). Writing the preference is deferred — it is a settings surface, and the conformance assertion is about *observing*, not editing. |
| 7 | Request playback | **In** | — |
| 8 | Explain Direct Play / remux / transcode | **In, honestly reduced** | The surface exists (I-06), but RFC-0006 §3.2 records that on a default server the diagnostic fields are `null` and v2 runs in shadow, disabled (I-06), and this iteration did not re-measure which fields populate (**G-10**). The first vertical therefore ships the *distinction*, not a confident verdict: it states the plan where the server supplies one, and says **"this server does not report why"** where it does not. Shipping a confident wrong explanation is the failure RFC-0006 §3.2 names explicitly. |
| 9 | Play and control media | **In** | Foreground playback only. Background playback (P-16) and picture-in-picture (P-15) are **deferred** — both are OS-integration work (T-09) that proves nothing about the contract split. |
| 10 | Log out | **In** | `/Sessions/Logout` (I-02). Logout must clear platform-protected storage; server-initiated revocation observed mid-use is deferred pending G-08. |

**`REC`** The phone/tablet first vertical is **steps 1–10 as amended above**: full flow, with content
packs read-only, the playback explanation honest about absence, and background playback and PiP out.

**`REC`** Explicitly **out** of the first vertical: search, home/recommendation surfaces, downloads
and offline media, casting, Chromecast, session handoff, notifications, settings beyond logout,
tablet-specific layout beyond honouring the compact/medium/expanded breakpoints (P-14), and every
commercial surface.

### 5.3 Android TV first vertical

Assessed separately in §7. It is **not** the phone vertical with a larger font — that framing is the
one `#222` explicitly forbids, and §7.4 shows why it would fail at step two.

### 5.4 Phone/tablet flow inventory

Twelve flow families, phone and tablet. **Actor** is `user` unless stated. **Server dep.** means the
household server; **Account dep.** means a Tesserafin commercial account; **Entitlement dep.** means a
valid device lease. The distinction between the last two is RFC-0008 §5.2's two trust planes (T-16),
and it is why so many cells below read *none*.

| # | Flow | Entry condition | Steps | Success state | Recoverable failures | Destructive / irreversible | Server dep. | Account dep. | Entitlement dep. | First vertical? | Test method |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F-01 | **First launch** | App installed, no stored server | Launch → shell renders → discovery starts | Server-selection screen shown | Rendering only | None | none | none | none (in the first vertical; state 1 of §8.2 in the shipped product) | **In** | Instrumented UI on emulator + device |
| F-02 | **Server connection — discovery** | F-01 complete | UDP broadcast on :7359 → collect `ServerDiscoveryInfo` → list results | ≥1 server listed, user picks one | Zero results (fall through to F-03); duplicate/unreachable entries | None | **yes** (I-04) | none | none | **In** | Real-server integration on a real LAN (**G-09**) |
| F-03 | **Server connection — manual entry** | F-02 returned nothing, or user chooses it | User types a URL → client probes it → stores it under a name | Server stored and reachable | Typo, wrong scheme/port, unreachable host, TLS failure, **incompatible version** | None | **yes** | none | none | **In** | Unit (URL handling) + real-server integration |
| F-04 | **Sign in to the household server** | A server is selected | Credential entry → `/Users/AuthenticateByName` → session stored in platform-protected storage | Authenticated session; `/Users/Me` resolves | Wrong credentials; server unreachable mid-flow; session rejected | None | **yes** (I-02) | none | none | **In** | Contract fixture + real-server integration |
| F-05 | **Sign in via Quick Connect** | A server is selected; another client is already signed in | `/QuickConnect/Initiate` → display 6-char code → poll `/QuickConnect/Connect` → `/Users/AuthenticateWithQuickConnect` | Authenticated session, no password typed | Code expires; no one authorises; Quick Connect disabled server-side (`/QuickConnect/Enabled` = false) | None | **yes** (I-03) | none | none | **Deferred on phone** — it exists to avoid text entry, which a phone does not need | Contract fixture |
| F-06 | **Home and navigation** | Authenticated | Resolve `ContentPackBrowsingPreference` from `/Users/Me` → render the navigation it implies | Navigation reflects the **server-side** preference, not a client default | Preference absent → documented default | None | **yes** (I-05) | none | none | **In, read-only** | Behavioural conformance: *observed, not re-derived* |
| F-07 | **Browse a library** | Authenticated | List libraries → open one → page through items | Items rendered, paging works | Empty library; permission denial rendered as the **server's** answer; page fetch failure | None | **yes** | none | none | **In** | Contract fixture + real-server integration |
| F-08 | **Search** | Authenticated | — | — | — | None | yes | none | none | **Deferred** | — |
| F-09 | **Item details** | An item is selected | Fetch details → render → fetch `/Items/{itemId}/ContentPacks` | Details rendered with pack membership | Item removed server-side; partial metadata | None | **yes** (I-05) | none | none | **In** | Contract fixture |
| F-10 | **Request playback and read the plan** | On item details | `/Items/{itemId}/PlaybackInfo` → read the plan and its reason | A plan, **or** an explicit "this server does not report why" | No plan returned; diagnostics fields `null` (the default case, I-06) | None | **yes** (I-06) | none | none | **In, honestly reduced** | Contract fixture + real-server integration (**G-10**) |
| F-11 | **Play and control media** | A plan exists | Open the stream → play/pause/seek → stop | Media plays; transport controls respond | Stream failure mid-playback; network loss; decode failure | None | **yes** | none | none | **In, foreground only** | Real-device |
| F-12 | **Settings** | Authenticated | — | — | — | Changing a server-side preference is visible to that user on **every** client (I-05) | yes | none | none | **Deferred**, except F-13 | — |
| F-13 | **Log out** | Authenticated | Confirm → `/Sessions/Logout` → clear platform-protected storage | No session; back to F-01/F-02 | Server unreachable → clear locally anyway and say so | **Destructive**: the stored session is gone and must be re-established. Requires confirmation | **yes** (I-02) | none | none | **In** | Instrumented UI + contract fixture |
| F-14 | **Session revoked elsewhere, mid-use** | Authenticated, request in flight | Server rejects → client detects → returns to sign-in without losing local state | User is told the session ended and why | This *is* the recovery | None — no local data is destroyed | **yes** (**G-08**) | none | none | **Deferred** pending G-08 | Real-server integration |
| F-15 | **Purchase and restore** | — | See §8.2 states 1–8 | — | — | None | **none** | **yes** | — | **Deferred** — commercial-service prerequisite | — |
| F-16 | **Device / household management** | — | Two separate lists (§8.3): household-server sessions, and Tesserafin activated devices | — | — | Deactivating a device is reversible by reactivating; **removing a family seat deactivates that seat's devices** (T-19) | partly | **yes** | yes | **Deferred** | — |
| F-17 | **Offline and failure states** | Any | Server unreachable → named, distinguishable error → retry | The user knows *which* failure this is | Unreachable ≠ session expired ≠ incompatible server — three causes, three actions (T-06) | None | yes | none | none | **In** | Unit (error vocabulary) + instrumented UI |
| F-18 | **Incompatible server** | A server is selected | Compare server version against the pinned minimum → **fail closed** | The client names what it needs and what it found | Not recoverable in-app; the user updates the server | None | **yes** (I-07, T-06) | none | none | **In** | Unit + contract fixture |

**`FACT`** Only F-13 is destructive, and only locally. **No flow in the first vertical writes to the
household server**, which makes the whole vertical safe to run repeatedly against a real household —
a property worth keeping deliberately rather than by accident.

### 5.5 Reference-product principles: adopted, and where they stop

Each row states the observed pattern, why it helps Tesserafin, where it does **not** transfer, the RFC
constraint that bounds it, and the form factor it applies to. A pattern is not adopted because it is
common; three of the six rows below are adopted *with the limit as the point*.

| Pattern (source) | Why it helps Tesserafin | Where it does **not** transfer | Bounding RFC constraint | Applies to |
| --- | --- | --- | --- | --- |
| **Constrained device displays a code; capable device types it** (X-03 Quick Connect; X-04 YouTube) | Removes remote text entry from the single worst screen on a television | X-04's version is a *cloud-account* handoff; Tesserafin's media plane has no cloud account, and X-03's version presupposes an existing signed-in session (I-03) | T-10 (media access never touches Tesserafin infrastructure); RFC-0006 §3.2 (session lifecycle is layer 2's) | **TV** |
| **Manual server-URL entry as a first-class path** (X-07 Immich) | A self-hosted product must work when discovery fails, which it will (G-09) | Immich ships *only* this; Tesserafin has discovery on by default (I-04), so manual entry is the fallback, not the front door | RFC-0006 §3.2 (server identity is layer 2's) | **Both** |
| **Same-network first contact, then an explicit device choice** (X-05 Spotify Connect) | Sets an honest onboarding constraint, and never auto-connects to something the user did not pick | Spotify's model is cloud-account-based and audio-first; session handoff itself is a separate semantic Tesserafin has not scoped | RFC-0006 §3.2 (session handoff is layer 2's, and is not in the first vertical) | **Both** |
| **One session per device, individually revocable, listed and named by the user** (X-06 Home Assistant) | Exactly the shape a household server needs, and it is already half-present (`/Sessions/Logout`, I-02) | X-06's list is a **household-server** concern. It must never be merged with RFC-0008 §9's Tesserafin activated-device list — different plane, different authority (§8.3) | T-16 (two trust planes, never joined); T-19 | **Both** |
| **Ship phone and TV as separate packages** (X-02 Jellyfin) | — *not adopted* — | Jellyfin's phone client is a WebView wrapper (X-01) and its TV client is not, so it has a structural reason Tesserafin does not | T-04 (both native), T-11 (no WebView wrappers), T-15 (one entitlement across SKUs) | **Both** |
| **A WebView wrapper around the web client** (X-01 Jellyfin Android) | — ***must-not-copy*** — | Rejected outright, and not on cost grounds: a wrapper makes the Web DOM the cross-platform contract by accident | T-11 / RFC-0006 §8.1 | **Both** |

**`FACT`** Ten further reference products were named and **not** evidenced this iteration (X-08 –
X-17, **G-12**). No principle above rests on any of them; the TV-pairing conclusion in §7.4 rests on
Tesserafin's own contract (I-03), not on any competitor's behaviour.

---

## 6. Android phone/tablet shell

### 6.1 Navigation and back

**`FACT`** For apps targeting Android 16 (API 36) — which P-01 makes mandatory for new submissions
from 31 August 2026 — "the predictive back system animations … are enabled by default. Additionally,
`onBackPressed` is not called and `KeyEvent.KEYCODE_BACK` is not dispatched anymore" (P-13). The
opt-in attribute `android:enableOnBackInvokedCallback` remains available as a **temporary opt-out**
when set to `false`.

**`FACT`** The supported implementations are `OnBackPressedCallback` (AndroidX Activity), the
platform `OnBackInvokedCallback`, and in Compose `PredictiveBackHandler` / `BackHandler` (P-12).

**`REC`** The shell adopts predictive back from the first commit and **never** sets
`enableOnBackInvokedCallback="false"`. Carrying an opt-out into a new codebase means writing back
handling twice: once now against a deprecated dispatch path, once again when the opt-out is removed.

**`REC`** Back is a **navigation** concern, and RFC-0007 §4.6's ruling that presentation governs how
navigation looks but never what it contains (T-09) applies unchanged: a theme may restyle the back
affordance and may not change where back goes.

### 6.2 Edge-to-edge

**`FACT`** "For apps targeting Android 16 (API level 36), `R.attr#windowOptOutEdgeToEdgeEnforcement`
is deprecated and disabled, and your app can't opt-out of going edge-to-edge" (P-13).

**`REC`** The shell is edge-to-edge from the first screen and treats window insets as a first-class
layout input. This is not a polish item: a shell built without insets and retrofitted later has to
revisit every screen.

### 6.3 Phone / tablet responsive boundary

**`FACT`** Width breakpoints are compact `< 600dp`, medium `600–839dp`, expanded `840–1199dp`, large
`1200–1599dp`, extra-large `≥ 1600dp`; height breakpoints are compact `< 480dp`, medium `480–899dp`,
expanded `≥ 900dp` (P-14).

**`FACT`** RFC-0007's theme profile set already contains `compact`, `medium` and `expanded` (T-08,
I-08), so the platform's three primary width classes map onto the design contract that exists — no
new vocabulary is required.

**`REC`** The shell resolves layout from the **window size class**, never from a device-type check,
and maps `compact` / `medium` / `expanded` directly onto the RFC-0007 profiles of the same name.
`large` and `extra-large` fold into `expanded` until a surface actually needs them.

**`REC`** The layout changes at the compact→medium boundary (600dp) because that is where a list and
a detail pane can coexist, and again at medium→expanded (840dp). Where exactly each screen changes is
a per-screen decision for the milestone that builds it; M0 fixes only that the *input* is the size
class.

### 6.4 Accessibility

**`FACT`** Core app quality states a **48 dp** minimum touch target, **3:1** contrast for large text
and graphics, **4.5:1** for small text (under 18 pt, or under 14 pt bold), and `contentDescription`
on every UI element except `TextView` (P-21).

**`FACT`** RFC-0006 §5.3 makes accessibility an **invariant, not a token value**: a theme may not
weaken focus visibility, contrast, reduced motion or screen-reader behaviour, and where platform and
theme disagree **the stricter wins** (T-08). The Web side already measures palettes against WCAG 2.2
SC 1.4.3 (4.5:1) and SC 1.4.11 (3:1) with a shrink-only ratchet.

**`REC`** The Android shell inherits the *same numbers* and gates them the same way. Where Android's
3:1 for large text and WCAG's 4.5:1 for body text differ in framing, the stricter applies per RFC-0006
§5.3 — there is no negotiation here, only arithmetic.

**`REC`** TalkBack is the platform accessibility API and stays platform-owned (T-09). The **invariant**
is shared; the API is not.

**`FACT`** No text-scaling requirement was found in either accessibility source read (**G-07**). The
shell should honour system font scaling regardless; that is a `REC`, not a cited rule.

### 6.5 System integration

**`FACT`** Media session, background playback, PiP, notifications, downloads and casting are all in
RFC-0006 §6's permanently platform-owned list (T-09).

**`FACT`** Background playback requires a `MediaSessionService`, the `FOREGROUND_SERVICE` and
`FOREGROUND_SERVICE_MEDIA_PLAYBACK` permissions, and `android:foregroundServiceType="mediaPlayback"`;
the media notification cannot be removed while the foreground service runs, and the service leaves
the foreground automatically after 10 minutes of inactivity (P-16).

**`FACT`** PiP requires API 26, `android:supportsPictureInPicture`, and — for the smooth auto-enter
transition — API 31 (P-15).

**`REC`** All of §6.5 is **deferred out of the first vertical** (§5.2 step 9). It is real work and it
is not contract work.

---

## 7. Android TV shell

**`FACT`** This section is deliberately separate. `#222` states the rule and §7.4 demonstrates it:
an Android TV requirement is not an Android requirement with a bigger font.

### 7.1 D-pad navigation and focus

**`FACT`** TV-DP: "The app functionality is navigable using five-way D-pad controls" (P-09). The
navigation guide states the requirement operationally: "Ensure that a user with a D-pad controller
can navigate to all visible controls on the screen" (P-10).

**`FACT`** TV-DM: the app "does not depend on a remote control device having a Menu button to access
user interface controls" (P-09). TV-DB: "Back button presses lead back to the Android TV home
screen" (P-09).

**`FACT`** The framework handles directional navigation automatically, and
`android:nextFocusUp/Down/Left/Right` exist to override it, "only… if the default order that the
system applies does not work well" (P-10).

**`REC`** Focus is **deterministic**, not merely reachable. The platform rule is reachability; this is
a Tesserafin requirement on top of it, and it is stated as a `REC` precisely because no cited source
requires it: from any focused element, each of the four directions has exactly one defined outcome —
a specific next element, or a defined no-op — and that outcome does not depend on scroll position or
on how focus arrived. Focus traps are defects, not polish.

**`REC`** Explicit `nextFocus*` overrides are the exception and each one is justified in review.
A screen needing many of them is a screen whose layout is wrong.

**`FACT`** Focus visibility inherits RFC-0006 §5.3's invariant and RFC-0007's `focus` colour role and
`remote` profile (T-08, I-08) — the focus indicator is measured, not decorated.

### 7.2 Ten-foot density

**`FACT`** Average viewing distance is 3 metres; text and elements must be readable at that distance;
the amount of text should be limited; the interface must be fully navigable with the D-pad and select
button alone; and TV is a **communal, shared household device** (P-11).

**`FACT`** That source publishes **no** safe-area margin in dp and **no** minimum text size
(**G-06**). This document therefore states no number.

**`REC`** The communal-device observation has a product consequence that is easy to miss: on a
television, the item-details screen and the continue-watching surface are visible to the whole
household. Anything that would expose one household user's viewing to another is a privacy decision,
not a layout decision, and belongs to the milestone that builds those surfaces.

### 7.3 Player under a remote

**`FACT`** TV-PC: during playback the D-pad centre button toggles pause and resume; left and right
fast-forward and rewind (P-09). TV-PP: play/pause key events toggle playback (P-09).

**`FACT`** **TV-NP is the criterion most likely to be violated by reusing the phone design**: "If the
app continues to play audio after the user returns to the home screen or switches to another app, the
app provides media controls in the system UI… **Video apps must not use these media controls, and
video must be paused when the user switches out of the app**" (P-09).

**`REC`** The TV client pauses video on leaving the foreground and does **not** publish system-UI
media controls for video. The phone client's media-session integration (§6.5, when it arrives) is
therefore **not** shared with TV — a concrete, cited instance of RFC-0006 §6's rule that media
sessions are platform-owned (T-09), and a concrete instance of why a shared UI layer would have been
wrong (T-11's neighbouring rejection in RFC-0006 §8.2).

**`FACT`** TV picture-in-picture requires Android 14 (API 34) or later on *compatible* devices
(P-15). It is deferred.

### 7.4 Pairing and text entry — the finding that shapes the TV vertical

**`FACT`** The committed contract carries `/QuickConnect/Initiate`, `/QuickConnect/Connect`,
`/QuickConnect/Enabled` and `/QuickConnect/Authorize`, plus
`/Users/AuthenticateWithQuickConnect`. `ServerConfiguration.QuickConnectAvailable` defaults to
`true` (I-03).

**`FACT`** **`/QuickConnect/Authorize` declares `CustomAuthentication: [DefaultAuthorization]`** —
authorising a pending code requires an already-authenticated session. `Initiate` and `Connect` do
not (I-03). Jellyfin's own documentation of the upstream flow corroborates the shape: the new device
shows a 6-character code, and "an already-authenticated client" enters it under Settings → Quick
Connect (X-03).

**`FACT`** Therefore:

- **Household with an existing signed-in client** (Web, or a phone that completed §5.2): the TV can
  be signed in with **no text entry at all**. `supported by current server`.
- **Household whose first Tesserafin client is the television**: there is no path that avoids typing
  a username and password on a remote. **`server prerequisite`.**

**`FACT`** No QR-code surface exists anywhere in the contract (I-03), and no accepted RFC requires
one.

**`REC`** Name the missing capability precisely and **defer it to a separately authorised
prerequisite** rather than inventing it: *a household-server pairing flow that can establish a first
session on a device with no text entry, without presupposing an authenticated session elsewhere.*
That is a change to the server's authentication surface, it has real security consequences (it is,
by construction, a way to obtain a session without proving knowledge of a credential on the device
being paired), and it is not M0's to design.

**`REC`** Until then, the TV client's sign-in screen offers **two** paths and is honest about both:
Quick Connect ("you'll need to be signed in on another device") and on-screen credential entry. The
second is the ugly one and it must exist, because a household that owns only a television is not an
edge case for a self-hosted product.

**`FACT`** The wider industry convention runs the other way — YouTube's TV code is *displayed* on the
TV and *entered* on the phone (X-04) — but that flow ties to a cloud account, which the household
media plane deliberately is not (T-10). The transferable principle is only the direction of entry:
the constrained device displays, the capable device types. Tesserafin's server already implements
exactly that direction; it simply requires the capable device to be signed in first.

### 7.5 Accessibility and reduced motion on TV

**`FACT`** RFC-0007's profile set includes `remote` and `reducedMotion` (I-08), and RFC-0006 §5.3
makes both invariants a theme may not weaken (T-08).

**`REC`** The TV shell resolves the `remote` profile, honours the OS reduce-motion setting, and — as
on phone — treats the stricter of platform floor and theme value as binding.

### 7.6 Android TV flow inventory

**Kept separate from §5.4 on purpose.** Compare T-01 with F-01, and T-11 with F-11: the entry
conditions, the failure modes and the test methods all differ, and T-03 has no phone equivalent at
all.

| # | Flow | Entry condition | Steps | Success state | Recoverable failures | Destructive / irreversible | Server dep. | Account dep. | Entitlement dep. | First vertical? | Test method |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-01 | **First launch from the leanback launcher** | Installed; banner present in the TV launcher | Launcher tile selected → shell renders with a **deterministic initial focus** | A screen with one unambiguously focused element | Rendering only | None | none | none | none (see §8.2 in the shipped product) | **In** | Instrumented UI on the TV emulator; TV-LM/TV-LB/TV-BN (P-09) verified on a device |
| T-02 | **Server discovery** | T-01 complete | UDP :7359 → list results as a focusable row | ≥1 server listed and focusable | Zero results → fall through to T-04 | None | **yes** (I-04) | none | none | **In** | Real-server integration on a real LAN (**G-09**) |
| T-03 | **Avoid remote text entry** | A server is selected | Offer Quick Connect **first**, with an honest label: "you'll need to be signed in on another device" | The user reaches T-05 without typing | The household has no other signed-in client → T-04 | None | yes (I-03) | none | none | **In** | Instrumented UI; the label is the deliverable |
| T-04 | **On-screen credential entry** | Quick Connect unavailable or declined | On-screen keyboard → `/Users/AuthenticateByName` | Authenticated session | Typos; the flow is slow and must remain forgiving (no truncation, no timeout that discards input) | None | **yes** (I-02) | none | none | **In** — because a household whose only client is the television must not dead-end (§7.4) | Instrumented UI + real-device |
| T-05 | **Pair via Quick Connect** | Another client is signed in | `/QuickConnect/Initiate` → display 6-char code → poll `/QuickConnect/Connect` → `/Users/AuthenticateWithQuickConnect` | Authenticated session, nothing typed on the remote | Code expires; nobody authorises; `/QuickConnect/Enabled` returns false | None | **yes** (I-03) | none | none | **In** | Contract fixture + two-device manual test |
| T-06 | **First-sign-in pairing with no existing session** | Household's first client is the TV | — | — | — | — | **server prerequisite** — no such capability exists (I-03) | none | none | **Deferred** to a separately authorised server prerequisite (§7.4) | — |
| T-07 | **Browse by D-pad** | Authenticated | Rows/grid traversed with up/down/left/right; select opens | Every visible control reachable; each direction from each element has one defined outcome | Focus lands on a disabled element; a row scrolls focus off-screen | None | **yes** | none | none | **In** | Instrumented UI (focus determinism); P-09 TV-DP, P-10 |
| T-08 | **Item details** | An item is focused and selected | Render details at ten-foot density; pack membership shown | Details rendered; focus lands somewhere predictable | Partial metadata | None | **yes** (I-05) | none | none | **In** | Instrumented UI + contract fixture |
| T-09 | **Start playback** | On item details | `/Items/{itemId}/PlaybackInfo` → open the stream | Playback starts | No plan; diagnostics `null` (I-06); decode failure | None | **yes** (I-06) | none | none | **In, with the same honest reduction as F-10** | Real-device (**G-10**) |
| T-10 | **Player controls under a remote** | Playing | D-pad centre toggles pause/resume; left/right rewind/fast-forward; play/pause keys honoured | Controls respond as P-09 TV-PC and TV-PP require | Seek beyond bounds; buffering | None | yes | none | none | **In** | Real-device against P-09 TV-PC/TV-PP |
| T-11 | **Leaving the app during playback** | Playing video | The user presses Home or switches app → **video pauses**; **no** system-UI media controls are published for video | Playback paused, nothing left running | — | None | yes | none | none | **In** — this is the criterion most likely to be got wrong by reusing the phone design | Real-device against **P-09 TV-NP** |
| T-12 | **Back behaviour** | Anywhere | Back unwinds one level; from the root, back leaves to the Android TV home screen | Predictable; never a loop, never a trap | — | None | none | none | none | **In** | Instrumented UI against **P-09 TV-DB** |
| T-13 | **Focus preservation across navigation** | Returning from details to a list | Focus returns to the element the user left from | The user's place is kept | Underlying list changed → focus falls back to a defined element, never to nothing | None | none | none | none | **In** | Instrumented UI |
| T-14 | **No Menu-button dependency** | Anywhere | Every control is reachable without a Menu key | — | — | None | none | none | none | **In** | Instrumented UI against **P-09 TV-DM** |
| T-15 | **Search** | Authenticated | — | — | — | None | yes | none | none | **Deferred** — remote text entry makes it a design problem of its own | — |
| T-16 | **Settings, purchase, restore, device management** | — | — | — | — | — | — | yes | yes | **Deferred** — commercial-service prerequisite | — |
| T-17 | **Offline and failure states** | Any | Named, distinguishable failure with one action | The user knows which failure this is, at ten feet | Unreachable ≠ session expired ≠ incompatible server (T-06) | None | yes | none | none | **In** | Instrumented UI |
| T-18 | **Picture-in-picture** | Playing | — | — | — | — | — | — | — | **Deferred** — requires API 34+ on *compatible* devices only (P-15) | — |

**`FACT`** T-06 is the only row in either inventory whose status is `server prerequisite`. It is named
rather than designed, per §7.4.

---

## 8. Commercial and entitlement UX

### 8.1 The distinction that must never be weakened

**`FACT`** RFC-0008 §3.2(1)–(2) (T-12): an entitlement "never unlocks or denies a server API, a
server feature, a server plugin, or any Tesserafin Web feature", and "never gates access to media" —
"a client's ability to reach, authenticate against, browse and play from the household server does
not depend on the availability, reachability or verdict of any Tesserafin-hosted service."

**`FACT`** RFC-0008 §3.4 (T-14): on a store with a first-party IAP mechanism, that store's purchase
is the entitlement authority; the Tesserafin lease is device activation layered above it. Android
ships as a free download with a single non-consumable in-app unlock.

**These two are not in tension, and the reason is worth stating rather than glossing:** the
entitlement governs **whether the official native application starts its main experience on this
device**. It does not govern the server, Tesserafin Web, the media, or the household. The server
never consults Tesserafin about anything (T-10). A household that never buys the app keeps a fully
functional Tesserafin: the server is free, Tesserafin Web is free, and neither needs an account
(T-10, T-12). What the purchase buys is the official native client — and per RFC-0008 §3.2(4), it
buys all of it or none of it, with no tiering and no degraded mode.

**`FACT`** So RFC-0008 §3.3's unentitled application (T-13) is not a crippled media client. It is an
application that has not started its main experience, and that still shows the activation surface,
the recovery surface, account management including deletion, and an honest explanation of state and
fix. It does not crash, silently degrade, delete data, or dead-end.

### 8.2 State model

Every row states what the user sees, what remains possible, the primary recovery action, who owns the
state, and what must never cross the device/server boundary. **"Media/server actions"** means
reaching, authenticating against, browsing and playing from the household server.

| # | State | Media/server actions | What the user sees | Primary recovery | Owner | Never leaves the boundary | Anchor |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Downloaded, not unlocked** | Unaffected in principle; the app has not started its main experience, so this device offers none of them | Activation surface: what this is, that the server and Web are free and unaffected, and the one purchase that unlocks the app | Purchase, or sign in and restore | store + local | — | T-12, T-13 |
| 2 | **Purchase available** | as above | The single non-consumable unlock, priced by the store; **no** call to action toward any non-Play payment method | Buy | store | Nothing about the household reaches the store beyond what Play itself carries | T-14, P-03 |
| 3 | **Purchase pending** | as above | "Your purchase is being confirmed" — an explicit waiting state, never a granted one | Wait; retry query | store | — | **P-04**: grant only on `PURCHASED`; never on `PENDING` |
| 4 | **Purchase completed** | as above until activation | Confirmation, then activation | Continue to activation | store | — | T-14, P-04 |
| 5 | **Store receipt recognised** | as above | "Purchase confirmed" | — | Tesserafin account | The `purchaseToken` is sent to the Tesserafin backend and to no one else; RFC-0008 §6.7 requires minimisation | T-15, P-05 |
| 6 | **Cross-platform entitlement recognised** | as above | "You already own Tesserafin" — a **sign-in and restore** action, not a purchase flow | Sign in, activate | Tesserafin account | — | T-15, RFC-0008 §4.3 anti-steering |
| 7 | **Restore successful** | as above | "Restored" — idempotent; restoring an already-restored purchase reports success and never double-grants | Activate this device | Tesserafin account | — | RFC-0008 §6.3 |
| 8 | **Restore finds nothing** | as above | "No purchase found for this account" — with the purchase path and the *other-account* path both offered, and **nothing disclosed** about any other account | Buy, or recover the other account | store + Tesserafin account | No email, no partial identifier, nothing enumerable about another account | RFC-0008 §6.4 |
| 9 | **Device activation successful** | **All available** | Nothing — the app simply works | — | Tesserafin account | The device is a key thumbprint; no hardware identifier is ever collected | T-17, T-19 |
| 10 | **Device limit reached** | as state 1 on *this* device; other devices unaffected | The list of activated devices — label, platform, activation and last-seen date — with deactivate-one or cancel. **Never a dead end** | Deactivate a device, or cancel | Tesserafin account | Device labels are the only free text stored (RFC-0008 §10.1) | T-19, RFC-0008 §9.3 |
| 11 | **Device deactivated** | as state 1 on this device | An explanation that this device was deactivated and how to reactivate | Reactivate | Tesserafin account | — | RFC-0008 §9.2 |
| 12 | **Lease valid** | **All available** | Nothing. Ordinary launch verifies the lease locally, offline, with **no network call to anything** | — | local | The lease carries no email, no server address, no library data | T-17, RFC-0008 §7.5 |
| 13 | **Silent-renewal window (from day 15)** | **All available** | Nothing. "The user should never see it" | — | local + Tesserafin account | — | T-18, RFC-0008 §7.5 |
| 14 | **Grace period (14 days after expiry)** | **All available** | An explicit, non-dismissable-but-non-blocking notice from **day one** of grace: what is happening, how long remains, exactly what fixes it | Reconnect | local | — | T-18, RFC-0008 §8.3 |
| 15 | **Entitlement expired (grace exhausted)** | Unaffected in principle; not offered on this device | The §3.3 unentitled surface: activation, recovery, account management, honest explanation. **Local data intact, server untouched** | Reconnect and reactivate | local | — | T-13, RFC-0008 §11 row 3 |
| 16 | **Network unavailable** | **All available if the server is on the LAN** — this is the ordinary local-first case | Nothing licensing-related. Activation, if attempted, says connectivity is needed **for this step only** | Retry when online | local | — | RFC-0008 §11 rows 1–2 |
| 17 | **Entitlement service unavailable** | **All available** | Nothing, while the lease is valid. Renewal retries with backoff and the lease's remaining life absorbs the outage. **An outage never revokes** | None needed | Tesserafin account | — | RFC-0008 §11 row 4 |
| 18 | **Vendor-sunset entitlement** | **All available** | Nothing, after the sunset path runs: a final update removing the renewal obligation, plus a pre-signed perpetual entitlement bound to already-activated devices | None | Tesserafin account → local, permanently | The private signing key is **never** published — not at sunset, not from escrow | T-21 |

**`FACT`** Two additional store-owned states appear in RFC-0008 §6.5 and are not separate UX states
because the user-visible result is state 15 by another route: a **refunded or charged-back** purchase
revokes the grant, existing leases expire rather than dying instantly (maximum 44 days), and
`REFUND_REVERSED` restores the grant. Refund and revocation arrive by push and must be re-queried
against the store's authoritative API (P-06).

**`FACT`** **Store outage** is stated at RFC-0008 §6.6 and folded into row 17's shape: purchase and
restoration fail transiently with "try again later", never "you do not own this."

**`FACT`** Rows 1, 2 and 4 have no RFC-0008 §11 anchor because §11 is a failure matrix and these are
success states; they are anchored to §3.3, §4.3 and P-04 instead. Row 3 (`purchase pending`) has **no
RFC anchor at all** — RFC-0008 does not mention the PENDING state — and is therefore anchored purely
to P-04. It is flagged here rather than presented as settled: whether a pending purchase shows a
waiting screen or returns the user to the activation surface is a **client-owned** UX decision that
no accepted decision constrains.

### 8.3 Two device lists, and why they must never merge

**`REC`** A household server has its own sessions (I-02, and X-06's per-device-refresh-token model is
the same shape), and a Tesserafin account has its own activated-device list (T-19). These are on the
two trust planes RFC-0008 §5.2 says are never joined (T-16). A settings screen that shows one list
labelled "your devices" would be a serious product error: deactivating a Tesserafin device does not
sign anything out of a household server, and signing out of a household server does not free an
activation seat (RFC-0008 §5.5 states this explicitly).

**`REC`** They live under different headings, in different sections, with different verbs.

---

## 9. Technical repository and module boundaries

### 9.1 What lives where

**`FACT`** RFC-0006 §2.1 already decides that official native clients live in `tesserafin-mobile`,
and that the repository is not created by that RFC (T-02).

**`REC`** Responsibilities, not package names:

| Repository | Owns | Explicitly does not own |
| --- | --- | --- |
| **`tesserafin-mobile`** (not yet created) | The Android and Android TV applications; the shared protocol/session/domain layer; the native generated transport; the native pair lock and provenance; the conformance suite's native runner | Any UI shared across platforms; any server behaviour; the design-token source |
| **`tesserafin`** (server) | The canonical OpenAPI contract and its `(version, sha256)` identity; the drift and compatibility gates; the playback-decision domain; content-pack semantics; permissions; the fixture export endpoint (I-01, I-05, I-06) | Anything client-side |
| **`tesserafin-web`** | The Web renderer; the RFC corpus (including this document, temporarily — §13.2); the design system and its schema; the Web SDK pin (I-07, I-08) | Any native code; any native build gate |
| **Future account/entitlement service** (does not exist) | Tesserafin accounts, passkeys and recovery; store-receipt normalisation; grants; lease issuance and signing keys; activation and device lists; revocation; sunset artefacts (T-16 – T-21) | Anything on the media plane. It never sees a server address, a library, or a byte of media (T-10, T-20) |

### 9.2 The KMP boundary, by responsibility

**`FACT`** RFC-0006 §2.3 permits KMP for protocol, session and domain logic, "only where it genuinely
reduces duplication", and rules that it "is not a route around" the rejection of shared UI (T-04,
RFC-0006 §8.2).

**`REC`** The boundary is drawn by answering RFC-0006 §3.2's test — *what must two official clients
agree about?* — and nothing else:

**Inside the shared layer:** the generated wire client; server identity and the stored set of known
servers; the discovery datagram exchange (I-04); session lifecycle and its states; the permission
answer as the server's, never the client's; library and item identity as opaque; content-pack
vocabulary and the observed browsing preference (I-05); the playback plan and its explanation
*including the absent-because-legacy distinction* (I-06); progress and queue meaning; the typed error
vocabulary; pagination; cancellation; compatibility negotiation and the fail-closed verdict (T-06).

**Outside it, permanently:** every screen, every navigation model, focus and D-pad behaviour, the
media session, secure credential *storage* (layer 2 says when a credential is valid, never where it
is kept), lifecycle and background execution, downloads, casting, notifications, and the billing/store
API (T-09).

**`REC`** The discriminator to apply in review, from RFC-0006 §6: *if two platforms could reasonably
implement it differently without either being wrong, it is platform-owned.*

**`REC`** A candidate for the shared layer must name the cross-client disagreement it prevents
(RFC-0006 §3.2's own discipline). "Both clients need it" is not that argument; "the two clients would
otherwise disagree about X, and a household using both would see two products" is.

### 9.3 Generated transport and provenance

**`FACT`** The mechanism exists and works today on the Web side: a pinned spec, a committed generated
tree, a freshness check, a `(version, sha256)` contract identity, and a full-40-character pair lock
(I-01, I-07).

**`FACT`** The Web SDK is currently pinned to `sourceCommit 1d0e91b7…` / `specSha256 d234d2a8…`,
while the server's `contract.lock.json` reads `c18438ee…` at `master` `1cca371c` (I-07). Both are
internally consistent; they are pinned to different moments. **That slack is normal and expected**,
and a native provenance design must represent it rather than assume the two are always equal.

**`REC`** The native client adopts the same seven controls (T-06) rather than inventing parallel
ones, and its pair lock records a full server commit SHA — never a branch, never a tag — for the same
reason the Web one does.

### 9.4 Release-build entitlement safeguards

**`FACT`** `#221` requires that any non-production entitlement mechanism "cannot enter a release
build" and that "its absence from a release build is *proven*, not assumed."

**`REC`** The structural shape, recorded now so M1's build layout is designed for it rather than
retrofitted: the non-production entitlement path lives in a **source set that release builds do not
compile**, not behind a runtime flag. A runtime flag is a string in the binary; an uncompiled source
set is not there at all. The proof is then a build-output assertion — the release artefact contains
no reference to the debug entitlement type — which is mechanically checkable in CI and does not
depend on anyone remembering.

**`REC`** M1 ships the boundary; it ships **no** entitlement implementation of any kind, production or
not. There is nothing to bypass yet, which is precisely the right moment to make bypassing
structurally impossible.

---

## 10. Test and hardware matrix

### 10.1 Test layers

| Layer | What it covers | Needs |
| --- | --- | --- |
| Unit | Shared-layer logic: session state machine, error vocabulary, pagination, compatibility verdicts, lease verification arithmetic | Nothing |
| Contract conformance | Recorded request/response fixtures for the §3.2 semantics, generalising the existing `/System/PlaybackDiagnostics/Sessions/{id}/Fixture` shape (I-06, T-07) | Fixtures produced from a real server, once |
| Behavioural conformance | The assertions of RFC-0006 §4.5: browsing preference observed not re-derived; unknown enum member does not crash; cancelled request is not an error; permission denial rendered as the server's answer; incompatible server fails closed with a named reason | Fixtures |
| Instrumented UI | Focus determinism on TV, back behaviour on phone, accessibility labels, touch-target and contrast checks (P-21) | Emulator, then device |
| Real-server integration | Discovery on a real network (G-09), authentication, playback, playback-explanation field population (G-10) | A real household server |
| Real-device | Remote-control behaviour, decode paths, actual ten-foot legibility | Real hardware |

### 10.2 Hardware

**`FACT`** **No Android device has been confirmed available to this project.** This document does not
name a device the maintainer has not confirmed, and does not infer one from anything.

| Category | Status |
| --- | --- |
| Hardware **confirmed available** | **None recorded.** Q5 asks the maintainer to fill this in. |
| Hardware the maintainer **must identify** | At least one Android phone; at least one Android TV or Google TV device. Without the second, no TV criterion in P-09 can be verified on real hardware. |
| **Emulator coverage** | Adequate for: phone and tablet window size classes (P-14), back and edge-to-edge behaviour on API 36 (P-13), the Android TV emulator for leanback launch and basic D-pad traversal (P-08, P-10), accessibility scanning (P-21). Not adequate for: real remote-control ergonomics, decode/transcode behaviour, ten-foot legibility, discovery on a real network (G-09), StrongBox availability (P-07). |
| **Recommended physical purchases** | Deferred until Q5 is answered. Recommending a purchase before knowing what exists would be guessing. |
| Needed **only before public release** | A second TV device of a different vendor (remote layouts and launcher behaviour vary), and one low-end phone at the chosen `minSdk`. |

**`FACT`** The Android TV OS versions actually present on shipping devices were not established
(**G-02**), which is why Q3 asks the maintainer for a TV floor rather than this document asserting
one.

---

## 11. M1 proposal

### 11.1 The recommended ceiling, reduced

`#222` and the iteration brief suggest an M1 of: new repository, minimal KMP structure, Android phone
shell, Android TV shell, CI, provenance skeleton, release/debug boundary.

**`REC`** **Reduce it: drop the provenance skeleton from M1 and move it to M2.**

**Reason.** Provenance is a lock pinning a generated artefact to a server contract (I-01, I-07). In
M1 there is no generated artefact and no transport — so a provenance skeleton would pin nothing, and
a lock file that asserts a relationship between two things that do not yet exist is decorative. M2 is
where the generated transport arrives; that is where the lock earns its existence and where its
verification script can actually fail. Everything else in the suggested ceiling stays.

### 11.2 M1 scope

**In (conceptually — no file is created by this document):**

- The `tesserafin-mobile` repository, **private**, created only on explicit maintainer approval (Q10).
- A minimal Kotlin Multiplatform project structure with the module boundary of §9.2 expressed as
  empty modules — the shared layer and the two application modules — so the boundary is enforced by
  the build graph from the first commit rather than by convention.
- An **Android phone/tablet application shell**: launches, targets API 36 (P-01), predictive back
  adopted with no opt-out (P-12, P-13), edge-to-edge (P-13), one screen that resolves the window size
  class (P-14) and displays it.
- An **Android TV application shell**: a `LEANBACK_LAUNCHER` activity, `android.software.leanback`
  and `android.hardware.touchscreen` both `required="false"` (P-08), an `android:banner` drawable at
  320 × 180 xhdpi containing the name (P-08, P-09), and one screen with at least three focusable
  elements demonstrating deterministic four-direction traversal and a visible focus indicator (P-10,
  §7.1).
- **CI**: build both applications, run the (empty) test layers, and fail on the acceptance gates
  below.
- The **release/debug boundary** of §9.4: source-set separation and the build-output assertion, with
  nothing yet on the debug side.

**Out — explicitly, and each for a reason:**

| Excluded | Why |
| --- | --- |
| Any network client | M1 has no transport; adding one makes it M2 |
| Any authentication | Needs a transport and a session model |
| Any billing or entitlement code | Needs the account service, which does not exist |
| Any player | Needs playback semantics |
| Provenance skeleton | §11.1 |
| Any dependency selection beyond what an empty Android/KMP build cannot start without | RFC-0006 §9.3 defers this to implementation; M0 defines responsibilities, M1 selects only what a shell literally requires |
| Theme/token consumption | No Compose renderer exists (I-08) |
| Any store submission | No developer account decision yet (Q4) |

### 11.3 Acceptance gates

1. Both applications install and launch on an emulator.
2. The TV application appears under the leanback launcher and its banner carries the name.
3. On the TV screen, every focusable element is reachable by D-pad, each direction from each element
   has one defined outcome, and the focused element is unambiguous (P-09 TV-DP, P-10, §7.1).
4. On the phone, back is handled through the predictive-back API surface and the app does not set
   `enableOnBackInvokedCallback="false"` (P-12, P-13).
5. The phone screen reports the correct window size class across the 600dp and 840dp boundaries
   (P-14).
6. `targetSdk` is 36, satisfying both the standard and the Android TV rows of P-01.
7. The build graph makes it impossible for an application module to be depended on by the shared
   module.
8. **The release artefact contains no reference to the debug entitlement source set** — asserted
   mechanically, and passing trivially because that source set is empty (§9.4).
9. CI runs all of the above on every push.

### 11.4 Decisions that must be answered before M1 begins

- **Q10** — approval to create `tesserafin-mobile`. Nothing starts without it.
- **Q2** — the application identifier. It is written into the build on the first commit and it is
  permanent in practice (P-02).
- **Q3** — `minSdk` for phone and for TV. `targetSdk` is determined by P-01 and is not an owner
  question.
- **Q1** — one listing or two, because it decides whether M1 produces one application ID or two.

**`FACT`** Q4 (developer account), Q5 (hardware), Q6 (first-vertical boundary), Q7 (TV pairing
ambition), Q8 (AppLlama) and Q9 (documentation location) **do not block M1**.

**`FACT`** The M1 issue is **not created** by this document.

---

## 12. AppLlama decision gate

### 12.1 What was and was not done

**`FACT`** Public pages at `appllama.io` were read on 2026-08-09: the landing page (A-01), the terms
(A-02) and the copyright policy (A-03). **No sign-in was performed, no credential was requested, no
scraping occurred, no tier limit was circumvented, and no screenshot was retrieved or committed.**

**`FACT`** `appllama.com` is an unrelated "Coming Soon" placeholder (A-01). Any manual capture must
use `appllama.io`.

**`FACT`** The free catalogue was **not** inspected: no authenticated browser session was available,
and requesting one is outside this loop's boundaries (A-04, G-11).

### 12.2 Terms position — the hard stop does not fire

**`FACT`** The granted licence covers "research, analysis, reference and design inspiration", and
permits referencing "individual screens in presentations, teaching material and commentary, provided
the app they came from is credited" (A-02). Prohibited: export/mirror/cache/archive of the library or
a substantial part, bulk automated retrieval, republication or redistribution (A-02), and
additionally scraping, crawling, bulk downloading, ML training on the corpus, and **circumventing
tier limits** (A-03). Third-party rights are explicitly reserved to the app owners (A-02, A-03).

**`FACT`** The proposed use — a human reading screens and writing crediting, non-reproducing
observations, with screenshots kept outside the repository — sits inside the licence. Every
prohibited act was already on this loop's fixed-boundary list. **No terms-based hard stop.**

### 12.3 Pro decision test

RFC-scale rigour applies: Pro is recommended only if **all five** conditions hold.

| # | Condition | Holds? | Why |
| --- | --- | --- | --- |
| 1 | Named essential applications or flows are unavailable in Free | **Unknown** | The free catalogue was not inspected (A-04, G-11) |
| 2 | Public first-party evidence does not answer the same question | **No** | Every M0 decision above is settled by a primary platform source (P-01 – P-21), an accepted RFC (T-01 – T-22), or Tesserafin's own contract (I-01 – I-09). The one decision that turned on external evidence — TV pairing — was settled by I-03, Tesserafin's own contract |
| 3 | The missing evidence could materially change a product decision | **No, for M0** | M0 decides responsibilities, boundaries and sequencing. It does not decide a single screen |
| 4 | A bounded research period and output are defined | Definable | See §12.5 |
| 5 | The expected benefit exceeds "seeing more attractive screens" | **No, for M0** | The corpus is **iOS-only** (A-01), and `#222` already rules it "inspiration, not Android TV evidence" |

### 12.4 Verdict

> ### **`DEFER PRO UNTIL VISUAL DESIGN`**

**`FACT`** Conditions 2, 3 and 5 fail for M0. `PRO NOT NEEDED FOR M0` would be defensible on those
three alone, but it overstates the case going forward: when a milestone actually designs phone
screens — onboarding, empty states, error states, purchase and restore — a curated corpus of
onboarding and paywall flows is plausibly worth its price, and this document should not pre-decide
that against the maintainer. What it can say firmly is that **nothing in M0, and nothing in M1, is
blocked by it**, and that the corpus is structurally incapable of informing the Android TV half of
wave 1.

**`FACT`** No purchase was made and none is authorised.

### 12.5 Maintainer capture sheet

**`REC`** If the maintainer wishes to close G-11 manually, these are the observations worth
collecting — done by hand, in a normal browser session, with **no credentials shared with any agent**
and **no screenshot committed to any repository**. Twelve observations, roughly 45–60 minutes.

For each row record: whether the flow is **Free-visible** or **apparently Pro-only**; the app name and
the flow name as AppLlama labels them; a 2–4 sentence written observation; and whether a screenshot
would help private review (kept outside the repository).

| # | App to search | Flow to inspect | Exact screen/state needed | Question the evidence answers | Fields to record |
| --- | --- | --- | --- | --- | --- |
| 1 | Any subscription media app in the catalogue | Onboarding | The first screen after install, before any account exists | Does a strong onboarding open with value or with an account wall? Tesserafin must **never** require an account to reach a household server (T-10) | Free/Pro; screen count before first useful action |
| 2 | Same | Paywall | The unlock screen for a one-time or subscription purchase | How is a single all-or-nothing unlock framed without pressure? | Free/Pro; whether a dismiss path exists |
| 3 | Any app with restore | Restore purchases | The "restore" entry point and its success state | Where does restore live when the user is *not* signed in? (RFC-0008 §3.3 requires it reachable without a valid entitlement) | Free/Pro; entry-point location |
| 4 | Same | Restore finds nothing | The empty result | How is "no purchase found" said without accusing the user? | Free/Pro; wording |
| 5 | Any app with device limits | Device management | The activated-device list | How are devices labelled and dated, and how is deactivation offered? (T-19) | Free/Pro; fields shown per device |
| 6 | Same | Device limit reached | The blocking state | Is a choice offered, or a dead end? (RFC-0008 §9.3 forbids the dead end) | Free/Pro; actions offered |
| 7 | Any app with family/household plans | Household membership | The seat-management screen | How are seats distinguished from devices? (T-19 keeps them distinct) | Free/Pro; vocabulary used |
| 8 | Any app with passkeys | Passkey creation | The passkey prompt and its fallback | How is a passkey explained to someone who has never used one? | Free/Pro; fallback offered |
| 9 | Same | Account recovery | The "lost access" path | Is recovery reachable without the primary device? (RFC-0008 §5.5) | Free/Pro; steps |
| 10 | Any offline-capable app | Offline / grace messaging | The degraded-connectivity notice | How is a time-bounded grace stated so it is noticed but not blocking? (RFC-0008 §8.3) | Free/Pro; wording, dismissibility |
| 11 | Any media client | Error state | A failed load or failed playback | Does the error name a cause and an action? (T-06's fail-closed-with-a-reason) | Free/Pro; whether a cause is named |
| 12 | Any media client | Empty state | An empty library or empty search | What is offered when there is nothing to show? | Free/Pro; actions offered |

**`FACT`** Every conclusion drawn from this sheet is an **observation of one product's behaviour**,
never a platform rule, and it is recorded in the evidence register as
`observed product behaviour` or `must-not-copy pattern` — never as `normative platform rule`.

---

## 13. Explicit deferrals

### 13.1 Deferred by this document

| Deferred | To | Why |
| --- | --- | --- |
| Background playback, media session, picture-in-picture, notifications | The milestone after the first vertical | OS integration (T-09); proves nothing about the contract split |
| Search, home/recommendation surfaces, downloads, casting, session handoff | Later milestones | Out of the first vertical (§5.2) |
| Writing `ContentPackBrowsingPreference` from a native client | The settings milestone | The conformance assertion is about *observing* it (I-05) |
| Compose/TV theme renderers and token consumption | The design milestone | No native renderer exists (I-08); RFC-0006 §9.2 already lists this as enabled-later |
| A confident Direct Play / remux / transcode verdict | After G-10 is measured | RFC-0006 §3.2 forbids a confident wrong explanation |
| TV first-sign-in pairing without an existing session | A **separately authorised server prerequisite** | §7.4; it changes the server's authentication surface |
| QR-code pairing | Indefinitely | No RFC requires it; nothing in the contract offers it (I-03) |
| Physical device purchase recommendations | After Q5 | Recommending a purchase without knowing the inventory is guessing |
| Provenance skeleton | M2 | §11.1 |
| iOS/tvOS, webOS/Tizen | Waves 2 and 3 | T-03 |
| All pricing | Outside both RFCs | RFC-0008 §13, §14.9 |
| Store-listing copy, screenshots and marketing assets | The release milestone | Not an architecture question |

### 13.2 The temporary location of this record

**`FACT`** These two documents live in `tesserafin-web` because both accepted native-client RFCs live
there (T-01's repository field, and RFC-0008's). The chosen path
`docs/tesserafin/native-wave-1/` follows the existing convention of subdirectories under
`docs/tesserafin/` (`bench-hdr/`, `captures/`).

**`FACT`** This **does not decide** the future source-code repository boundary, which RFC-0006 §2.1
already settled in favour of `tesserafin-mobile` (T-02). Q9 asks whether the M0 record should move
when that repository exists.

### 13.3 Not touched

**`FACT`** `tesserafin#145` and `tesserafin#220` remain deferred and were not modified.
No Dependabot pull request was touched. RFC-0006 and RFC-0008 are unmodified. No existing checkout,
worktree or untracked file was disturbed.

---

## 14. Maintainer questions

Ten questions. Each carries a recommendation, because an unranked menu is a way of not doing the
work. None of them asks the maintainer to re-decide something an accepted RFC already fixed.

---

### Q1 — One combined Play listing, or separate phone and TV listings?

- **Decision**: whether phone, tablet and Android TV ship from one Play entry and one application ID,
  or two.
- **Evidence**: P-08 (single-app recommendation, leanback + `required="false"` mechanism), P-20 (TV
  listing assets), X-01/X-02 (Jellyfin's two-package split and why its reason does not transfer),
  T-15 (one entitlement across SKUs), **G-03** (Play Console form-factor mechanics unconfirmed).
- **Recommended**: **one listing, one application ID**.
- **Alternative**: two listings, two packages.
- **Consequences**: One listing — one review surface, one release train, one SKU, and a user who owns
  it on the phone does not meet a purchase screen on the television; the cost is that a single
  artefact carries both shells. Two listings — independent release cadence; the cost is two SKUs where
  RFC-0008 §4.6 intends one entitlement, doubling the purchase-recognition problem for no product
  benefit, and doubling store assets and review.
- **Blocks M1**: **Yes** — it decides whether M1 produces one application ID or two.

---

### Q2 — Provisional reverse-domain application identifier?

- **Decision**: the application ID, which P-02 makes permanent in practice under the free-download
  model.
- **Evidence**: P-02 (free → paid impossible under the same package name), T-16 (`tesserafin.org` is
  the official infrastructure domain), P-17 (passkeys bind to a domain Tesserafin controls), T-02
  (the *repository* is `tesserafin-mobile` — a repository name, not an application ID).
- **Recommended**: **`org.tesserafin.android`**.
- **Alternative**: `org.tesserafin.app`.
- **Consequences**: `.android` keeps `org.tesserafin.ios` and `org.tesserafin.tizen` free for later
  waves at zero cost. `.app` is shorter and platform-neutral but forecloses that namespace. Anything
  containing `mobile` would be wrong on the televisions the same package will run on. Getting this
  wrong means a new listing later and the loss of every install and review.
- **Blocks M1**: **Yes** — it is written into the build on the first commit.

---

### Q3 — Minimum supported Android and Android TV versions?

- **Decision**: `minSdk` for phone/tablet and for Android TV. `targetSdk` is **not** an owner
  question — P-01 fixes it at 36, which satisfies both the standard row and the Android TV row (34+).
- **Evidence**: P-01 (target-API rule, enforcement 31 August 2026), P-07 (the hardware-backed-key
  security-level check is documented for apps targeting API 29 or higher), P-15 (PiP needs API 26; TV
  PiP needs API 34), P-13 (targeting 36 changes back dispatch and forces edge-to-edge), **G-01**,
  **G-02** and **G-13** (no cited ecosystem-reach data, and the runtime availability floor of
  `KeyInfo.getSecurityLevel()` was not established).
- **Recommended**: **`minSdk 29` (Android 10) for both form factors**, with `targetSdk 36`.
- **Alternative**: `minSdk 26` (Android 8.0), the floor at which PiP exists at all.
- **Consequences**: 29 cuts three OS generations of behaviour-change handling for a single-maintainer
  project, and sits at the version from which P-07 frames the hardware-backed-key security-level check
  — though note the honest limit: P-07 conditions that check on the app *targeting* API 29+, which
  `targetSdk 36` already satisfies whatever `minSdk` is, and the API's runtime availability floor was
  not confirmed (**G-13**). So the recommendation rests on **maintenance cost**, not on a security
  capability that 26 provably lacks. 26 reaches older hardware — but **this document has no sourced
  figure for how much older hardware that actually is (G-01)**, and it will not invent one. If reach
  matters to the answer, close G-01 first: the distribution figures in Android Studio's *New Project*
  dialog are first-party and dated.
- **Note**: a single application ID (Q1) forces a single `minSdk`, so this is one number, not two,
  unless Q1 goes the other way.
- **Blocks M1**: **Yes**.

---

### Q4 — Play developer-account ownership model?

- **Decision**: personal account, or organisation account, and in whose name.
- **Evidence**: P-18 (Google holds the app signing key; the developer holds the upload key), P-19
  (closed-testing requirement for personal accounts created after 13 November 2023), **G-04** (the
  content of that requirement was not read), RFC-0008 §4.2 (the seven authorities, and the split
  between package-signing and entitlement authority).
- **Recommended**: **an organisation account**, if the project has or can obtain a legal entity.
- **Alternative**: a personal account in the maintainer's name.
- **Consequences**: An organisation account separates the commercial identity from an individual,
  survives a change of maintainer, and is the natural holder of a paid product's obligations
  (refunds, disputes, the RFC-0008 §11.1 escrow arrangement, which is a contractual instrument that a
  personal account makes awkward). A personal account is faster and free of entity overhead, but
  binds a paid product and its escrow obligations to one person, and — per P-19 — may carry a
  closed-testing gate before production that an organisation account may not.
- **Blocks M1**: **No.** M1 submits nothing to any store.

---

### Q5 — What phone, tablet and TV hardware is actually available for tests?

- **Decision**: the real device inventory. **This document names no device**, because none has been
  confirmed (§10.2).
- **Evidence**: §10.2, P-09 (TV criteria that only real hardware can verify), P-07 (StrongBox
  availability is device-dependent), **G-02**, **G-09**.
- **Recommended**: the maintainer lists what exists — make, model, OS version — for phone, tablet and
  TV, and states plainly where there is nothing.
- **Alternative**: proceed emulator-only and defer the answer.
- **Consequences**: Emulators cover the M1 shell entirely, and cover window size classes, back
  behaviour and basic D-pad traversal well. They do not cover remote ergonomics, ten-foot legibility,
  real decode paths, discovery on a real home network (G-09) or StrongBox. **Without at least one
  Android TV device, no TV quality criterion in P-09 can be verified as shipped**, which is a release
  gate, not a development gate.
- **Blocks M1**: **No** — M1 is emulator-verifiable in full.

---

### Q6 — Is the recommended first-vertical boundary right?

- **Decision**: whether §5.2's amended ten steps are the first vertical.
- **Evidence**: §5.2 in full; I-02, I-04, I-05, I-06; **G-09**, **G-10**; T-05 (what layer 2 owns).
- **Recommended**: **accept §5.2** — full flow, content packs read-only, the playback explanation
  honest about absence, background playback and PiP out.
- **Alternative**: cut further, to launch → connect → authenticate → browse → play, deferring content
  packs and the playback explanation entirely.
- **Consequences**: The recommended boundary is the smallest scope that exercises *both* of the
  semantics RFC-0006 §3.2 singles out as most likely to be improvised — content packs and the
  playback explanation — and RFC-0006 §9.5 names "wave 1 finds the split wrong" as a feature of going
  first. Cutting them makes the vertical faster and makes wave 1 much less informative about whether
  layer 2 was drawn correctly.
- **Blocks M1**: **No** — M1 contains no vertical.

---

### Q7 — How much TV discovery and pairing ambition for the first vertical?

- **Decision**: whether the TV client ships credential entry alongside Quick Connect, or waits for a
  server capability that does not exist.
- **Evidence**: **I-03** (`/QuickConnect/Authorize` requires an authenticated session; QuickConnect
  enabled by default), I-04 (discovery on by default), X-03, X-04, §7.4.
- **Recommended**: **ship both paths** — Quick Connect, clearly labelled as requiring another
  signed-in device, **and** on-screen credential entry — and **defer** the first-sign-in pairing
  capability to a separately authorised server prerequisite.
- **Alternative**: ship Quick Connect only, and treat a household whose first client is the TV as out
  of scope for the first vertical.
- **Consequences**: Both paths means one ugly screen that a minority of users will meet once; it also
  means a household that owns only a television can use the product. Quick-Connect-only means a
  first-run dead end for exactly the users a ten-foot-first household represents — and a dead end is
  the failure mode RFC-0008 §9.3 names, in a different context, as never acceptable. **Under no
  circumstances should a pairing protocol be invented client-side**: `/QuickConnect/Authorize`'s
  authentication requirement is a server decision, and routing around it would be a security change
  made by a client.
- **Blocks M1**: **No.**

---

### Q8 — AppLlama Pro?

- **Decision**: whether to buy Pro now.
- **Evidence**: A-01 (iOS-only corpus, 28,600+ screens / 700+ apps), A-02 and A-03 (terms permit the
  research, forbid the shortcuts), **A-04 / G-11** (free catalogue not inspected), §12.3's five-condition
  test.
- **Recommended**: **`DEFER PRO UNTIL VISUAL DESIGN`**.
- **Alternative**: `PRO NOT NEEDED FOR M0` — also defensible, since three of the five conditions fail
  outright.
- **Consequences**: Deferring costs nothing and keeps the option open for the milestone that actually
  designs screens. Declaring it unnecessary is cleaner but pre-decides a question that a later
  milestone is better placed to answer. Buying now would purchase an **iOS-only** corpus to inform a
  milestone that designs no screens and whose harder half is a ten-foot surface the corpus contains
  nothing about.
- **Blocks M1**: **No.**

---

### Q9 — Where should the M0 record live?

- **Decision**: whether these documents stay in `tesserafin-web` or move once `tesserafin-mobile`
  exists.
- **Evidence**: §13.2, T-01 (RFC-0006's repository field), T-02 (`tesserafin-mobile` is decided but
  uncreated), I-09.
- **Recommended**: **stay in `tesserafin-web` for now; move nothing**.
- **Alternative**: move both documents into `tesserafin-mobile` when it is created.
- **Consequences**: Staying keeps M0 next to the two RFCs it derives from, which is where a reviewer
  will look; the cost is that a native-client planning record sits in the Web repository. Moving
  later is a `git mv` and a link update, and can be decided when the repository exists rather than
  now.
- **Blocks M1**: **No.**

---

### Q10 — What are the approval criteria for creating `tesserafin-mobile`?

- **Decision**: what must be true before the repository is created. `#222` acceptance criterion 7
  makes maintainer approval mandatory; this question asks what that approval should test.
- **Evidence**: T-02 (RFC-0006 §2.1 names the repository and declines to create it), `#222`
  criterion 7, §11.
- **Recommended**: **create it when, and only when, Q1, Q2 and Q3 are answered** — the three that are
  written into the first commit and are expensive to change afterwards — **and the M1 scope of §11.2
  is accepted as written**. Private at creation; public later is a decision, public-then-private is
  not really available.
- **Alternative**: create it now and let the identifier and SDK levels settle in follow-up commits.
- **Consequences**: The recommended gate costs one review round and makes the first commit correct.
  The alternative makes the repository exist sooner, and puts a permanent identifier (P-02) into a
  build before it has been decided — which is the one mistake in this whole milestone that cannot be
  fixed by editing a file.
- **Blocks M1**: **Yes, by definition.**

---

## 15. M0 acceptance status

**`FACT`** M0 is **not** complete and this document does not propose closing `#222`.

Against `#222`'s seven acceptance criteria:

| # | Criterion | Status |
| --- | --- | --- |
| 1 | Every target flow has an owner and an acceptance purpose | **Partial.** Thirty-six flows are inventoried across two separate inventories (§5.4, F-01 – F-18; §7.6, T-01 – T-18), each with an entry condition, a success state, recoverable failures, dependencies and a test method. Per-flow *owners* are not assigned — this project has one maintainer, and inventing owner names would be theatre. Recommend closing this by naming the maintainer as owner of every flow and recording it once. |
| 2 | Android and Android TV requirements are separated | **Met.** §6 and §7 are separate, §5.4 and §7.6 are separate inventories, and §7.3/§7.4/T-11 show three places where merging them would produce a wrong answer. |
| 3 | Every unresolved decision is explicit — named, with who decides and when | **Met.** Ten owner questions (§14) and thirteen evidence gaps (register §F), each with a named route to closure. |
| 4 | Fixed RFC decisions are not reopened | **Met.** §2.1 lists the inputs; nothing below contradicts one. §2.3 re-verifies RFC-0008 §2 as §15 requires, and reports it unchanged. |
| 5 | AppLlama Pro justified or declared unnecessary, with a reason | **Met.** `DEFER PRO UNTIL VISUAL DESIGN`, with the five-condition test worked through (§12.3) and a manual capture sheet supplied (§12.5). |
| 6 | The proposed M1 is small enough for one reviewable pull request | **Met, and reduced** — the provenance skeleton is moved to M2 (§11.1). |
| 7 | The maintainer has approved creation of `tesserafin-mobile` | **Not met, deliberately.** Q10. |

**What a second M0 iteration should do**, in priority order:

1. Close **G-01** (Android reach) — it is the only thing standing between Q3 and a fully evidenced
   answer.
2. Close **G-03** (Play Console TV form-factor mechanics) — it converts Q1's `ASSUMPTION` into a
   `FACT`.
3. Assign flow owners (criterion 1) once the maintainer confirms the trivial answer.
4. Close **G-10** (which playback-diagnostic fields populate on a default server) — it decides how
   much of §5.2 step 8 is honestly shippable.
5. Optionally, close **G-11** via the §12.5 capture sheet.

**`FACT`** Until criterion 7 is met, no mobile repository exists, no native application code is
written, and no dependency is selected.
