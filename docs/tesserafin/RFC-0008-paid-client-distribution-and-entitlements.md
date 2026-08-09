# RFC-0008 — Paid native-client distribution, Tesserafin accounts and entitlements

- **Status**: Proposed (2026-08-09)
- **Date**: 2026-08-09
- **Author**: Tesserafin Project
- **Repository**: `tesserafin-web`
- **Issue**: [`tesserafin#100`](https://github.com/tesserafin-project/tesserafin/issues/100) (D2 —
  architecture only)
- **Depends on**: **RFC-0006 — Native-client foundation**, `Accepted (2026-08-09)`, merged to `main`
  as [`f1ea39a2`](https://github.com/tesserafin-project/tesserafin-web/commit/f1ea39a22d67e1d5eb2bccbcaca821354dfda5cb).
  RFC-0006 §7.2 deferred the account, purchase, entitlement, activation, device-binding and
  revocation architecture to `tesserafin#100`. This RFC is that architecture. It **builds on**
  RFC-0006 and **does not reopen** it: the three contract layers (§3), the eleven cross-client
  semantics of the hand-owned semantic layer (§3.2), "shared semantics, explicitly not
  pixel-identical rendering" (§5.2), the shared / per-platform boundary (§6) and the
  no-embedded-web-UI-lock-in constraint (§1.3) are inputs here, not questions.
- **Relation**: RFC-0001 §5 and RFC-0003 §9/§12 (native clients are separate codebases over a shared
  contract), RFC-0004 (platform scope), RFC-0005 and RFC-0007 (design system and theme platform —
  untouched by this document). It supersedes none of them.
- **Language note**: English, per RFC-0007's ruling for that document and its successors.
- **Number**: the published corpus is RFC-0001 – RFC-0007; `0006` was filled by D1 and `0007` is
  Theme Platform v2, so this RFC takes `0008`. No accepted history is renumbered.

---

## 1. Purpose, status and method

### 1.1 What this RFC decides

Tesserafin's server and Web client are free and require no Tesserafin account. The official native
applications are dedicated paid products. Between those two facts sits a set of questions that are
expensive to answer wrongly once money, app stores and user devices are involved:

1. **What a paid entitlement actually entitles you to**, and — more importantly — what it must never
   gate.
2. **Who is the authority for what**, per platform: who takes the money, who signs the package, who
   holds the proof of purchase, who restores it, and who decides that a given device may run the app.
3. **How an application that is offline for weeks at a time keeps working**, and how a revoked
   entitlement eventually stops working, without either fact turning into a crash, a silent
   downgrade, or a permanent lock-out.
4. **What the Tesserafin account is allowed to know**, stated as an explicit deny list rather than an
   aspiration.

This RFC decides those four. It authorises **no implementation** of any kind — see §13.

### 1.2 Decision status

**Proposed.** Acceptance is the maintainer's architectural review of the pull request that introduces
this document. §14 lists every item that is deliberately left for owner acceptance rather than
decided here; a reviewer should read §14 first and treat the rest as the reasoning behind it.

### 1.3 Method: two kinds of statement, kept apart

Store rules change. Architecture that hard-codes a store rule as an eternal invariant rots the day
the rule moves. This document therefore separates:

- **§2 — Current channel constraints.** What Google, Apple, LG and Samsung's *own current
  documentation* says, each claim carrying a primary-source URL and an access date. These are
  observations about mutable third-party policy, not Tesserafin decisions, and they are expected to
  be re-checked before any implementation issue is opened.
- **§3 onwards — Tesserafin-owned architecture.** Decisions this project makes and controls. They are
  written so that a change in §2 changes *which channel row applies*, not the shape of the system.

Where the two meet, the architecture is written as a **conditional**, never as a promise. The clearest
example: this RFC does **not** promise that a purchase made on one store can be transferred to
another store. See §4.6.

### 1.4 Sources

Every current platform-policy claim in §2 cites official first-party documentation, accessed
**2026-08-09**. Third-party summaries, blog posts and news coverage are not used. Repository sources
are RFC-0006, RFC-0007, `tesserafin#100`, `tesserafin#129`, `tesserafin#142` and
`tesserafin-web#146`. The full source list with URLs and access dates is §15.

---

## 2. Current channel constraints (mutable, observed 2026-08-09)

This section records what the platform owners' own documentation says today. It is descriptive.

### 2.1 Google Play

- **Play's billing system is mandatory for in-app digital purchases.** The Payments policy requires
  Google Play's billing system for in-app purchases of digital content and subscriptions, and states
  that beyond its listed exemptions "apps may not lead users to a payment method other than Google
  Play's billing system" through "in-app webviews, buttons, links, messaging, advertisements, or
  other calls to action." The listed exemptions (physical goods, physical services, peer-to-peer
  payments, online auctions, gambling facilitation) do not describe a paid media client.
  <sup>[G-POL]</sup>
- **A one-time entitlement is a non-consumable `ProductType.INAPP` product.** Purchases arrive through
  `PurchasesUpdatedListener` and can be enumerated at any time with `queryPurchasesAsync()` +
  `QueryPurchasesParams`; the documentation states this is how "a user may buy an item on one device
  and then expect to see the item when they switch devices" is handled. Purchases must be
  acknowledged, client-side via `BillingClient.acknowledgePurchase()` or server-side via the
  `androidpublisher` `…:acknowledge` endpoint. <sup>[G-INT]</sup>
- **Server-side verification is the documented expectation.** Send `Purchase.purchaseToken` to a
  backend, keep a record of every token seen, and reject a token that matches a previous one —
  "`purchaseToken` is globally unique, so you can safely use this value as a primary key in your
  database." Verify with `Purchases.products:get`. Do **not** use `orderId` for duplicate detection,
  "as not all purchases generate an `orderId`." If validation or abuse checks fail, explicitly refund
  via `Orders:refund` with `revoke` set to `true`. `BillingFlowParams.setObfuscatedAccountId()` binds
  a purchase to an opaque application-side account identifier, and the documentation directs you to
  "check that the purchase mapping matches the expected user account in your system."
  <sup>[G-SEC]</sup>
- **Revocation and refunds are pushed.** Real-time developer notifications deliver
  `ONE_TIME_PRODUCT_PURCHASED`, `ONE_TIME_PRODUCT_CANCELED` and voided-purchase events over Cloud
  Pub/Sub, and the documentation requires calling the Google Play Developer API after a notification
  "to get the complete status and update your own backend state." <sup>[G-RTDN]</sup>
- **Hardware-backed device keys exist.** The Android Keystore system keeps key material
  non-exportable — "key material never enters the application process" — and can bind it to the TEE
  or a Secure Element; `KeyInfo.getSecurityLevel()` reports `TRUSTED_ENVIRONMENT` or `STRONGBOX`, and
  `KeyGenParameterSpec.Builder(...).setIsStrongBoxBacked(true)` requests the Secure Element. StrongBox
  supports `ECDSA/ECDH P-256`. <sup>[G-KS]</sup>

### 2.2 Apple (App Store, iOS and tvOS)

- **Guideline 3.1.1 forbids a private unlock mechanism.** "If you want to unlock features or
  functionality within your app … you must use in-app purchase. Apps may not use their own mechanisms
  to unlock content or functionality, such as license keys, augmented reality markers, QR codes,
  cryptocurrencies and cryptocurrency wallets, etc." It also requires that "you should make sure you
  have a restore mechanism for any restorable in-app purchases." <sup>[A-GL]</sup>
  **This is the single most consequential external constraint on this RFC.** §3.3 and §4.3 are written
  around it.
- **Guideline 3.1.3(b) permits cross-platform access, conditionally.** "Apps that operate across
  multiple platforms may allow users to access content, subscriptions, or features they have acquired
  in your app on other platforms or your web site … **provided those items are also available as
  in-app purchases within the app**." <sup>[A-GL]</sup>
- **Anti-steering applies, with a current US-storefront carve-out.** Apps using other purchase methods
  "cannot, within the app, encourage users to use a purchasing method other than in-app purchase,
  except for apps on the United States storefront and as set forth in 3.1.1(a) and 3.1.3(a)." That
  carve-out is jurisdiction-specific and mutable; this RFC does not build on it. <sup>[A-GL]</sup>
- **Guideline 4.8 constrains third-party sign-in.** An app that uses a third-party or social login
  service to establish the user's *primary* account "must also offer as an equivalent option another
  login service" that limits collection to name and email, lets the user keep the email private, and
  does not collect in-app interactions for advertising without consent — **unless** "your app
  exclusively uses your company's own account setup and sign-in systems." <sup>[A-GL]</sup>
- **Guideline 5.1.1(v) requires in-app account deletion.** "If your app supports account creation, you
  must also offer account deletion within the app." <sup>[A-GL]</sup>
- **Entitlements are readable and restorable from the device.** `Transaction.currentEntitlements`
  emits "a transaction for each non-consumable In-App Purchase," and "products that the App Store has
  refunded or revoked don't appear in the current entitlements." `Transaction.updates` "emits a
  transaction when the system creates or updates transactions that occur outside the app or on other
  devices," including "transactions that customers complete in your app on another device."
  <sup>[A-CE]</sup><sup>[A-UP]</sup>
- **Server-side verification and push revocation exist.** The App Store Server API exposes
  `GET https://api.storekit.apple.com/inApps/v1/transactions/{transactionId}`, which "supports all
  in-app purchase types, including consumable, non-consumable, non-renewing subscriptions, and
  auto-renewable subscriptions." <sup>[A-TX]</sup> App Store Server Notifications V2 POST signed
  payloads to a developer-supplied HTTPS endpoint requiring TLS 1.2 or later, and the
  `notificationType` enumeration includes `ONE_TIME_CHARGE`, `REFUND`, `REFUND_DECLINED`,
  `REFUND_REVERSED`, `REVOKE` and `CONSUMPTION_REQUEST`. `ONE_TIME_CHARGE` is also the notification
  raised when a "customer receives access to a non-consumable In-App Purchase through Family
  Sharing." <sup>[A-SN]</sup><sup>[A-NT]</sup>
- **Hardware-backed device keys exist.** `SecureEnclave` is "a representation of a device's
  hardware-based key manager," with `SecureEnclave.isAvailable` and `SecureEnclave.P256`.
  <sup>[A-SE]</sup>

### 2.3 LG webOS

- **LG no longer operates a first-party in-app-purchase billing service.** The official guide states
  plainly: "The LG Billing Service for In-App Purchase is no longer provided." It recommends a named
  third-party solution (Paymentwall) and adds "We may ask you for a separate contract if any other
  3rd party billing solution is used in your app." <sup>[L-IAP]</sup>
- **Distribution is via LG Seller Lounge to LG Apps**, with LG performing pretest, function and
  content QA before an app goes live. Sellers register as individual or corporate sellers.
  <sup>[L-ECO]</sup>

**Consequence, recorded here because it drives §4.5:** there is no first-party webOS IAP mechanism a
third-party app can rely on. The webOS row therefore cannot be modelled on the Play/App Store row.

### 2.4 Samsung Tizen

- **Samsung Checkout is a first-party in-app-purchase mechanism for Samsung TV apps.** It is enabled
  by setting the "Billing" field to "Use" and "Samsung Checkout on TV" to "Yes" on the App
  Registration Page in Samsung Seller Office, and is used through the `webapis.billing` API
  (`buyItem()`, `getProductsList()`, `applyInvoice()`) together with the DPI service.
  <sup>[S-CO]</sup>
- **Restoration is a documented server query.** The Purchase List API `POST {DPI}/invoice/list`
  "requests the list of purchased items for a specific user, usually the currently logged-in user,"
  keyed by `AppID`, `CustomID`, `CountryCode`, `ItemType` and `PageNumber`. Product listing is
  `POST {DPI}/cont/list`. <sup>[S-CO]</sup>
- **Request integrity uses an HMAC-SHA256 `CheckValue`** computed over a concatenation of the request
  parameters with the DPI security key, and the same mechanism verifies that "API response data from
  the DPI server is legitimate." The documentation is explicit that "the DPI security key is used only
  by Samsung Smart TV applications for open API calls. Do not expose this key. You can use a key
  management server." <sup>[S-CO]</sup>

### 2.5 Standards

- **RFC 8252 §5**: "native apps MUST use an external user-agent to perform OAuth authorization
  requests." **§8.12**: "native apps MUST NOT use embedded user-agents to perform authorization
  requests." **§6**: "Public native app clients MUST implement the Proof Key for Code Exchange (PKCE
  [RFC7636]) extension to OAuth, and authorization servers MUST support PKCE for such clients," and
  authorization servers "SHOULD reject authorization requests from native apps that don't use PKCE."
  <sup>[R-8252]</sup>
- **RFC 7636** defines `code_challenge`, `code_verifier` and `code_challenge_method`, with the
  `S256` method. <sup>[R-7636]</sup>
- **OpenID Connect Core 1.0** defines the Authorization Code Flow and the ID Token used to convey
  authenticated identity. <sup>[OIDC]</sup>

---

## 3. Decision 1 — the product and entitlement boundary

### 3.1 What an entitlement is

> **A Tesserafin entitlement activates an official Tesserafin native application on a device. That is
> its entire job.**

It is not a licence to media, not a permission on a server, not a feature flag on the household's
library, and not a subscription to a Tesserafin-operated service.

### 3.2 What an entitlement may never do

These are hard boundaries, and each of them is a decision of this RFC:

1. **It never unlocks or denies a server API, a server feature, a server plugin, or any Tesserafin Web
   feature.** The server and Tesserafin Web are free, require no Tesserafin account, and behave
   identically whether or not any entitlement exists anywhere. This is RFC-0006 §7.1(1) restated as a
   commercial constraint.
2. **It never gates access to media.** RFC-0006 §7.2 already ruled the boundary — "media access is
   never coupled to the licensing control plane" — and §8.5 recorded the coupling as *rejected*. This
   RFC does not weaken it. A household server does not consult Tesserafin to decide whether to serve a
   file, and a client's ability to reach, authenticate against, browse and play from the household
   server does not depend on the availability, reachability or verdict of any Tesserafin-hosted
   service.
3. **Losing an entitlement never corrupts local state and never changes the private server.** No local
   database is wiped, no downloaded content is deleted as a licensing action, no server setting is
   altered, no household user is affected. An unentitled installation is an application that will not
   *start its main experience*, not an application that destroys things.
4. **Essential capability is never behind the entitlement.** "The paid product" is the *official
   native application as a whole*, not a tier inside it. There is no free-but-crippled native build
   whose missing pieces are sold back. If a capability is essential to running or watching your own
   library, it lives in the server or in Tesserafin Web, both free.

### 3.3 What the application must still do without a valid entitlement

An app that cannot currently prove entitlement is not a brick. It **must** retain:

- the activation surface (sign in, activate this device, retry);
- the recovery surface (restore purchases, contact/support information, error detail a human can act
  on);
- account management, including sign-out and account deletion (required by [A-GL] 5.1.1(v));
- an honest explanation of *why* it is in this state and *what* will fix it.

It must **not**: crash, silently degrade features without saying so, delete user data, or present a
dead end.

### 3.4 The relationship to store purchase, stated precisely

This is where [A-GL] 3.1.1 bites, and the resolution is structural rather than a caveat:

> **On a platform whose store operates a first-party in-app-purchase mechanism, that store's purchase
> is the entitlement authority for that platform. The Tesserafin lease is device activation layered
> above it — never the sole unlock, and never a licence key sold outside the store.**

Concretely, on iOS and tvOS the app is either sold paid-up-front on the App Store or offered as a
non-consumable in-app purchase inside the app; in both cases the App Store transaction is what
entitles the user, exactly as 3.1.1 requires. The Tesserafin account and lease exist to answer
"*which* of this account's devices may run it, and for how long offline" — a device-management
question, not an unlock. §4.3 states this per platform.

---

## 4. Decision 2 — distribution sequence and per-platform authorities

### 4.1 Sequence

Unchanged from `tesserafin#100` and `tesserafin#129`:

1. **Android + Android TV**
2. **iOS + tvOS**
3. **webOS + Tizen**

**Windows, macOS and Linux have no planned native client.** The official desktop and browser
experience is the self-hosted server plus Tesserafin Web, per RFC-0006 §1.3. That is a decision, not
a gap awaiting a fourth wave.

The sequence is ordered by the amount of new *architecture* each wave forces, not by market size:
wave 1 establishes the account, the lease and the device model against a store with the richest
server-side validation surface; wave 2 re-uses all of it against a store whose rules are the most
restrictive; wave 3 faces two TV platforms whose channel models differ from each other and from both
phone stores.

### 4.2 The seven authorities

For each platform family the RFC distinguishes seven roles. Conflating any two of them is how these
systems go wrong.

| Role | Question it answers |
| --- | --- |
| **Sales channel** | Who takes the customer's money? |
| **Package-signing authority** | Who vouches for the binary the device runs? |
| **Purchase evidence** | What artefact proves a purchase happened? |
| **Restoration path** | How does a user who reinstalls or switches device get it back? |
| **Tesserafin entitlement authority** | Who decides this account holds this product? |
| **Update authority** | Who ships the next version? |
| **Account linkage** | How is store purchase tied to a Tesserafin account? |

The invariant across every row:

> **A store may establish purchase evidence. Only the Tesserafin backend normalises that evidence into
> a Tesserafin product entitlement, and only Tesserafin issues device leases.**

That normalisation is what lets one architecture serve four channels with four different purchase
artefacts.

### 4.3 Android and Android TV

| Role | Decision |
| --- | --- |
| Sales channel | Google Play, using Google Play's billing system. Mandated by [G-POL]; not a Tesserafin preference. |
| Package-signing | Google Play app signing / the Play-managed signing key. |
| Purchase evidence | A non-consumable `ProductType.INAPP` purchase, evidenced by `Purchase.purchaseToken`. |
| Restoration path | `queryPurchasesAsync()` on the device, plus server-side re-validation of the token. |
| Tesserafin entitlement authority | The Tesserafin backend, after verifying the token via `Purchases.products:get` and its uniqueness ledger [G-SEC]. |
| Update authority | Google Play. |
| Account linkage | `BillingFlowParams.setObfuscatedAccountId()` carrying an **opaque, non-reversible** Tesserafin account identifier — never an email address, never a raw account primary key. |

Anti-steering: the Android app must not present buttons, links or messaging that lead to a non-Play
payment method [G-POL]. Any web purchase path that exists for other reasons is simply not surfaced
as a call to action inside this app.

### 4.4 iOS and tvOS

| Role | Decision |
| --- | --- |
| Sales channel | The App Store, using in-app purchase. Mandated by [A-GL] 3.1.1. |
| Package-signing | Apple, via the developer program signing and notarisation chain. |
| Purchase evidence | An App Store transaction — the app sold paid-up-front, or a non-consumable IAP inside it. Universal Purchase may cover iOS and tvOS as one purchase. |
| Restoration path | `Transaction.currentEntitlements` and `Transaction.updates` on device [A-CE][A-UP], plus a user-invoked restore action, which 3.1.1 requires. |
| Tesserafin entitlement authority | The Tesserafin backend, after verifying the transaction through `GET /inApps/v1/transactions/{transactionId}` [A-TX] and consuming `REFUND` / `REVOKE` / `REFUND_REVERSED` notifications [A-NT]. |
| Update authority | The App Store. |
| Account linkage | Established after purchase, inside the app, by signing in to a Tesserafin account (§5) — an account link, not a purchase gate. The app must be usable to the extent the store purchase alone allows before any Tesserafin account exists. |

**Compliance shape.** The Tesserafin lease never functions as a licence key that unlocks an otherwise
locked iOS app, because on iOS the store purchase is what unlocks it. If Tesserafin later wishes to
honour an entitlement acquired on another platform inside the iOS app, [A-GL] 3.1.3(b) permits that
**only while the same item is also available as an in-app purchase within the app** — so the iOS IAP
offering is a precondition of that path, not an alternative to it.

### 4.5 webOS and Tizen

These two rows are genuinely different from each other, and neither resembles §4.3 or §4.4.

**Samsung Tizen:**

| Role | Decision |
| --- | --- |
| Sales channel | The Samsung TV app store, using Samsung Checkout where a TV-store sale is offered. |
| Package-signing | Samsung's TV application signing and certification chain, via Seller Office. |
| Purchase evidence | A Samsung Checkout invoice, obtained through `webapis.billing` / the DPI service. |
| Restoration path | `POST {DPI}/invoice/list` for the signed-in Samsung account [S-CO]. |
| Tesserafin entitlement authority | The Tesserafin backend, after server-side verification of the invoice. The DPI `CheckValue` is HMAC-SHA256 over request parameters with the DPI security key, and Samsung's own documentation says not to expose that key and to use a key management server — which is precisely the server-side normalisation this RFC requires. |
| Update authority | The Samsung TV app store. |
| Account linkage | Tesserafin account sign-in inside the app; the Samsung account identifier is used only as the `CustomID` correlation for invoice lookup. |

**LG webOS:**

| Role | Decision |
| --- | --- |
| Sales channel | LG Apps via Seller Lounge. **There is no first-party LG in-app-purchase billing service** — LG's own guide states it "is no longer provided" [L-IAP]. Two shapes remain open: a paid LG Apps listing, or a free listing that activates an entitlement acquired elsewhere. |
| Package-signing | LG's Seller Lounge submission and QA chain [L-ECO]. |
| Purchase evidence | If a paid LG Apps listing: LG's own purchase record. Otherwise: a Tesserafin entitlement acquired on another channel. |
| Restoration path | Account-based activation against the Tesserafin backend. |
| Tesserafin entitlement authority | The Tesserafin backend in both shapes. |
| Update authority | LG Apps. |
| Account linkage | Tesserafin account sign-in inside the app. |

The RFC therefore **does not depend on a webOS IAP mechanism existing**, and does not adopt the named
third-party billing recommendation. Which webOS shape is chosen — and whether a third-party billing
contract is ever entered into — is an **owner-review item** (§14.6), to be re-checked against LG's
documentation at the time, not settled here.

### 4.6 What this RFC does not promise

> **No cross-store purchase transfer is promised.** Buying on one store does not entitle you on
> another store's channel, and this RFC does not describe a flow in which it does.

What *is* architecturally available is narrower and safer: **account-based activation**. A Tesserafin
account may hold an entitlement, and a device on a platform *without* a first-party IAP mechanism —
webOS as of §2.3 — may activate against that account. On platforms **with** a first-party IAP
mechanism, honouring an entitlement bought elsewhere is permitted only under that store's own
conditions ([A-GL] 3.1.3(b) for Apple), and is deferred to §14.5 rather than assumed.

This single decision removes the entire class of "flow prohibited by current store rules" risk from
the rest of the document.

---

## 5. Decision 3 — the Tesserafin account and sign-in

### 5.1 What the account is, and is not

**Is:** an identity, purchase, entitlement and activated-device control plane, operated on official
`tesserafin.org` infrastructure.

**Is not:** a media cloud, a server directory, a media relay or proxy, a telemetry service, or a
playback-history store. RFC-0006 §7.1(2)–(3) already forbid the media plane from touching Tesserafin
infrastructure; this RFC adds no exception and creates no opt-in.

**Not required for:** running the self-hosted server, using Tesserafin Web, or anything either of them
does.

### 5.2 Two trust planes, never joined

| Plane | Authenticates | Authority | Available offline |
| --- | --- | --- | --- |
| **Media plane** | The user against *their own household server* | The household server | Yes — entirely local |
| **Licence plane** | The user against *their Tesserafin account* | Tesserafin backend | Only for activation and renewal |

A credential from one plane is never accepted by the other. A failure in one never produces a failure
in the other. This is the operational restatement of RFC-0006 §7.2.

### 5.3 Sign-in protocol

- **OAuth 2.0 Authorization Code with PKCE**, `code_challenge_method=S256` [R-7636], layered with
  **OpenID Connect Core 1.0** [OIDC] where an ID Token is needed.
- **System browser only.** RFC 8252 §5 requires an external user-agent and §8.12 forbids embedded
  user-agents [R-8252]. In practice: `SFAuthenticationSession`-class system flows on Apple platforms,
  Custom Tabs on Android, and the platform browser on TV platforms.
- **No client password collection, ever, and never inside an embedded WebView.** The native app never
  renders a Tesserafin password field. This is both the RFC 8252 rule and a deliberate product
  constraint: an application that never sees a password cannot leak one.
- **Public client, no client secret.** A secret shipped in a distributed binary is a published secret
  — RFC-0006 §7.1(4) already makes this permanent for layers 1 and 2, and it holds here.

### 5.4 External identity providers

External IdPs **may prove identity**. They never become the authority for anything commercial:
purchases, grants, activated devices, revocation and account recovery remain Tesserafin's.

**Apple 4.8 consequence, decided here:** if the iOS/tvOS app offers any third-party or social login
service for the primary account, it must also offer an equivalent option meeting 4.8's three
conditions [A-GL]. The exemption for apps that "exclusively use your company's own account setup and
sign-in systems" is available if Tesserafin offers only its own sign-in. **Which of the two shapes to
adopt is an owner-review item (§14.4)** — it is a product decision with a compliance consequence, not
a purely technical one.

### 5.5 Sessions and recovery

- Short-lived access tokens; refresh tokens bound to the device (§7), revocable per device.
- Sign-out on one device does not sign out the others, and does **not** by itself deactivate the
  device — deactivation is an explicit action (§9).
- Account recovery is Tesserafin's, must not depend on any external IdP remaining reachable, and must
  survive the loss of every registered device.
- Recovery never grants an entitlement that no purchase evidence supports. Recovering access to an
  account is not the same operation as restoring a purchase (§6.3).

### 5.6 Account deletion

In-app account deletion is **mandatory** where account creation is offered ([A-GL] 5.1.1(v)), and is
adopted here as a Tesserafin rule on every platform regardless of store requirements.

Deletion must be **safe**, which this RFC defines precisely:

- Deletion destroys Tesserafin-held data: identity, grants, device registrations, restoration history,
  session and audit material beyond any legally required retention.
- Deletion **does not destroy the store purchase.** The purchase lives in the user's Google, Apple or
  Samsung account and remains re-derivable there — `queryPurchasesAsync()` [G-INT],
  `Transaction.currentEntitlements` [A-CE], `invoice/list` [S-CO]. A user who deletes their Tesserafin
  account and later creates a new one can restore the same purchase into it.
- The user must be told this, in plain language, **before** confirming deletion: what is destroyed,
  what survives, and what re-restoration will require.
- Any minimal record retained to prevent restoration fraud must be a **non-reversible** correlation
  (for example a keyed hash of the store purchase identifier), never a resurrectable copy of the
  deleted account.
- A device holding a currently valid lease continues to run until that lease expires and then enters
  the §11 unentitled path — deletion is not a remote kill.

---

## 6. Decision 4 — purchase validation and restoration

### 6.1 Server-side validation is the only validation that counts

The client may read store state to *offer* an action. Only the Tesserafin backend, talking to the
store's server API, may *grant*.

| Channel | Evidence | Verified by |
| --- | --- | --- |
| Google Play | `Purchase.purchaseToken` | `Purchases.products:get` [G-SEC] |
| App Store | Transaction identifier / signed transaction | `GET /inApps/v1/transactions/{transactionId}` [A-TX] |
| Samsung | Checkout invoice | DPI `invoice/list` with `CheckValue` verification [S-CO] |
| LG (if a paid listing is used) | LG purchase record | Per LG's mechanism at the time — deferred, §14.6 |

Client-reported entitlement is a hint. It is never a grant.

### 6.2 Replay and duplicate protection

- **Evidence identifiers are unique keys.** Google's documentation states `purchaseToken` "is globally
  unique, so you can safely use this value as a primary key," and warns against `orderId` "as not all
  purchases generate an `orderId`" [G-SEC]. The same principle is applied per channel: one purchase
  identifier maps to at most one grant, forever.
- A previously seen identifier presented against a *different* account is a **conflict**, never a
  second grant (§6.4).
- Validation is rate-limited per account, per device and per source address.
- A validation attempt that fails abuse checks does not silently drop: on Google Play, the documented
  action is an explicit `Orders:refund` with `revoke=true` rather than letting the purchase
  auto-refund through non-acknowledgement, which the documentation describes as ambiguous [G-SEC].

### 6.3 Restoration is idempotent

Restoration re-derives a grant from evidence the store still holds. Re-running it must converge:

- Restoring an already-restored purchase into the same account is a **no-op that reports success** —
  never a duplicate grant, never an error the user must interpret.
- Restoration is available from the app's recovery surface without an entitlement already being valid
  (§3.3), and Apple 3.1.1 requires a restore mechanism to exist at all [A-GL].
- Restoration grants the *product*; it does not by itself activate the *device*. Activation is a
  separate step (§7.4) subject to the device limit (§9).
- Restoration after Tesserafin account deletion works, because the store still holds the purchase
  (§5.6).

### 6.4 Account-link conflicts

The hard case: purchase evidence already bound to account A is presented by account B.

**Rule: never double-grant, never silently move.** The system:

1. refuses to create a second grant;
2. tells the user, without disclosing anything about account A beyond the fact that a link exists —
   no email address, no partial identifier, nothing enumerable;
3. offers exactly one path forward: prove control of account A (via §5.5 recovery), or contact
   support for a human-reviewed transfer.

A store account changing hands is a real event, so a **transfer** path must exist. It is
human-reviewed, rate-limited, audited, and revokes every device lease of the previous binding.

### 6.5 Refunded, charged-back and revoked purchases

- Refund and revocation arrive by push: Play RTDN voided-purchase and
  `ONE_TIME_PRODUCT_CANCELED` events, which must be followed by a Developer API call "to get the
  complete status and update your own backend state" [G-RTDN]; Apple's `REFUND`, `REVOKE` and
  `REFUND_REVERSED` notification types over TLS 1.2+ [A-SN][A-NT].
- A revoked purchase revokes the grant. Existing device leases are **not** remotely killed — they
  expire (§8). §8.4 quantifies the resulting delay.
- `REFUND_REVERSED` and its equivalents must restore the grant. Reversal handling is not optional; a
  wrongly-removed entitlement is a worse failure than a briefly-surviving refunded one.
- Webhook endpoints authenticate the sender cryptographically and are idempotent on redelivery
  (§12.11).

### 6.6 Store outage

A store being unreachable is a **transient condition**, never an entitlement decision:

- New purchase or restoration attempts fail with a clear "try again later," not "you do not own this."
- Existing valid leases are untouched — this is exactly what §8 exists for.
- Renewal that cannot re-confirm store state because the *store* is down, rather than the purchase
  being invalid, does not revoke; it retries, and the lease's remaining life absorbs the gap.

### 6.7 Evidence retention minimisation

**Store no more receipt data than validation and audit require.** Concretely:

- Retain the minimum needed to (a) prevent replay, (b) honour refund/revocation callbacks, (c) satisfy
  accounting and dispute obligations.
- Prefer a non-reversible keyed hash of a purchase identifier over the raw identifier wherever the raw
  value is not required by the store's own API.
- Never retain full receipt blobs indefinitely "in case they are useful."
- Never retain payment instrument data. Tesserafin does not see it — the store does.
- Retention periods are a policy artefact, reviewed separately; this RFC fixes the principle, not the
  number.

### 6.8 No payment processor is selected

This RFC selects **no** payment processor and integrates **no** billing SDK. Where a store's billing
system is mandatory (§2.1, §2.2) that is a channel constraint, not a Tesserafin vendor choice.

---

## 7. Decision 5 — the signed offline entitlement lease

### 7.1 Shape

A **lease** is a short-lived, asymmetrically signed, offline-verifiable statement that *this account*
holds *this product* and that *this device* may run it *until this moment*.

It is not a bearer token. A lease that could be copied to another device and used there would be a
licence key with extra steps, which is exactly what §3.4 rules out.

### 7.2 Claims

Only what verification needs:

| Claim | Purpose |
| --- | --- |
| Issuer | Which Tesserafin issuer minted it |
| Subject | The account, as an opaque identifier |
| Product | Which Tesserafin product |
| Grant identifier | Which entitlement grant, so revocation is addressable |
| Device public-key thumbprint | Binds the lease to one device key pair |
| Issued-at / not-before / expiry | Validity window |
| Feature/product set | Only if a product ever needs more than one bit |
| Key identifier | Which signing key, so rotation works |
| Schema version | So the format can evolve |

**Not present:** email address, real name, server address, library contents, playback state, device
fingerprint, IP address, or anything from §10's deny list.

### 7.3 Cryptographic requirements

The exact token container and cryptographic library remain implementation decisions. These properties
do not:

1. **Asymmetric verification.** The client verifies with a public key and can mint nothing. No shared
   secret, no symmetric signing — RFC-0006 §7.1(4) forbids the embedded master secret that symmetric
   verification would require.
2. **Algorithm pinning.** The verifier accepts exactly the algorithm(s) the schema version names.
   Algorithm agility is decided by the *verifier*, never by the token header. `alg: none` and
   algorithm confusion are structurally impossible, not merely rejected.
3. **Key rotation.** Signing keys are identified, rotatable and overlappable: a new key is trusted
   before the old one stops being used, and the old one is retired after the longest possible lease
   plus grace has elapsed (§8). Clients learn new keys through normal renewal and through the signed
   application update channel — never from the lease itself.
4. **Proof of possession at activation and renewal.** The device proves control of its private key by
   signing a server-supplied challenge. A lease is issued only to a device that has demonstrated
   possession, freshly, at that moment.
5. **Clock-rollback handling.** Verification never trusts the local clock alone: it keeps a monotonic
   high-water mark of the latest trusted time seen, and treats a clock earlier than that mark as
   untrusted rather than as valid time (§11, §12.8).
6. **No reusable bearer entitlement.** Because the lease names a device key thumbprint and the runtime
   check requires the matching private key, a copied lease is inert on another device.

### 7.4 Device key pairs

- **Application-generated, per device, non-exportable where the platform allows it.** Android Keystore
  keeps key material out of the app process entirely and can bind it to the TEE or a Secure Element
  (`KeyInfo.getSecurityLevel()`, `setIsStrongBoxBacked(true)`, `ECDSA P-256`) [G-KS]; Apple's
  `SecureEnclave` provides `SecureEnclave.P256` where `SecureEnclave.isAvailable` [A-SE]. TV platforms
  offer weaker guarantees; the model must degrade to a software-protected key without changing shape.
- **Never raw hardware fingerprinting.** No IMEI, no advertising identifier, no serial number, no
  composite hardware hash. A device is *whatever holds a given key pair*. This survives OS upgrades and
  hardware replacement in a way fingerprinting does not, and it collects nothing.
- A regenerated key is a **new device** and consumes a seat until the old registration is removed
  (§9.3).

### 7.5 Activation requires connectivity; ordinary launch does not

- **Activation** — first run on a device, or re-activation after expiry — requires reaching the
  Tesserafin backend. This is the only mandatory online moment.
- **Ordinary launch** verifies the stored lease locally, offline, with no network call to anything.
- **Renewal** happens silently in the background whenever the device is online and the lease is inside
  its renewal window. The user should never see it.

---

## 8. Decision 6 — offline duration

### 8.1 What the number has to survive

`tesserafin#100` recorded an initial target of roughly 7–14 days. That figure is an input, not a
decision, and this RFC evaluates it rather than adopting it.

Tesserafin is **local-first by design**. Its users disproportionately run a server on a home LAN, and
a meaningful number run it deliberately isolated. Real cases the lease must survive without a
support interaction:

| Case | Rough duration |
| --- | --- |
| Home internet outage / ISP fault | hours – several days |
| Holiday with a TV or tablet away from home | 1 – 3 weeks |
| A deliberately network-isolated household server | indefinite |
| A device used seasonally (guest room, cabin) | months |
| Backend maintenance or a Tesserafin service incident | hours – days |

A 14-day lease fails the second row routinely. That is the decisive observation: a three-week holiday
is not an edge case for a home media product, and an entitlement that expires mid-holiday converts a
paid product into a support ticket.

### 8.2 Options compared

Common to all three: silent renewal whenever online, so a device with any connectivity never reaches
expiry at all.

| | **A — 14-day lease** | **B — 30-day lease** | **C — 30-day lease + 14-day recovery grace** |
| --- | --- | --- | --- |
| Survives a 3-week holiday | **No** | Yes | Yes |
| Survives a month-long isolation | No | Marginal | Yes |
| Behaviour at expiry | hard stop | hard stop | degraded-but-usable window, then stop |
| User-visible warning runway | short | comfortable | comfortable + explicit grace |
| **Max delay before revocation bites** | **14 days** | **30 days** | **44 days** |
| Support burden | highest | moderate | lowest |
| Abuse exposure | lowest | moderate | highest |

### 8.3 Recommendation

> **Option C — a 30-day signed lease, renewed silently from day 15, plus a bounded 14-day recovery
> grace after expiry.**

Rationale: option A is disqualified by the holiday case. Between B and C, the grace is what separates
"your entitlement expired, the app stops" from "your entitlement expired, here is a fortnight to
reconnect, and the app keeps working while you do." For a local-first product whose users chose it
partly to *not* depend on someone else's servers, the second is the correct behaviour, and the cost is
14 days of extra revocation latency in the rare revocation case.

The grace window is **explicitly signalled**, from the first day, in plain language: what is happening,
how long is left, and exactly what will restore it. A grace period the user discovers only when it
ends is not a grace period.

**This entire policy is an owner-review item (§14.1)**: 30 and 14 are the recommended values, not
protocol constants, and both must be server-configurable so a future adjustment is a policy change,
not a client release.

### 8.4 Maximum revocation delay, quantified

> **Under the recommended policy, a device that never reconnects can continue running for at most
> 30 + 14 = 44 days after a revocation is recorded.**

Bounding facts:

- Revocation takes effect at the **next renewal or expiry**, whichever comes first — not immediately.
- A device that *is* online reaches its next renewal within the renewal window, so the practical delay
  for a connected device is **days, not weeks**.
- 44 days is the worst case for a device that goes offline immediately after its last renewal and
  never returns.
- Refund-driven revocation is the dominant real case, and 44 days of residual access on a single
  device after a refund is an acceptable commercial loss for a one-time purchase. It is emphatically
  *not* acceptable for a compromised-account case, which is why §8.5 exists.

For comparison the same figure is 14 days under option A and 30 under option B.

### 8.5 Critical revocation

An **online critical-revocation** mechanism is defined as a narrow exception: when a device *is*
online, a hard revocation (confirmed account compromise, confirmed fraud) takes effect at the next
contact rather than waiting for the renewal window.

It does **not** create an online requirement for ordinary launches (§7.5), and it does **not** reach an
offline device. It is deliberately narrow: an entitlement system that can reach into an offline device
and switch it off is a bigger risk to legitimate users than the fraud it prevents.

---

## 9. Decision 7 — devices and the family-compatible model

### 9.1 Seats, not fingerprints

An entitlement grant carries an **active-device allowance**: a number of concurrently activated
devices. A device occupies a seat from activation until deactivation; a device is identified by its
key pair (§7.4).

The allowance is a **server-side property of the grant**, not a constant compiled into a client. This
is what makes a family product a configuration rather than a redesign.

### 9.2 Self-service

Users manage their own devices, without contacting support:

- **List** activated devices: user-chosen label, platform, activation date, last-seen date.
- **Deactivate** any device, including one that is lost, stolen, sold or broken.
- **Rename** a device. Labels are chosen by the user and are the only free text stored (§10).

A deactivated device's lease is not remotely killed; it stops renewing and expires (§8.4).

### 9.3 Replacement and lost devices

- Replacing hardware is: activate the new device, deactivate the old one. No support interaction.
- A lost device is deactivated from any other device, or through account recovery (§5.5) if it was the
  only one.
- **If the limit is reached**, the app offers a clear choice — deactivate one of the listed devices, or
  cancel — never a dead end and never a silent failure. This is the single most common friction point
  in device-limited products and it must be designed, not defaulted.
- A reinstall that regenerates the key pair consumes a seat. To keep this from silently exhausting the
  allowance, a self-deactivation on uninstall/reset is attempted where the platform permits, and
  long-unseen registrations are reported to the user as reclaimable.

### 9.4 Abuse limits

Rate limits on activation, deactivation, restoration and renewal, per account, per device and per
source address. A pattern of rapid activate/deactivate cycling is flagged for review rather than
silently blocked — a legitimate user with flaky hardware must not be locked out by an anti-abuse rule.

### 9.5 Family-compatible by construction

A future family product is **the same protocol with a larger allowance**. Nothing about the lease
(§7.2), activation (§7.5) or device model changes. A "family" grant may additionally carry:

- a seat allowance greater than the personal default;
- optionally, sub-holders — additional Tesserafin accounts sharing one grant, each with their own
  devices and their own seats drawn from the shared allowance.

**Store-native family sharing is a distinct authority and must not double-grant.** Apple raises
`ONE_TIME_CHARGE` when a "customer receives access to a non-consumable In-App Purchase through Family
Sharing" [A-NT], and Google Play has its own family library. A household that obtains access through
both a store's family feature *and* a Tesserafin family grant must resolve to **one** entitlement per
person, not two. The normalisation rule: a store-family-derived grant and a Tesserafin-family seat for
the same person collapse to a single grant, with the store-derived one taking precedence because the
store is the purchase authority (§4.2).

### 9.6 Numbers are commercial policy, not protocol

A default personal allowance in the region of **3–5 concurrently activated devices** is *suggested* as
a starting point. **It is an owner-review item (§14.2), not a protocol constant.** Family seat counts,
the number of plans and all pricing — personal or family — are outside this RFC (§13).

---

## 10. Decision 8 — privacy and data minimisation

RFC-0006 §7.1(3) states that "nothing about a household's media reaches Tesserafin infrastructure by
default." This section is the operational allow/deny table for the account plane.

### 10.1 Allowed

| Category | Detail | Why it is necessary |
| --- | --- | --- |
| Buyer / account identity | Account identifier; email address for sign-in and recovery | Cannot own or recover a purchase anonymously |
| Store and purchase grant | Which store, which product, which grant, minimal purchase reference (§6.7) | Validation, refund handling, dispute resolution |
| Restoration history | That a restoration happened, when, to which account | Fraud prevention, support |
| Active device registrations | Device public key, user-chosen label, platform, activation and last-seen dates | Device limit, self-service management, lost-device recovery |
| Minimal security / session / audit data | Sessions, revocations, sign-in events, security-relevant actions | Account security, incident response |
| Optional account preferences | Non-sensitive, opt-in, explicitly listed at the time | Convenience only; never required |

### 10.2 Forbidden by default

| Never stored, never received | |
| --- | --- |
| Media files or any content | Media-library inventory, titles, counts |
| Playback history or progress | Household or server users |
| Server addresses, hostnames or network topology | Local media identifiers |
| Remote-access credentials or server tokens | Telemetry unrelated to account security and licensing |
| Media relay or proxying of any kind | Payment instrument data |
| Raw hardware identifiers or device fingerprints | Contact lists, location, advertising identifiers |

"By default" carries the same weight as in RFC-0006 §7.1(3): any future opt-in is an explicit,
separately reviewed decision, and its **absence is the shipped behaviour**. A "temporary diagnostic
exception" to this table is a change to this table.

### 10.3 Structural consequences

- Because the lease (§7.2) carries no personal data beyond opaque identifiers, a lease captured at rest
  or in transit discloses nothing about a household.
- Because device identity is a key thumbprint (§7.4), the device table cannot be correlated with any
  other dataset.
- Because there is no media relay, Tesserafin infrastructure is not on the path of a single byte of
  anyone's media — the strongest possible statement of the boundary, and the one RFC-0006 §7.2 already
  made.

---

## 11. Decision 9 — failure and recovery matrix

Every row states what the user sees. "Fails clearly" always means: an explanation, a cause, and an
action — never a crash, never a silent downgrade.

| # | Situation | Behaviour |
| --- | --- | --- |
| 1 | **Activation attempted offline** | Activation cannot complete. The app says connectivity is needed *for this step only*, and offers retry. It does not pretend to succeed. |
| 2 | **Ordinary launch, offline, valid lease** | Runs normally. No network call, no degradation, no notice. This is the common case and it must be invisible. |
| 3 | **Lease expired while offline** | Enters the recovery grace (§8.3): app keeps working, with an explicit, non-dismissable-but-non-blocking notice stating time remaining and the exact fix. After grace: the §3.3 unentitled state — activation and recovery surfaces retained, local data intact, server untouched. |
| 4 | **Tesserafin account service outage** | Valid leases unaffected. Renewal retries with backoff; the lease's remaining life absorbs the outage. Activation is unavailable and says so. An outage never revokes. |
| 5 | **Store outage** | Purchase and restoration fail transiently with "try again later," never "not owned." Existing leases unaffected (§6.6). |
| 6 | **Purchase already restored to a different account** | Refused, explained, no information disclosed about the other account, one path offered: recover that account, or request a human-reviewed transfer (§6.4). |
| 7 | **Device limit reached** | The app lists the activated devices and offers deactivation of one, or cancel. Never a dead end (§9.3). |
| 8 | **Lost or stolen device** | Deactivate from another device or via account recovery. The lost device stops renewing and expires (§8.4). |
| 9 | **Refund or chargeback** | Grant revoked on the store's notification (§6.5). Existing leases expire rather than dying instantly; max 44 days (§8.4). `REFUND_REVERSED` restores the grant. |
| 10 | **Signing-key rotation** | Overlapping validity: the new key is trusted before the old is retired, and the old key is retired only after the longest lease + grace has elapsed. No user-visible event, no forced re-activation. |
| 11 | **Suspected account compromise** | Revoke all device leases, invalidate sessions, force re-authentication. Online devices are cut off at next contact (§8.5); offline devices at expiry. The user is notified through a channel the attacker does not control. |
| 12 | **Local clock rollback** | Verification uses the monotonic high-water mark (§7.3(5)). A clock behind that mark is untrusted: the app does not extend a lease, does not immediately lock out, and prompts to correct time or reconnect. A rolled-back clock is a *time* problem, never treated as a *fraud* problem in the user-facing path. |
| 13 | **Tesserafin service discontinuation** | See §11.1. |

### 11.1 The exit principle

> **A legitimately purchased Tesserafin client must not become permanently unusable because Tesserafin
> stopped operating the licensing service.**

This RFC states the principle and the requirement; the mechanism is an **owner-review item (§14.3)**
because it is a commitment about the future of the business, not a technical detail an ADR should
settle alone.

The requirement: **before** the first paid client ships, there must exist a decided, documented and
publicly stated wind-down path such that discontinuation of the licence plane does not strand paying
customers. Candidate mechanisms, to be chosen by the owner:

- a final long-lived or non-expiring lease issued to every active grant during a wind-down window;
- a signed application update that removes the entitlement check entirely;
- publication of a verification key together with a permanently valid lease format;
- some combination, with a stated minimum notice period.

Two things are decided here regardless of which is chosen: the wind-down path must be **decided before
launch, not improvised at the end**, and it must not require the user to have been online at the moment
the service stopped.

---

## 12. Threat model

| # | Threat | Mitigation |
| --- | --- | --- |
| 1 | **Forged receipts** | Only server-side validation against the store's own API grants (§6.1). A forged artefact never reaches a grant, because the client's report is never authoritative. |
| 2 | **Receipt replay** | One purchase identifier maps to at most one grant, forever, via a uniqueness ledger [G-SEC] (§6.2). Re-presentation is a conflict, not a grant. |
| 3 | **Copied entitlement lease** | The lease names a device key thumbprint and use requires the matching private key (§7.3(6)). A copied lease is inert elsewhere. |
| 4 | **Extracted app secrets** | There are none. The client is a public OAuth client (§5.3) and verifies leases with a public key (§7.3(1)). RFC-0006 §7.1(4) makes this permanent. Nothing in a distributed binary is worth extracting. |
| 5 | **Compromised device** | Hardware-backed non-exportable keys where available [G-KS][A-SE] raise the cost. A compromised device is contained by per-device revocation (§9.2) — it cannot compromise the account's other devices or the grant itself. |
| 6 | **Account takeover** | PKCE + system browser (§5.3), no password ever entered in the app, per-device revocation, critical revocation (§8.5), and out-of-band notification (§11 row 11). |
| 7 | **Fraudulent restoration** | Store-verified evidence only; conflict handling that never double-grants (§6.4); rate limits (§9.4); human review for transfers. |
| 8 | **Malicious clock change** | Monotonic high-water mark (§7.3(5)). Rolling the clock back cannot extend a lease; rolling it forward only expires the attacker's own lease sooner. |
| 9 | **Signing-key compromise** | Key identifiers and overlapping rotation (§7.3(3)) make revoking a key a routine operation. Exposure is bounded by the longest lease + grace (§8.4). Algorithm pinning prevents downgrade or confusion attacks. |
| 10 | **Backend database exposure** | Minimisation is the mitigation: no media data, no server addresses, no playback history, no payment instruments (§10.2). Device identity is a public key. Purchase references are minimised and hashed where possible (§6.7). An exposed database reveals who bought a product — bad, but bounded, and it reveals nothing about anyone's library. |
| 11 | **Store webhook spoofing** | Cryptographic sender authentication on every callback, transport security (Apple requires TLS 1.2+ [A-SN]), idempotent handling of redelivery, and — critically — a notification is treated as a *trigger to re-query the store's authoritative API* [G-RTDN], never as the fact itself. |

---

## 13. Explicit exclusions

This RFC authorises **none** of the following, and merging it authorises none of them:

- client code of any kind, for any platform;
- a backend service, deployment or environment;
- a database schema;
- a billing vendor or payment processor selection;
- any store integration (Google Play Billing, StoreKit, Samsung Checkout, or any other);
- signing keys, key material or key generation;
- a token implementation or container choice;
- account, activation or device-management user interface;
- analytics or telemetry of any kind;
- family-plan or any other pricing;
- marketplace implementation;
- creation of a native client repository, including `tesserafin-mobile`;
- dependency, lockfile or generated-artefact changes.

Every implementation item is post-ADR and belongs to separately reviewed, bounded issues.

---

## 14. Owner-review items

These are deliberately **not** decided here. Each needs an explicit owner answer before the
corresponding implementation issue is opened.

| # | Item | Recommendation offered |
| --- | --- | --- |
| **14.1** | Offline lease duration and grace | 30-day lease + 14-day recovery grace; max revocation delay **44 days** (§8.3, §8.4). Both values server-configurable. |
| **14.2** | Default personal active-device allowance | 3–5 devices, as commercial policy, not a protocol constant (§9.6). |
| **14.3** | Service-discontinuation exit mechanism | Principle decided (§11.1); mechanism and notice period to be chosen and stated publicly **before** the first paid client ships. |
| **14.4** | External identity providers on iOS/tvOS | Either offer an [A-GL] 4.8-compliant equivalent login option, or use Tesserafin sign-in exclusively and rely on 4.8's own-systems exemption (§5.4). |
| **14.5** | Honouring an entitlement acquired on another platform inside a store app | Permitted by [A-GL] 3.1.3(b) **only while the same item is also offered as an in-app purchase in that app**. Whether to take that path at all is an owner decision (§4.6). |
| **14.6** | webOS channel shape | Paid LG Apps listing, or free listing with account activation. No first-party LG IAP exists [L-IAP]. Whether to enter any third-party billing contract is an owner decision (§4.5). |
| **14.7** | Product granularity | This RFC assumes one product per platform family with Universal Purchase where a store offers it. Whether Android and iOS are one product or two — and therefore whether a buyer on one platform pays again on the other — is commercial, and §4.6 deliberately promises nothing. |
| **14.8** | Family product shape | Seat-based model decided (§9.5); seat counts, plan count and pricing are commercial and excluded (§13). |

---

## 15. Sources

All external sources accessed **2026-08-09**.

| Tag | Source | URL |
| --- | --- | --- |
| [G-POL] | Google Play — Payments policy | https://support.google.com/googleplay/android-developer/answer/9858738 |
| [G-INT] | Google Play Billing — Integrate the Google Play Billing Library | https://developer.android.com/google/play/billing/integrate |
| [G-SEC] | Google Play Billing — Security and verifying purchases | https://developer.android.com/google/play/billing/security |
| [G-RTDN] | Google Play Billing — Getting ready / real-time developer notifications | https://developer.android.com/google/play/billing/getting-ready |
| [G-KS] | Android — Keystore system | https://developer.android.com/privacy-and-security/keystore |
| [A-GL] | Apple — App Store Review Guidelines (3.1.1, 3.1.2, 3.1.3, 4.8, 5.1.1(v)) | https://developer.apple.com/app-store/review/guidelines/ |
| [A-CE] | Apple — `Transaction.currentEntitlements` | https://developer.apple.com/documentation/storekit/transaction/currententitlements |
| [A-UP] | Apple — `Transaction.updates` | https://developer.apple.com/documentation/storekit/transaction/updates |
| [A-TX] | Apple — App Store Server API, Get Transaction Info | https://developer.apple.com/documentation/appstoreserverapi/get-transaction-info |
| [A-SN] | Apple — App Store Server Notifications V2 | https://developer.apple.com/documentation/appstoreservernotifications/app-store-server-notifications-v2 |
| [A-NT] | Apple — `notificationType` | https://developer.apple.com/documentation/appstoreservernotifications/notificationtype |
| [A-SE] | Apple — CryptoKit `SecureEnclave` | https://developer.apple.com/documentation/cryptokit/secureenclave |
| [S-CO] | Samsung — Samsung Checkout, Implementing the Purchase Process | https://developer.samsung.com/smarttv/develop/guides/samsung-checkout/implementing-the-purchase-process.html |
| [L-IAP] | LG webOS TV — In-App Purchase | https://webostv.developer.lge.com/develop/guides/in-app-purchase |
| [L-ECO] | LG webOS TV — App Ecosystem | https://webostv.developer.lge.com/distribute/app-ecosystem |
| [R-8252] | RFC 8252 — OAuth 2.0 for Native Apps | https://www.rfc-editor.org/rfc/rfc8252 |
| [R-7636] | RFC 7636 — Proof Key for Code Exchange by OAuth Public Clients | https://www.rfc-editor.org/rfc/rfc7636 |
| [OIDC] | OpenID Connect Core 1.0 | https://openid.net/specs/openid-connect-core-1_0.html |

Repository sources: `docs/tesserafin/RFC-0006-native-client-foundation.md` (§1.3, §3, §5.2, §6, §7),
`docs/tesserafin/RFC-0007-theme-platform-v2.md`, `tesserafin#100`, `tesserafin#129`, `tesserafin#142`,
`tesserafin-web#146`.

**Currency of §2.** Every claim in §2 is an observation of third-party policy on the access date
above. Before any implementation issue derived from this RFC is opened, §2 must be re-verified against
the same primary sources. A change in §2 changes which channel row applies (§4); it does not change
§3 or §5–§12.

---

## 16. Consequences

### 16.1 Decided now

1. An entitlement activates an official native application and nothing else (§3).
2. Server, Tesserafin Web and media access are permanently outside the entitlement's reach (§3.2).
3. Store purchase is the platform entitlement authority where a first-party IAP mechanism exists;
   Tesserafin normalises evidence into grants and issues device leases (§4.2).
4. No cross-store purchase transfer is promised (§4.6).
5. Sign-in is OAuth 2.0 Authorization Code + PKCE `S256` in the system browser, never an embedded
   WebView, with no password ever entered in the app (§5.3).
6. Entitlement is carried by an asymmetrically signed, device-bound, non-bearer lease (§7).
7. Recommended offline policy: 30-day lease + 14-day grace, max revocation delay 44 days (§8).
8. Devices are key pairs with a server-configurable seat allowance; family products are the same
   protocol with a larger allowance (§9).
9. The privacy allow/deny table is explicit and its deny side is the shipped default (§10).
10. Every failure mode has a defined, non-destructive recovery path, including service discontinuation
    (§11).

### 16.2 Enabled later, not started here

Implementation of the account service, the entitlement service, per-store validation, the client
activation surfaces, and the family product. Each needs its own bounded, separately reviewed issue.

### 16.3 Deliberately deferred

Everything in §13, and every item in §14.

### 16.4 Compatibility impact

**None.** This document changes no code, no dependency, no generated artefact and no product
behaviour. The server, Tesserafin Web and every existing installation are unaffected by merging it.
