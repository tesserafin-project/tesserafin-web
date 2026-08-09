# Native Wave 1 — M0 evidence register

- **Status**: **Accepted 2026-08-09** alongside
  [`M0-product-and-delivery-discovery.md`](./M0-product-and-delivery-discovery.md), which it supports.
  Acceptance of the discovery packet **closed no evidence gap**: the thirteen gaps in §F were open on
  2026-08-09 and are open still. Nothing here is marked researched because a decision was taken
  around it.
- **Accountable maintainer**: [`all3f0r1`](https://github.com/all3f0r1).
- **Milestone**: [`tesserafin#222`](https://github.com/tesserafin-project/tesserafin/issues/222),
  under the umbrella [`tesserafin#221`](https://github.com/tesserafin-project/tesserafin/issues/221).
- **Access date for every external source below**: **2026-08-09**. Where a page publishes its own
  "last updated" stamp, that stamp is recorded separately in the *Limitation* column, because the two
  dates answer different questions: the access date says when this register looked, the page stamp
  says when the publisher last moved.
- **Repository baselines observed**: `tesserafin-web` `main` =
  `2da3ce4c0b39718cb3602b50712d23d2c70f6f4f`; `tesserafin` `master` =
  `1cca371cbaeef63a03e055eab158b8a51759f92f`.

## How to read this register

Every material claim in the discovery document cites an ID from this file. An ID is a promise that
the claim was checked against the named source on the access date — not that the source is eternal.

**Evidence classes**, used exactly as `tesserafin#222` defines them:

| Class | Meaning |
| --- | --- |
| `normative platform rule` | A platform or store owner's own current documentation states a requirement. |
| `accepted Tesserafin decision` | RFC-0006 or RFC-0008, both Accepted 2026-08-09. Not reopenable here. |
| `observed product behaviour` | What a product (including Tesserafin's own) is observed to do. |
| `reusable interaction principle` | A pattern worth adopting on its merits, independent of who does it. |
| `platform convention` | Widely followed on a platform; not a rule. |
| `product-specific convention` | One product's choice, valid for it, not generalisable. |
| `must-not-copy pattern` | Observed and deliberately rejected. |
| `unresolved evidence gap` | Named, and not answered by this iteration. |

**Confidence** is `high` (primary source, quoted, unambiguous), `medium` (primary source, but the
claim needs interpretation to reach the decision it supports) or `low` (indirect, or the source
answers a neighbouring question).

No search-results page is cited anywhere in this register.

---

## A. Normative platform rules — Google Play and Android

### P-01 — Google Play target API level requirement

| Field | Value |
| --- | --- |
| **Source title** | Target API level requirements for Google Play apps |
| **URL** | https://support.google.com/googleplay/android-developer/answer/11926878 |
| **Publisher** | Google (Play Console Help) |
| **Access date** | 2026-08-09 |
| **Platform** | Android phone/tablet, Android TV |
| **Supports** | Supported-platform range; owner question Q3; M1 build configuration |
| **Observation** | "New apps and app updates must target Android 16 (API level 36) or higher to be submitted to Google Play; except for Wear OS…". Wear OS and Android Automotive: API 35 or higher. **Android TV and Android XR: Android 14 (API level 34) or higher.** Enforcement date **31 August 2026**, with an extension available to **1 November 2026**. Existing apps targeting API 34 or lower stop being discoverable to users on newer Android OS versions than the app targets. |
| **Class** | `normative platform rule` |
| **Confidence** | high |
| **Limitation** | The page publishes no "last updated" stamp. The requirement moves annually; it must be re-read before M1 sets `targetSdk`. The 31 August 2026 date is **22 days after this access date** — this register does not assume the rule is stable through M1. |

### P-02 — Free-to-paid is irreversible under one package name

| Field | Value |
| --- | --- |
| **Source title** | Set an app's price (Free or Paid selection) |
| **URL** | https://support.google.com/googleplay/android-developer/answer/6334373 |
| **Publisher** | Google (Play Console Help) |
| **Access date** | 2026-08-09 |
| **Platform** | Android phone/tablet, Android TV |
| **Supports** | Store topology; provisional application identifier; owner questions Q1, Q2; RFC-0008 §2.1 currency re-check |
| **Observation** | "Once your app has been offered for free, the app can't be changed to paid. If you want to charge for the app, you need to create a new app with a new package name and set a price." Paid → free is permitted. |
| **Class** | `normative platform rule` |
| **Confidence** | high |
| **Limitation** | No page-published update stamp. This is the re-verification of RFC-0008 `[G-PRICE]`: **unchanged in substance as of 2026-08-09**, so RFC-0008 §4.3's decision to fix the pricing model now still stands on its stated reason. |

### P-03 — Play billing is mandatory for in-app digital purchases; anti-steering

| Field | Value |
| --- | --- |
| **Source title** | Google Play Payments policy |
| **URL** | https://support.google.com/googleplay/android-developer/answer/9858738 |
| **Publisher** | Google (Play Console Help) |
| **Access date** | 2026-08-09 |
| **Platform** | Android phone/tablet, Android TV |
| **Supports** | Commercial UX state model; purchase and restore flows; RFC-0008 §2.1 currency re-check |
| **Observation** | "Play-distributed apps requiring or accepting payment for access to in-app features or services, including any app functionality, digital content or goods must use Google Play's billing system for those transactions unless Section 3, 8, or 9 applies." Exemptions listed are physical goods/services, peer-to-peer payments, auctions, tax-exempt donations and online gambling facilitation. Anti-steering: "Apps may not lead users to a payment method other than Google Play's billing system", covering in-app promotions, webviews, buttons, links and account creation flows. |
| **Class** | `normative platform rule` |
| **Confidence** | high |
| **Limitation** | No revision date published; the visible "©2026 Google" is a site copyright, not a policy revision stamp. This is the re-verification of RFC-0008 `[G-POL]`: **unchanged in substance**. The exemption list still does not describe a paid media client. |

### P-04 — One-time product mechanics, restore, acknowledgement, PENDING

| Field | Value |
| --- | --- |
| **Source title** | Integrate the Google Play Billing Library into your app |
| **URL** | https://developer.android.com/google/play/billing/integrate |
| **Publisher** | Google (Android Developers) |
| **Access date** | 2026-08-09 |
| **Platform** | Android phone/tablet, Android TV |
| **Supports** | Commercial UX states *purchase available*, *purchase pending*, *purchase completed*, *restore successful*, *restore finds nothing*; RFC-0008 §2.1 currency re-check |
| **Observation** | One-time non-consumable products are `ProductType.INAPP`. Purchases surface through `PurchasesUpdatedListener`, which "will not be invoked if the app isn't running or lacks an active Billing Library connection"; the documented remedy is `BillingClient.queryPurchasesAsync()` with `QueryPurchasesParams`, recommended whenever the app establishes a connection. The multi-device case is stated verbatim: "A user may buy an item on one device and then expect to see the item when they switch devices." Acknowledgement via `BillingClient.acknowledgePurchase()` is required **within three days** or the purchase is automatically refunded; `Purchase.isAcknowledged()` must be checked first. On PENDING: "You should acknowledge a purchase only when the state is `PURCHASED`… The three-day acknowledgement window begins only when the purchase state transitions from 'PENDING' to 'PURCHASED'." |
| **Class** | `normative platform rule` |
| **Confidence** | high |
| **Limitation** | Page last updated **2026-08-06 UTC**. Re-verification of RFC-0008 `[G-INT]`: **unchanged in substance**, and it additionally supplies the PENDING semantics RFC-0008 did not record. |

### P-05 — Server-side purchase verification, uniqueness, refunds, account binding

| Field | Value |
| --- | --- |
| **Source title** | Security and verifying purchases (Google Play Billing) |
| **URL** | https://developer.android.com/google/play/billing/security |
| **Publisher** | Google (Android Developers) |
| **Access date** | 2026-08-09 |
| **Platform** | Android phone/tablet, Android TV |
| **Supports** | Commercial UX *store receipt recognised*; RFC-0008 §6.1, §6.2 currency re-check |
| **Observation** | `purchaseToken` is to be sent to a backend and recorded; it "is globally unique, so you can safely use this value as a primary key in your database". "Don't use `orderId` to check for duplicate purchases or as a primary key in your database, as not all purchases generate an `orderId`. In particular, purchases made with promo codes don't generate an `orderId`." Verification endpoint `Purchases.products:get`. For rejected purchases: `Orders:refund` with `revoke` set to `true` — "Setting the `revoke` parameter ensures that access is revoked… and gives Google Play a clear signal that the purchase was rejected by the developer." `BillingFlowParams.Builder#setObfuscatedAccountId` supplies an application-side account identifier for fraud detection. |
| **Class** | `normative platform rule` |
| **Confidence** | high |
| **Limitation** | Page last updated **2026-08-06 UTC**. Re-verification of RFC-0008 `[G-SEC]`: **unchanged in substance**. |

### P-06 — Real-time developer notifications

| Field | Value |
| --- | --- |
| **Source title** | Getting ready — real-time developer notifications |
| **URL** | https://developer.android.com/google/play/billing/getting-ready |
| **Publisher** | Google (Android Developers) |
| **Access date** | 2026-08-09 |
| **Platform** | Android phone/tablet, Android TV |
| **Supports** | Commercial UX *entitlement expired*, *vendor-sunset entitlement* boundaries; RFC-0008 §6.5 currency re-check |
| **Observation** | RTDN delivers entitlement-change notifications over Google Cloud Pub/Sub. One-time product notification types are `ONE_TIME_PRODUCT_PURCHASED` and `ONE_TIME_PRODUCT_CANCELED`, received only when "Get all notifications for subscriptions and one-time products" is enabled; voided-purchase notifications are available under both settings. "You must call the Google Play Developer API after receiving Real-time developer notifications to get the complete status and update your own backend state. These notifications tell you only that the purchase state changed. They do not give you complete information about the purchase." |
| **Class** | `normative platform rule` |
| **Confidence** | high |
| **Limitation** | Page last updated **2026-08-06 UTC**. Re-verification of RFC-0008 `[G-RTDN]`: **unchanged in substance**. Server-side concern; no M1 client work follows from it. |

### P-07 — Android Keystore, hardware-backed device keys

| Field | Value |
| --- | --- |
| **Source title** | Android Keystore system |
| **URL** | https://developer.android.com/privacy-and-security/keystore |
| **Publisher** | Google (Android Developers) |
| **Access date** | 2026-08-09 |
| **Platform** | Android phone/tablet, Android TV |
| **Supports** | Device identity as a key pair (RFC-0008 §7.4); commercial UX *device activation successful*; RFC-0008 §2.1 currency re-check |
| **Observation** | "Key material never enters the application process… If the app's process is compromised, the attacker might be able to use the app's keys but can't extract their key material." Key material "can be bound to the secure hardware of the Android device, such as the Trusted Execution Environment (TEE) or Secure Element (SE)". For apps targeting API 29+, `KeyInfo.getSecurityLevel()` returning `TRUSTED_ENVIRONMENT` or `STRONGBOX` "indicate that the key resides within secure hardware". `KeyGenParameterSpec.Builder(...).setIsStrongBoxBacked(true)` requests StrongBox. StrongBox supports a subset including **ECDSA, ECDH P-256**, RSA 2048, AES 128/256, HMAC-SHA256. |
| **Class** | `normative platform rule` |
| **Confidence** | high |
| **Limitation** | Page last updated **2026-03-06 UTC**. Re-verification of RFC-0008 `[G-KS]`: **unchanged in substance**. StrongBox presence is device-dependent; RFC-0008 §7.4 already requires graceful degradation to a software-protected key, and this source does not tell us how many Android TV devices offer StrongBox. |

### P-08 — Android TV manifest identity and in-app banner

| Field | Value |
| --- | --- |
| **Source title** | Get started with TV apps |
| **URL** | https://developer.android.com/training/tv/start/start |
| **Publisher** | Google (Android Developers) |
| **Access date** | 2026-08-09 |
| **Platform** | Android TV |
| **Supports** | One-listing-versus-two decision (Q1); TV shell; M1 acceptance gates |
| **Observation** | A TV app declares an activity with `<category android:name="android.intent.category.LEANBACK_LAUNCHER" />` — "This filter identifies your app as being enabled for TV and lets Google Play identify it as a TV app." It declares `<uses-feature android:name="android.software.leanback" android:required="false" />` when the app runs on both mobile and TV, and **must** declare `<uses-feature android:name="android.hardware.touchscreen" android:required="false" />`: "You must declare that a touchscreen is not required… Otherwise, your app doesn't appear in Google Play on TV devices." The in-app banner is `android:banner` on `<application>`, **320 × 180 px at xhdpi**, text must be included in the image, and localised variants are required per supported language. On packaging: "We recommend that you have a single app that supports both mobile devices and TV devices." |
| **Class** | `normative platform rule` |
| **Confidence** | high |
| **Limitation** | Page last updated **2025-04-17 UTC** — the oldest Android source used for a normative claim here. The single-app recommendation is a recommendation, not a rule; the touchscreen declaration is a rule. |

### P-09 — Android TV app quality criteria

| Field | Value |
| --- | --- |
| **Source title** | TV app quality |
| **URL** | https://developer.android.com/docs/quality-guidelines/tv-app-quality |
| **Publisher** | Google (Android Developers) |
| **Access date** | 2026-08-09 |
| **Platform** | Android TV |
| **Supports** | TV shell; TV first vertical; TV test matrix |
| **Observation** | **TV-DP**: "The app functionality is navigable using five-way D-pad controls". **TV-DM**: "The app does not depend on a remote control device having a Menu button to access user interface controls." **TV-DB**: "Back button presses lead back to the Android TV home screen." **TV-PC**: D-pad centre toggles pause/resume during playback; left/right fast-forward and rewind. **TV-LM**: a launcher icon appears in the Android TV Launcher after installation. **TV-LB**: "both a 320x180 pixel full-size banner and at least a 160x160 pixel (at xhdpi density) app icon". **TV-BN**: the launch banner contains the app name. **TV-NP**: "If the app continues to play audio after the user returns to the home screen or switches to another app, the app provides media controls in the system UI… **Video apps must not use these media controls, and video must be paused when the user switches out of the app.**" **TV-PP**: play/pause key events toggle playback. |
| **Class** | `normative platform rule` |
| **Confidence** | high |
| **Limitation** | Page last updated **29 June 2026**. TV-NP is the criterion most likely to be violated by carrying a phone media-session design onto TV unchanged; it is quoted in full for that reason. |

### P-10 — Android TV D-pad navigation and focus

| Field | Value |
| --- | --- |
| **Source title** | Handle TV navigation |
| **URL** | https://developer.android.com/training/tv/start/navigation |
| **Publisher** | Google (Android Developers) |
| **Access date** | 2026-08-09 |
| **Platform** | Android TV |
| **Supports** | TV shell deterministic-focus requirement; TV flow inventory |
| **Observation** | "The Android framework handles directional navigation between layout elements automatically, so you typically do not need to do anything extra for your app", but "you should thoroughly test navigation with a D-pad controller to discover any navigation problems." The requirement: "Ensure that a user with a D-pad controller can navigate to all visible controls on the screen." Focus visibility: "The success of an app's navigation scheme on TV devices depends on how easy it is for a user to determine what user interface element is in focus", with colour, size and animation recommended. Explicit ordering attributes are `android:nextFocusUp`, `android:nextFocusDown`, `android:nextFocusLeft`, `android:nextFocusRight`, to be used "only… if the default order that the system applies does not work well." |
| **Class** | `normative platform rule` |
| **Confidence** | high |
| **Limitation** | Page last updated **2026-03-05 UTC**. "All visible controls" is a reachability rule; it says nothing about *determinism* of focus movement, which is a Tesserafin requirement (see D-05 in the discovery document), not a platform rule. |

### P-11 — Ten-foot design foundations

| Field | Value |
| --- | --- |
| **Source title** | Design for TV |
| **URL** | https://developer.android.com/design/ui/tv/guides/foundations/design-for-tv |
| **Publisher** | Google (Android Developers) |
| **Access date** | 2026-08-09 |
| **Platform** | Android TV |
| **Supports** | Ten-foot information density; the "communal device" argument in the commercial and privacy sections |
| **Observation** | Average TV viewing distance is stated as **3 metres (10 feet)**. Text and elements must be readable at that distance and the amount of text should be limited. "The interface must be fully navigable using only directional pad and select button", with instant, distinct feedback on button press. TV is described as a **communal/shared household device**, and apps displaying personal information should offer privacy settings. |
| **Class** | `normative platform rule` (design guidance; the D-pad-only statement restates P-09 TV-DP) |
| **Confidence** | medium |
| **Limitation** | Page last updated **2023-05-08 UTC** — materially older than the rest of the Android corpus. It publishes no safe-area/overscan margin in dp and no minimum text size; those are an **unresolved evidence gap** (G-06). Treat the density guidance as direction, not measurement. |

### P-12 — Predictive back

| Field | Value |
| --- | --- |
| **Source title** | Add support for the predictive back gesture |
| **URL** | https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture |
| **Publisher** | Google (Android Developers) |
| **Access date** | 2026-08-09 |
| **Platform** | Android phone/tablet (and TV back behaviour by extension) |
| **Supports** | Phone/tablet shell back model; M1 shell acceptance gate |
| **Observation** | Opt-in attribute is `android:enableOnBackInvokedCallback` on `<application>` or `<activity>`. From **Android 15**, system animations appear automatically for opted-in apps and the developer option for predictive back animations is no longer available. Recommended implementation is `OnBackPressedCallback` (AndroidX Activity 1.6.0-alpha05+), or the platform `OnBackInvokedCallback`; in Compose, `PredictiveBackHandler` (progress-aware) or `BackHandler` (simple interception). On Android 16+, `OnBackInvokedCallback` with `PRIORITY_SYSTEM_NAVIGATION_OBSERVER` observes back without consuming it. |
| **Class** | `normative platform rule` |
| **Confidence** | high |
| **Limitation** | Page last updated **2026-08-07 UTC**. Names APIs; naming an API is not selecting a dependency, and M0 selects none. |

### P-13 — Android 16 behaviour: predictive back on by default, edge-to-edge mandatory

| Field | Value |
| --- | --- |
| **Source title** | Behaviour changes: apps targeting Android 16 or higher |
| **URL** | https://developer.android.com/about/versions/16/behavior-changes-16 |
| **Publisher** | Google (Android Developers) |
| **Access date** | 2026-08-09 |
| **Platform** | Android phone/tablet |
| **Supports** | Phone/tablet shell; the coupling between P-01's target-API rule and shell work in M1 |
| **Observation** | "For apps targeting Android 16 (API level 36) or higher and running on an Android 16 or higher device, the predictive back system animations (back-to-home, cross-task, and cross-activity) are enabled by default. Additionally, `onBackPressed` is not called and `KeyEvent.KEYCODE_BACK` is not dispatched anymore." A temporary opt-out exists via `android:enableOnBackInvokedCallback="false"`. Separately: "For apps targeting Android 16 (API level 36), `R.attr#windowOptOutEdgeToEdgeEnforcement` is deprecated and disabled, and your app can't opt-out of going edge-to-edge." |
| **Class** | `normative platform rule` |
| **Confidence** | high |
| **Limitation** | Page last updated **2026-08-07 UTC**. This is why P-01's `targetSdk 36` is not a one-line build change: it changes back dispatch and window insets for the whole shell. |

### P-14 — Window size classes

| Field | Value |
| --- | --- |
| **Source title** | Use window size classes |
| **URL** | https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes |
| **Publisher** | Google (Android Developers) |
| **Access date** | 2026-08-09 |
| **Platform** | Android phone/tablet |
| **Supports** | The phone/tablet responsive boundary; the mapping onto RFC-0007's `compact`/`medium`/`expanded` profiles |
| **Observation** | Width: compact `< 600dp`; medium `600 ≤ w < 840dp`; expanded `840 ≤ w < 1200dp`; large `1200 ≤ w < 1600dp`; extra-large `≥ 1600dp`. Height: compact `< 480dp`; medium `480 ≤ h < 900dp`; expanded `≥ 900dp`. Computed in Compose via `currentWindowAdaptiveInfo(...).windowSizeClass`. |
| **Class** | `normative platform rule` (breakpoint definition), applied here as `platform convention` |
| **Confidence** | high |
| **Limitation** | Page last updated **2026-08-04 UTC**. The page also carries device-population percentages (for example "99.96% of phones in portrait" for compact width); those are **not** reproduced as market-share claims in the discovery document, because they describe how a breakpoint maps to form factors, not how many users run which Android version. |

### P-15 — Picture-in-picture

| Field | Value |
| --- | --- |
| **Source title** | Add videos using picture-in-picture (PiP) |
| **URL** | https://developer.android.com/develop/ui/views/picture-in-picture |
| **Publisher** | Google (Android Developers) |
| **Access date** | 2026-08-09 |
| **Platform** | Android phone/tablet; Android TV |
| **Supports** | Deferral of PiP out of the first vertical; minimum-API discussion |
| **Observation** | PiP was introduced in **Android 8.0 (API 26)**. Opt-in is `android:supportsPictureInPicture="true"` plus an appropriate `android:configChanges`. `setAutoEnterEnabled` requires **Android 12 (API 31)**. "PiP is also supported on compatible Android TV OS devices running **Android 14 (API level 34)** or later." |
| **Class** | `normative platform rule` |
| **Confidence** | high |
| **Limitation** | Page last updated **2026-08-07 UTC**. TV PiP availability is device-dependent ("compatible… devices"), which is precisely why it is not in the TV first vertical. |

### P-16 — Background playback and foreground service type

| Field | Value |
| --- | --- |
| **Source title** | Background playback with a MediaSessionService |
| **URL** | https://developer.android.com/media/media3/session/background-playback |
| **Publisher** | Google (Android Developers) |
| **Access date** | 2026-08-09 |
| **Platform** | Android phone/tablet (and the TV audio case in P-09 TV-NP) |
| **Supports** | Media-session responsibility in the module boundary; deferral of background playback from the first vertical |
| **Observation** | Background playback runs in a service extending `MediaSessionService`. The manifest must declare `android.permission.FOREGROUND_SERVICE` and `android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK`, and the service must declare `android:foregroundServiceType="mediaPlayback"`. The service publishes a `MediaNotification` automatically once the player has media items; it cannot be removed while the foreground service runs. The service leaves the foreground automatically after **10 minutes** of paused/stopped/failed state without user interaction. |
| **Class** | `normative platform rule` |
| **Confidence** | high |
| **Limitation** | Page last updated **2026-08-07 UTC**. Names a Jetpack library surface; M0 records the *responsibility* (an OS media-session integration, platform-owned per RFC-0006 §6), not a dependency selection. |

### P-17 — Passkeys require Digital Asset Links

| Field | Value |
| --- | --- |
| **Source title** | Credential Manager prerequisites |
| **URL** | https://developer.android.com/identity/credential-manager/prerequisites |
| **Publisher** | Google (Android Developers) |
| **Access date** | 2026-08-09 |
| **Platform** | Android phone/tablet |
| **Supports** | The commercial (Tesserafin-account) sign-in path; the M1 exclusion of authentication; owner question Q4 consequences |
| **Observation** | "Using Digital Asset Links is required for passkeys because they are often synced across devices and platforms." The `assetlinks.json` file is hosted at `https://domain[:optional_port]/.well-known/assetlinks.json`, must return HTTP 200 with `Content-Type: application/json`, and must carry the relations `delegate_permission/common.handle_all_urls` and `delegate_permission/common.get_login_creds`. The app declares `<meta-data android:name="asset_statements" android:resource="@string/asset_statements" />`. |
| **Class** | `normative platform rule` |
| **Confidence** | high |
| **Limitation** | Page last updated **2026-02-26 UTC**. It does **not** state a minimum API level for Credential Manager; that is gap G-05. The consequence recorded in the discovery document is structural: passkeys on Android bind the app's signing certificate to a **web domain Tesserafin controls**, so RFC-0008 §5.4's passkey-first launch identity has a hosting prerequisite on `tesserafin.org` that no client work can substitute for. |

### P-18 — Play App Signing

| Field | Value |
| --- | --- |
| **Source title** | Use Play App Signing |
| **URL** | https://support.google.com/googleplay/android-developer/answer/9842756 |
| **Publisher** | Google (Play Console Help) |
| **Access date** | 2026-08-09 |
| **Platform** | Android phone/tablet, Android TV |
| **Supports** | Package-signing authority (RFC-0008 §4.3); owner question Q4; M1 release/debug boundary |
| **Observation** | New apps are automatically enrolled: "Your app will be automatically enrolled in quantum-ready, hybrid signing with Google-generated keys." Google holds the **app signing key**, used to "sign the final APKs delivered to users' devices". The developer holds the **upload key** — "Stored in a Java keystore (`.jks` or `.keystore`). Must be an RSA key of 2048 bits or more." |
| **Class** | `normative platform rule` |
| **Confidence** | medium |
| **Limitation** | No page-published update stamp. The page describes automatic enrolment for new apps but this register did not find an explicit sentence making Play App Signing *mandatory*; the discovery document therefore states "new apps are automatically enrolled", not "it is required". |

### P-19 — Play testing tracks

| Field | Value |
| --- | --- |
| **Source title** | Prepare and roll out a release / testing tracks |
| **URL** | https://support.google.com/googleplay/android-developer/answer/9845334 |
| **Publisher** | Google (Play Console Help) |
| **Access date** | 2026-08-09 |
| **Platform** | Android phone/tablet, Android TV |
| **Supports** | Release-channel topology; owner question Q4; hardware matrix (what can be tested before public release) |
| **Observation** | Four tracks: internal, closed, open, production. Internal testing distributes "to up to 100 testers for initial quality assurance checks", "up to 100 testers per app". For **personal accounts created after 13 November 2023**, developers "must meet specific testing requirements before they can make their app available on Google Play". |
| **Class** | `normative platform rule` |
| **Confidence** | medium |
| **Limitation** | No page-published update stamp, and the page defers the *content* of the closed-testing requirement to a further help article this iteration did not read. Whether that requirement binds Tesserafin depends on the account-ownership answer to Q4 (personal versus organisation account), which is an owner decision. Recorded as partial: gap G-04. |

### P-20 — Play Console TV store-listing assets

| Field | Value |
| --- | --- |
| **Source title** | Add preview assets to showcase your app (Play Console Help) |
| **URL** | https://support.google.com/googleplay/android-developer/answer/9866151 |
| **Publisher** | Google (Play Console Help) |
| **Access date** | 2026-08-09 |
| **Platform** | Android TV |
| **Supports** | Store topology (Q1); pre-release checklist |
| **Observation** | "If you distribute an app to Android TV devices, you need to add at least one Android TV screenshot before you can publish your app." "A banner asset is required to publish an Android TV-enabled app", specified as JPEG or 24-bit PNG (no alpha), **1280 × 720 px**. "TV screenshots will only be displayed on Android TV devices." |
| **Class** | `normative platform rule` |
| **Confidence** | high |
| **Limitation** | No page-published update stamp. **This 1280 × 720 store-listing banner is a different artefact from P-08's 320 × 180 xhdpi in-app `android:banner` drawable.** Conflating them is an easy and visible mistake; both are recorded so the discovery document can keep them apart. The page does not describe a TV form-factor opt-in switch or a separate TV review — gap G-03. |

### P-21 — Android accessibility measurements

| Field | Value |
| --- | --- |
| **Source title** | Core app quality |
| **URL** | https://developer.android.com/docs/quality-guidelines/core-app-quality |
| **Publisher** | Google (Android Developers) |
| **Access date** | 2026-08-09 |
| **Platform** | Android phone/tablet, Android TV |
| **Supports** | Accessibility invariants inherited from RFC-0006 §5.3; M1 shell acceptance gate |
| **Observation** | `Touch_Target_Size`: minimum **48 dp**, consistent across display sizes and configurations. `Visual_Contrast`: **3:1** for large text and graphics, **4.5:1** for small text (under 18 pt, or under 14 pt bold). `Content_Description`: all UI elements except `TextView` carry `contentDescription`. Accessibility Scanner and Android Studio lint are named as verification tools. |
| **Class** | `normative platform rule` |
| **Confidence** | high |
| **Limitation** | Page last updated **2026-07-29 UTC**. The companion page https://developer.android.com/guide/topics/ui/accessibility/principles (accessed 2026-08-09, last updated 2026-07-21 UTC) states the qualitative principles — label elements, add accessibility actions, do not rely on colour alone — but publishes **no** numbers; the numbers above come only from Core app quality. Neither page states a text-scaling requirement; that is gap G-07. |

---

## B. Accepted Tesserafin decisions

These are inputs. M0 may not reopen them. Each row names the exact section a downstream claim rests
on, so a reviewer can check the citation rather than the paraphrase.

| ID | Source | Repository path | Observation | Class | Confidence | Limitation |
| --- | --- | --- | --- | --- | --- | --- |
| T-01 | RFC-0006 §1.3 | `docs/tesserafin/RFC-0006-native-client-foundation.md` | Tesserafin Web remains the desktop and browser reference client and is never a UI a native app embeds. | `accepted Tesserafin decision` | high | Accepted 2026-08-09. |
| T-02 | RFC-0006 §2.1 | same | Official native clients live in a **new repository, `tesserafin-mobile`**, "not created by this RFC". | `accepted Tesserafin decision` | high | The repository's *existence* is decided; its *creation* still needs maintainer approval (`#222` acceptance criterion 7). |
| T-03 | RFC-0006 §2.2 | same | Wave 1 = Android + Android TV; wave 2 = iOS + tvOS; wave 3 = webOS + Tizen; **no** native Windows/macOS/Linux client is planned. | `accepted Tesserafin decision` | high | — |
| T-04 | RFC-0006 §2.3 | same | KMP may be used for protocol, session and domain logic "only where it genuinely reduces duplication". Android/Android TV use native platform UI, "expected to be Compose-based" — with "expected" deliberate, the toolkit being the client repository's call at implementation time. | `accepted Tesserafin decision` | high | The word "expected" is load-bearing: M0 must not read it as a fixed toolkit decision. |
| T-05 | RFC-0006 §3, §3.2 | same | Three layers; layer 2 owns eleven cross-client semantics including server identity, session lifecycle, permissions, content packs and browsing preference, playback explanation, typed errors, pagination, cancellation and compatibility negotiation. Layer 1 is explicitly **not** the domain model (§8.3). | `accepted Tesserafin decision` | high | — |
| T-06 | RFC-0006 §4.1, §4.2, §4.3 | same | Seven existing contract controls are adopted for native clients; a client declares a minimum supported server and no hard maximum; unknown fields and unknown enum members are tolerated; a client that cannot establish compatibility **fails closed, visibly, with a named reason** distinguishable from "unreachable" and "session expired". | `accepted Tesserafin decision` | high | — |
| T-07 | RFC-0006 §4.5 | same | Wave 1 owes contract fixtures and a behavioural conformance suite, reusable by the second client. | `accepted Tesserafin decision` | high | Owed by the wave, not by M1. |
| T-08 | RFC-0006 §5.1, §5.2, §5.3 | same | RFC-0007's universal layer is the cross-client design contract; shared semantics explicitly do **not** mean pixel-identical rendering; accessibility invariants (WCAG 2.2 SC 1.4.3 / 1.4.11 as gated for Web) are inherited by every native renderer, and where platform and theme disagree the stricter wins. | `accepted Tesserafin decision` | high | — |
| T-09 | RFC-0006 §6 | same | Twelve responsibilities are permanently platform-owned: navigation, component implementation, accessibility APIs, lifecycle/background execution, secure credential storage, media sessions, casting, downloads/offline storage, share sheets, billing/store APIs, push, TV remote and focus behaviour. | `accepted Tesserafin decision` | high | This is the list that keeps M0 from inventing shared-layer requirements out of a competitor's feature list. |
| T-10 | RFC-0006 §7.1, §7.2, §8.5 | same | Self-hosted operation requires no Tesserafin account; media traffic stays between client and household server; nothing about a household's media reaches Tesserafin infrastructure by default; no master credential or licensing secret ships in a client; **media access is never coupled to the licensing control plane**. | `accepted Tesserafin decision` | high | — |
| T-11 | RFC-0006 §8.1 | same | Official WebView wrappers are **rejected**. | `accepted Tesserafin decision` | high | Directly relevant to X-01 below. |
| T-12 | RFC-0008 §3.1, §3.2 | `docs/tesserafin/RFC-0008-paid-client-distribution-and-entitlements.md` | An entitlement activates an official native application on a device and nothing else. It never gates a server API, Tesserafin Web, or media; losing it never corrupts local state or changes the private server; there is no tiering; essential capability is never behind it. | `accepted Tesserafin decision` | high | — |
| T-13 | RFC-0008 §3.3 | same | Without a valid entitlement the app **must** retain the activation surface, the recovery surface, account management including sign-out and deletion, and an honest explanation of state and fix; it must not crash, silently degrade, delete data or dead-end. | `accepted Tesserafin decision` | high | This is the anchor for most of the commercial state model. |
| T-14 | RFC-0008 §3.4, §4.3 | same | On a store with a first-party IAP mechanism, that store's purchase is the platform entitlement authority; the Tesserafin lease is device activation above it. Android: **free download, full unlock by a single non-consumable in-app purchase**, decided now because free→paid is irreversible. | `accepted Tesserafin decision` | high | Depends on P-02 remaining true; re-verified 2026-08-09. |
| T-15 | RFC-0008 §4.6, §4.6.1 | same | Per-store SKUs all grant one cross-platform `Tesserafin Official Apps` entitlement; no cross-store purchase *transfer* is promised; recognition is per-channel and conditional. | `accepted Tesserafin decision` | high | — |
| T-16 | RFC-0008 §5.1, §5.2, §5.3, §5.4 | same | The Tesserafin account is an identity/purchase/entitlement/device control plane, not a media cloud. Media plane and licence plane are never joined. Sign-in is OAuth 2.0 Authorization Code + PKCE `S256` in the **system browser**, public client, no client secret, no password field in the app. Launch identity is first-party only, passkey-first, magic link for recovery. | `accepted Tesserafin decision` | high | — |
| T-17 | RFC-0008 §7 | same | The lease is a short-lived, asymmetrically signed, device-key-bound, **non-bearer** statement; claims are minimal; algorithm is pinned by the verifier; clock rollback is handled by a monotonic high-water mark; activation requires connectivity, ordinary launch does not. | `accepted Tesserafin decision` | high | — |
| T-18 | RFC-0008 §8.3, §8.4, §8.5 | same | 30-day lease, silent renewal from day 15, 14-day recovery grace, maximum offline revocation delay **44 days**; accepted **conditionally** on the §11.1 sunset guarantee. Grace is explicitly signalled from its first day. Critical revocation reaches online devices only. | `accepted Tesserafin decision` | high | The conditionality is not decoration: §8.3 says the two must not be separated in implementation planning. |
| T-19 | RFC-0008 §9.1, §9.2, §9.3, §9.5, §9.6 | same | Seat / device / shared household device are distinct; devices are key pairs, never hardware fingerprints; self-service list, deactivate and rename; device limit offers a choice, never a dead end; individual = 1 seat / 5 devices; family = 2–6 seats × 3 devices + a 3-device household pool. | `accepted Tesserafin decision` | high | — |
| T-20 | RFC-0008 §10.1, §10.2 | same | Explicit allow/deny table for the account plane; the deny side is the shipped default; media inventory, playback history, server addresses and hardware identifiers are never received. | `accepted Tesserafin decision` | high | — |
| T-21 | RFC-0008 §11, §11.1 | same | A thirteen-row failure matrix, and the exit principle: a legitimately purchased client must not become permanently unusable because Tesserafin stopped operating the licensing service. Mechanism = final update + pre-signed perpetual sunset entitlement + published verifier and public keys + escrowed pre-signed certificate + 12 months' notice. The private signing key is never published. | `accepted Tesserafin decision` | high | Precondition of the first paid release. |
| T-22 | RFC-0008 §13, §15 | same | The RFC authorises no client code, no repository (including `tesserafin-mobile`), no dependency and no store integration. §15 requires §2's channel constraints to be **re-verified before any implementation issue derived from the RFC is opened**. | `accepted Tesserafin decision` | high | §15 is why P-02 – P-07 exist in this register at all. |

---

## C. Observed Tesserafin implementation

Everything in this section was read from the repositories at the baselines named at the top of this
file. Paths are given so a reviewer can open them.

**Path note.** Every server path below is quoted as it exists on `tesserafin` `origin/master`
(`1cca371c`), where the .NET assemblies carry the `Tesserafin.*` prefix. Pre-rename branches still
carry a `Reefin.*` prefix for the same files; those are **not** the paths cited here, and every path
in this section was re-checked against `origin/master` with `git cat-file -e` rather than against a
working checkout.

### I-01 — The committed server contract

| Field | Value |
| --- | --- |
| **Source** | `tesserafin` `openapi/contract.lock.json`, `openapi/openapi.json` @ `origin/master` `1cca371c` |
| **Observation** | `{ "algorithm": "sha256", "sha256": "c18438eef039007a81d928210a8a1ac95852c092a02f1075a8647981074c823d", "spec": "openapi/openapi.json", "version": "1.0.0" }`. The committed contract declares **307 paths**. |
| **Class** | `observed product behaviour` |
| **Confidence** | high |
| **Limitation** | The lock identifies a contract by the `(version, sha256)` pair, per RFC-0006 §4.1. A native generator consumes this same artefact; nothing in this register proposes a second contract. |

### I-02 — Household-server authentication surface

| Field | Value |
| --- | --- |
| **Source** | `openapi/openapi.json` @ `origin/master`: `/Users/AuthenticateByName` (POST), `/Users/AuthenticateWithQuickConnect` (POST), `/Sessions/Logout` (POST), `/Users/Me` (GET), `/Users/{userId}/Policy` (GET) |
| **Observation** | Username/password authentication and QuickConnect authentication are both unauthenticated POST operations. `/Sessions/Logout` and `/Users/Me` declare `CustomAuthentication: [DefaultAuthorization]`. Per-user policy is exposed at `/Users/{userId}/Policy`. |
| **Class** | `observed product behaviour` |
| **Confidence** | high |
| **Limitation** | Presence in the contract is not proof of runtime behaviour; the discovery document does not claim any response body it has not read. Session **revocation** semantics beyond `/Sessions/Logout` were not exercised in this iteration — gap G-08. |

### I-03 — QuickConnect exists, is enabled by default, and requires a second signed-in client

| Field | Value |
| --- | --- |
| **Source** | `openapi/openapi.json` @ `origin/master`: `/QuickConnect/Initiate` (POST), `/QuickConnect/Connect` (GET, `secret`), `/QuickConnect/Enabled` (GET), `/QuickConnect/Authorize` (POST, `code`, `userId`); `Tesserafin.Model/Configuration/ServerConfiguration.cs:83`; `Tesserafin.Server.Core/QuickConnect/QuickConnectManager.cs:59`; `Tesserafin.Api/Controllers/QuickConnectController.cs:45` |
| **Observation** | `public bool QuickConnectAvailable { get; set; } = true;` — **enabled by default**. `QuickConnectManager.IsEnabled => _config.Configuration.QuickConnectAvailable`. Decisively: **`/QuickConnect/Authorize` declares `security: [{ CustomAuthentication: [DefaultAuthorization] }]`** — authorising a pending code requires an already-authenticated session. `/QuickConnect/Initiate` and `/QuickConnect/Connect` do not. |
| **Class** | `observed product behaviour` |
| **Confidence** | high |
| **Limitation** | This settles the TV-pairing question in the *specific* form asked by Phase 5: a code-based pairing protocol **exists and is supported by the current server**, but it cannot be a household's *first* sign-in, because the authorising device must already be signed in. It also shows no QR-code surface at all. |

### I-04 — Server auto-discovery exists and is enabled by default

| Field | Value |
| --- | --- |
| **Source** | `src/Tesserafin.Networking/AutoDiscoveryHost.cs:25,55,67` (`PortNumber = 7359`, `if (!networkConfig.AutoDiscovery)`, `new UdpClient(new IPEndPoint(listenAddress, PortNumber))`); `Tesserafin.Common/Net/NetworkConfiguration.cs:108`; `Tesserafin.Model/ApiClient/ServerDiscoveryInfo.cs:26,31,36,41` — all read at `origin/master` `1cca371c` |
| **Observation** | `public bool AutoDiscovery { get; set; } = true;`. The host binds a `UdpClient` on `IPAddress.Any:7359` and responds to discovery messages. The response model `ServerDiscoveryInfo` carries `Address`, `Id`, `Name` and an optional `EndpointAddress`. |
| **Class** | `observed product behaviour` |
| **Confidence** | high |
| **Limitation** | This is a **UDP mechanism outside the OpenAPI contract**, so a generated transport layer cannot produce it — a native client must implement the datagram exchange by hand and keep it inside layer 2's "server discovery and connection identity" semantic (T-05). Reliability on real home networks (multicast/broadcast suppression, client isolation, VLANs) was not measured — gap G-09. |

### I-05 — Content packs and the cross-client browsing preference

| Field | Value |
| --- | --- |
| **Source** | `openapi/openapi.json` @ `origin/master`: `/ContentPacks`, `/ContentPacks/Order`, `/ContentPacks/{packId}`, `/ContentPacks/{packId}/Items`, `/ContentPacks/{packId}/Items/{itemId}`, `/Items/{itemId}/ContentPacks`; `tesserafin` `docs/content-pack-contract.md` §4.4.1 |
| **Observation** | §4.4.1: the media-family-first vs content-pack-first preference is "**per user**, not household-global", "**server-side**, never in browser storage, so Web, Android, Android TV, iOS and TV clients all observe the same choice", carried by `UserConfiguration.ContentPackBrowsingPreference` and "read and written through `GET /Users/Me` and `POST /Users/{userId}/Configuration`". It is "deliberately **not** a `DisplayPreferences` record". |
| **Class** | `observed product behaviour` |
| **Confidence** | high |
| **Limitation** | The contract carries the pack surface; whether a given household has packs seeded is a data question, not a contract question. A native client observing this preference is a **conformance assertion** (T-07), not a UI decision. |

### I-06 — Playback decision and diagnostics surface

| Field | Value |
| --- | --- |
| **Source** | `openapi/openapi.json` @ `origin/master`: `/Items/{itemId}/PlaybackInfo`, `/Playback/Sessions`, `/Playback/Sessions/{id}`, `/Playback/Sessions/{id}/Stream`, `/System/PlaybackDiagnostics/Metrics`, `/System/PlaybackDiagnostics/Sessions`, `/System/PlaybackDiagnostics/Sessions/{id}`, `/System/PlaybackDiagnostics/Sessions/{id}/Fixture`; RFC-0006 §3.2 |
| **Observation** | A playback-decision and diagnostics surface exists in the committed contract, including a per-session **fixture export** endpoint. RFC-0006 §3.2 records the honest state of the domain behind it: `DecisionVersion` is still the legacy value, the v2 engine "runs in shadow only and is disabled by default", and "on a default server the diagnostic fields are all `null` while the legacy-derived `Transforms` are best-effort and `SelectedStreams.Video` is always `null`." |
| **Class** | `observed product behaviour` |
| **Confidence** | medium |
| **Limitation** | The v2-engine default was taken from RFC-0006 §3.2's own statement, not re-measured against a running server in this iteration. A native client must be able to express *"absent because legacy"* versus *"absent because genuinely nothing"* (T-05); this register does not tell it which fields fall in which bucket on any particular server. Gap G-10. |

### I-07 — Generated-SDK provenance, and a live drift between the Web SDK pin and `master`

| Field | Value |
| --- | --- |
| **Source** | `tesserafin-web` `src/lib/tesserafin-sdk/spec/version.json`, `src/lib/tesserafin-sdk/versions.ts`, `scripts/generate-tesserafin-sdk.mjs` @ `main` `2da3ce4c`; `tesserafin` `ci/web-pair.lock.json`, `ci/verify-sdk-provenance.sh` @ `origin/master` `1cca371c` |
| **Observation** | The Web SDK pin records `version 1.0.0`, `xTesserafinVersion 1.0.0`, `pathCount 307`, `sourceCommit 1d0e91b77978cdbf69eef4117702383115e65826`, `specSha256 d234d2a8e7775cb8473ebfde4abf2c298478cc26bc827c136853b6d31b5e4030`, `generatedAt 2026-08-07T18:52:58.698Z`. `ci/web-pair.lock.json` pins `webCommit 1dbd24dc36ce6093216550bf1298c3e3425e14a2` with the comment that the value "is ALWAYS a full 40-character commit SHA — never a branch name, never a tag." `versions.ts` derives `MINIMUM_VERSION` from the pinned spec rather than from an upstream package. |
| **Class** | `observed product behaviour` |
| **Confidence** | high |
| **Limitation** | **The Web SDK's `specSha256` (`d234d2a8…`) does not equal the server's current `contract.lock.json` `sha256` (`c18438ee…`), and its `sourceCommit` (`1d0e91b7…`) is not `master`'s head (`1cca371c…`).** Both artefacts are internally consistent; they are pinned to different moments. That is normal and expected under the pairing model — and it is exactly the situation a native client will also be in. It is recorded here because it is *evidence that the provenance mechanism has real slack*, which the native provenance skeleton must represent rather than assume away. This register does **not** claim either pin is wrong. |

### I-08 — Theme and branding surface

| Field | Value |
| --- | --- |
| **Source** | `openapi/openapi.json` @ `origin/master`: `/Branding/Configuration`, `/Branding/Css`, `/Branding/Css.css`, `/Branding/Splashscreen`, `/System/Configuration/Branding`, `/DisplayPreferences/{displayPreferencesId}`; RFC-0006 §5.1 |
| **Observation** | The server's branding surface is CSS- and splashscreen-shaped. RFC-0006 §5.1 locates the cross-client design contract in RFC-0007's universal layer and `tesserafin-design/` schemas (eight token groups; profiles `pointer`, `touch`, `remote`, `compact`, `medium`, `expanded`, `reducedMotion`, `reducedTransparency`, `lowPower`), with `renderers.android`, `renderers.ios` and `renderers.tv` slots already reserved. |
| **Class** | `observed product behaviour` |
| **Confidence** | medium |
| **Limitation** | `/Branding/Css` is a **Web-shaped** surface: a native client cannot consume CSS. The native theme path therefore runs through generated serialisations of the `tesserafin-design` schema (RFC-0006 §5.1), not through this endpoint. No Compose renderer exists today, so this is a *stated boundary*, not an observed pipeline. |

### I-09 — Repository state at the start of this iteration

| Field | Value |
| --- | --- |
| **Source** | `gh` and `git`, 2026-08-09 |
| **Observation** | `tesserafin-web/main` = `2da3ce4c0b39718cb3602b50712d23d2c70f6f4f`; `tesserafin/master` = `1cca371cbaeef63a03e055eab158b8a51759f92f`. RFC-0006 and RFC-0008 are both present on `main` with `Status: Accepted (2026-08-09)`. `tesserafin#221` OPEN, `tesserafin#222` OPEN with zero comments and (before this iteration) no assignee. The organisation contains `tesserafin-web`, `tesserafin`, `tesserafin-website` and one security-advisory repository; **`tesserafin-mobile` does not exist**. Every open pull request in both repositories is authored by `app/dependabot`. No branch in `tesserafin-web` matches `m0/*` or otherwise claims this document scope. |
| **Class** | `observed product behaviour` |
| **Confidence** | high |
| **Limitation** | A point-in-time snapshot. |

---

## D. Reference products

Cohort A is media clients; cohort B is adjacent products contributing a specific flow. **No
screenshot from any product is reproduced in this repository.** Rows marked `unresolved evidence
gap` are named honestly rather than filled from recall.

### X-01 — Jellyfin Android (`org.jellyfin.mobile`) is a WebView wrapper

| Field | Value |
| --- | --- |
| **Source title** | `jellyfin/jellyfin-android` |
| **URL** | https://github.com/jellyfin/jellyfin-android |
| **Publisher** | Jellyfin Project |
| **Access date** | 2026-08-09 |
| **Platform** | Android phone/tablet |
| **Flow supported** | First launch; home and navigation; the packaging question in Q1 |
| **Observation** | Application ID `org.jellyfin.mobile`. The README describes it as a client that "connects to Jellyfin instances and integrates with the official web client", and states "Even though the client is only a web wrapper there are still lots of improvements and bug fixes that can be accomplished." Distributed on Google Play, Amazon Appstore and F-Droid, in a proprietary variant with Chromecast support and a libre variant without. |
| **Class** | `must-not-copy pattern` |
| **Confidence** | high |
| **Limitation** | Declared `minSdk`/`targetSdk` were not visible on the repository landing page. The *rejection* is not a judgement of Jellyfin — it is RFC-0006 §8.1 (T-11), already decided, and this row is the concrete instance of the pattern that decision excludes. |

### X-02 — Jellyfin ships phone and TV as two separate applications

| Field | Value |
| --- | --- |
| **Source title** | `jellyfin/jellyfin-androidtv` |
| **URL** | https://github.com/jellyfin/jellyfin-androidtv |
| **Publisher** | Jellyfin Project |
| **Access date** | 2026-08-09 |
| **Platform** | Android TV |
| **Flow supported** | Store topology (Q1); TV shell |
| **Observation** | Application ID `org.jellyfin.androidtv`, described as "a Jellyfin client for Android TV, Nvidia Shield, and Amazon Fire TV devices", distributed on Google Play and F-Droid. It is a **different package from `org.jellyfin.mobile`** (X-01) and a separate repository. |
| **Class** | `product-specific convention` |
| **Confidence** | high |
| **Limitation** | The README excerpt read did not cover server connection, QuickConnect sign-in or the leanback UI, and `minSdk`/`targetSdk` were not visible. Two packages is a valid shape — but note the asymmetry with X-01: Jellyfin's phone client is a web wrapper and its TV client is not, which is a strong reason for *them* to be separate codebases and a weak reason for Tesserafin, whose phone and TV clients are both native by decision (T-04). |

### X-03 — Quick Connect: a code-based sign-in that presupposes an existing session

| Field | Value |
| --- | --- |
| **Source title** | Quick Connect (Jellyfin server documentation) |
| **URL** | https://jellyfin.org/docs/general/server/quick-connect/ |
| **Publisher** | Jellyfin Project |
| **Access date** | 2026-08-09 |
| **Platform** | Android TV (and any low-text-entry device) |
| **Flow supported** | TV sign-in/pairing |
| **Observation** | The new device selects Quick Connect on its login screen and displays a **6-character code**, which stays visible. An **already-authenticated** client authorises it under Settings → Quick Connect by entering the code; the new device is then "logged in automatically—no need to enter a username or password". "By default, Quick Connect is enabled", and an administrator can disable it. |
| **Class** | `reusable interaction principle` (with a named limit) |
| **Confidence** | high |
| **Limitation** | Documents the upstream project's behaviour; it corroborates I-03, which is the authoritative reading for Tesserafin because it was taken from Tesserafin's own committed contract and configuration defaults. The limit is the point: a household whose *first* Tesserafin client is the television cannot use this flow. |

### X-04 — YouTube: TV code entered on a phone

| Field | Value |
| --- | --- |
| **Source title** | Watch YouTube on your TV — link with a TV code |
| **URL** | https://support.google.com/youtube/answer/3230451 |
| **Publisher** | Google |
| **Access date** | 2026-08-09 |
| **Platform** | TV |
| **Flow supported** | TV pairing |
| **Observation** | The TV displays a numeric "blue TV code" under Settings → *Link with TV code*; the user enters it in the phone app under Cast → *Link with TV code* → LINK. A separate pairing method requires being "signed in with the same Google account on your TV and your phone or tablet"; the TV-code method is documented as working when the devices are not on the same Wi-Fi. |
| **Class** | `platform convention` |
| **Confidence** | medium |
| **Limitation** | This is a *control-handoff* pairing, not an account sign-in, and the underlying identity is a Google account — a cloud service, which Tesserafin's media plane is not (T-10). The transferable part is the direction of code entry: the constrained device **displays**, the capable device **types**. |

### X-05 — Spotify Connect: same-network first contact, explicit device pick

| Field | Value |
| --- | --- |
| **Source title** | Spotify Connect |
| **URL** | https://support.spotify.com/us/article/spotify-connect/ |
| **Publisher** | Spotify |
| **Access date** | 2026-08-09 |
| **Platform** | Phone/tablet, TV, speakers |
| **Flow supported** | Device discovery and handoff |
| **Observation** | "With Spotify Connect, you can use one device to remotely control listening on another." "When connecting to the speaker for the first time, all devices need to be on the same WiFi." Users then "Pick the device you want to play on". A *Local device visibility* setting exists in the mobile app under Settings → Apps and devices; switching it off "lets the app see devices that aren't currently on your WiFi network." |
| **Class** | `reusable interaction principle` |
| **Confidence** | medium |
| **Limitation** | Audio-first and cloud-account-based; the transferable principle is narrow — *same-network first contact is an acceptable onboarding constraint, and discovery results are presented as an explicit user choice rather than an automatic connection*. Session handoff itself is deferred (RFC-0006 §3.2 owns the semantic; M0 does not put it in the first vertical). |

### X-06 — Home Assistant: per-device refresh tokens, revocable by the user

| Field | Value |
| --- | --- |
| **Source title** | Authentication (Home Assistant documentation) |
| **URL** | https://www.home-assistant.io/docs/authentication/ |
| **Publisher** | Home Assistant / Open Home Foundation |
| **Access date** | 2026-08-09 |
| **Platform** | Phone/tablet, self-hosted server |
| **Flow supported** | Session lifecycle; device management against a *household* server |
| **Observation** | "A refresh token is created each time you sign in from a device. Delete one to force that device to sign out." "Unused refresh tokens are automatically removed. A refresh token is considered unused if it has not been used to sign in within 90 days." Long-lived access tokens exist separately for scripts and integrations. |
| **Class** | `reusable interaction principle` |
| **Confidence** | medium |
| **Limitation** | The page does not describe initial client connection (discovery versus manual URL). The transferable principle is the **one-session-per-device, individually revocable** model, and — importantly — that this device management is a property of the **household server**, entirely distinct from RFC-0008 §9's Tesserafin-account device list. Tesserafin will have *both*, and conflating them in the UI would be a serious product error. |

### X-07 — Immich: type your own server URL

| Field | Value |
| --- | --- |
| **Source title** | Mobile app (Immich documentation) |
| **URL** | https://docs.immich.app/features/mobile-app |
| **Publisher** | Immich |
| **Access date** | 2026-08-09 |
| **Platform** | Phone/tablet, self-hosted server |
| **Flow supported** | Server connection |
| **Observation** | "Login to the mobile app with the server endpoint URL at `http://<machine-ip-address>:2283`". Server URL is entered manually; the documentation read describes no discovery mechanism. |
| **Class** | `product-specific convention` |
| **Confidence** | medium |
| **Limitation** | Establishes that a manual-URL-only first run is a shipped, accepted pattern in the self-hosted category — it does **not** establish that it is a good one. Tesserafin has I-04 (discovery on by default), so manual entry is the *fallback*, not the primary path. |

### X-08 – X-17 — Reference products named but not evidenced in this iteration

| ID | Product | Cohort | Flow it was to inform | Status |
| --- | --- | --- | --- | --- |
| X-08 | Plex | media client | TV pairing (`plex.tv/link` code), account requirement for a self-hosted server | `unresolved evidence gap` — https://support.plex.tv/articles/200288586-installation/ and two further support articles returned **HTTP 403** to an automated fetch on 2026-08-09 |
| X-09 | Emby | media client | Local discovery, manual server entry, optional Emby Connect account | `unresolved evidence gap` — https://emby.media/support/articles/Connect-Sign-In.html returned **HTTP 404** on 2026-08-09 |
| X-10 | Kodi | media client | D-pad/remote core key set; all-UI-reachable-by-direction | `unresolved evidence gap` — https://kodi.wiki/view/Remote_controls and https://kodi.wiki/view/Keyboard_controls returned **HTTP 403** on 2026-08-09 |
| X-11 | Netflix | media client | TV sign-in by code | `unresolved evidence gap` — https://help.netflix.com/en/node/2069 served an unrelated browser-support article on 2026-08-09 |
| X-12 | Apple TV (tvOS) | media client | Sign-in via a nearby iPhone, avoiding remote text entry | `unresolved evidence gap` — https://support.apple.com/en-us/102281 returned truncated, unrelated content on 2026-08-09 |
| X-13 | Google TV | media client | Home/launcher integration, channel rows | `unresolved evidence gap` — not fetched this iteration |
| X-14 | Infuse | media client | Server connection to a self-hosted library | `unresolved evidence gap` — not fetched this iteration |
| X-15 | Disney+ | media client | Onboarding, purchase/restore | `unresolved evidence gap` — not fetched this iteration |
| X-16 | Prime Video | media client | TV navigation density | `unresolved evidence gap` — not fetched this iteration |
| X-17 | A password/passkey manager (for example Bitwarden or 1Password) | adjacent | Passkey creation and account recovery UX | `unresolved evidence gap` — not fetched this iteration |

**Corpus size.** Seventeen products are named; **seven** (X-01 – X-07) carry a first-party citation
read on 2026-08-09, and **ten** are recorded as gaps. This is deliberately reported as it is rather
than padded: a recommendation in the discovery document is supported only where a cited row exists,
and the TV-pairing recommendation rests on I-03 — Tesserafin's own contract — not on any of the
missing rows.

---

## E. AppLlama

### A-01 — Identity and corpus

| Field | Value |
| --- | --- |
| **Source title** | Appllama — UI & UX design inspiration from top-earning iOS apps |
| **URL** | https://appllama.io/ |
| **Publisher** | Appllama (operated by Antmind Ventures Private Limited, per the site's own launch material) |
| **Access date** | 2026-08-09 |
| **Platform** | **iOS only** |
| **Flow supported** | The AppLlama research gate |
| **Observation** | The site describes itself as a library of "28,600+ screens from 700+ top-earning iOS apps", updated weekly, organised into navigable flows (onboarding, paywall, home, in-app), across categories including Health & Fitness, Lifestyle, Education and Productivity. It advertises a free tier and a paid **Pro** tier ("Get everything with Pro"); the exact free/Pro feature split is not published on the pages read. |
| **Class** | `observed product behaviour` |
| **Confidence** | medium |
| **Limitation** | Read from public marketing pages without signing in. **Note the domain**: `appllama.com` (accessed 2026-08-09) is an unrelated "Coming Soon" placeholder; the product is at `appllama.io`. Any capture sheet must use the `.io` domain. The corpus being iOS-only is decisive for the Pro decision. |

### A-02 — Terms of use permit the proposed research and forbid the shortcuts

| Field | Value |
| --- | --- |
| **Source title** | Terms — Appllama |
| **URL** | https://appllama.io/terms |
| **Publisher** | Appllama |
| **Access date** | 2026-08-09 |
| **Flow supported** | The AppLlama research gate; the "terms would prohibit the proposed use" hard stop |
| **Observation** | Users receive a "limited, non-exclusive, non-transferable and revocable licence to access the library for research, analysis, reference and design inspiration", and may "reference individual screens in presentations, teaching material and commentary, provided the app they came from is credited." Prohibited: to "export, mirror, cache or archive the library or any substantial part of it", bulk retrieval by automated means, and to "republish, resell, syndicate or otherwise redistribute content from the library". On third-party rights: "The apps shown in the library are the work of their respective owners. Their trademarks, logos, screens and copyrights remain with them." |
| **Class** | `normative platform rule` (a contractual rule, not a technical one) |
| **Confidence** | high |
| **Limitation** | Read as a public page, not as an executed agreement. **The hard stop does not fire**: the proposed use — a human reading screens and writing crediting, non-reproducing observations — is inside the granted licence, and every prohibited act (scraping, bulk export, redistribution) is already on this loop's fixed-boundary list. |

### A-03 — Copyright policy

| Field | Value |
| --- | --- |
| **Source title** | Copyright — Appllama |
| **URL** | https://appllama.io/copyright |
| **Publisher** | Appllama |
| **Access date** | 2026-08-09 |
| **Flow supported** | The prohibition on committing captured screens |
| **Observation** | "All copyrights, trademarks, logos, names and designs in that material remain the property of their respective owners." The material exists "for reference, commentary, education and analysis". "Reproduction of the compilation, in whole or in substantial part, is not permitted." Explicitly prohibited: scraping, crawling, bulk downloading, using the library to train machine-learning models, and **circumventing tier limits**. |
| **Class** | `normative platform rule` |
| **Confidence** | high |
| **Limitation** | "Circumventing tier limits" is the clause that makes any automated route around a Pro wall a terms violation, independent of this loop's own boundary against it. It is also why the correct response to a sign-in wall is a **manual capture sheet for the maintainer**, not a workaround. |

### A-04 — Free-tier catalogue not inspected

| Field | Value |
| --- | --- |
| **Source** | — |
| **Observation** | No authenticated browser session was available to this iteration, and the loop's boundaries forbid requesting credentials or signing in as the maintainer. The free catalogue, the free/Pro screen split, and which named applications are present were therefore **not** inspected. |
| **Class** | `unresolved evidence gap` |
| **Confidence** | high (that the gap exists) |
| **Limitation** | Closed by the maintainer capture sheet in the discovery document §12, not by any agent action. Per `#222`, a sign-in wall alone is not a whole-loop hard stop. |

---

## F. Unresolved evidence gaps

| ID | Gap | Why it matters | How it closes |
| --- | --- | --- | --- |
| G-01 | **Android version distribution / real ecosystem reach.** No first-party, citable, dated source for the share of active devices per API level was obtained. | A `minSdk` recommendation that quotes a reach percentage without a source would be an invented number. | Read the distribution figures in Android Studio's *New Project* dialog (first-party, dated) on the maintainer's machine, or the Play Console's *Reach and devices* data, or an official Google post carrying a date, and record it as a row here. **Still open.** M1 fixes `minSdk` at 26 by owner decision (discovery §14 Q3) **without** this gap being closed; the decision is argued from capability, maintenance cost and the cost asymmetry of raising versus lowering a floor. Re-evaluation is mandatory **before M3 implementation and again before the first public release**. |
| G-02 | **Android TV OS version floor in the field.** Which Android TV / Google TV OS versions are actually present on shipping devices. | Sets the realistic TV `minSdk`, and interacts with P-15 (TV PiP needs API 34+). | Same route as G-01, plus real-device evidence — cloud real-device evaluation at M4 and the physical release gate (discovery §10.3, §10.4). **Still open.** The owner set one conservative floor (`minSdk 26`) for both form factors rather than asserting a TV-specific one; re-measured with G-01 before M3 and before first public release. |
| G-03 | **Play Console TV form-factor mechanics.** Whether TV distribution is an opt-in toggle on one app entry, and whether a TV build is reviewed separately. | Directly decides Q1 (one listing or two) beyond the manifest evidence in P-08. | Read the Play Console form-factor help page, or observe the Console itself once a developer account exists (Q4). **Still open.** Q1 was decided in favour of one listing with this gap named; it is retained as a **pre-store-registration gate** and does not block a single-package M1 architecture. |
| G-04 | **Closed-testing requirement for personal Play accounts.** P-19 states the requirement exists for personal accounts created after 13 November 2023 but defers its content. | Changes the release-channel plan and the time-to-first-public-release if the account is personal. | Read the linked Play Console help article; answer depends on Q4. |
| G-05 | **Credential Manager minimum API level.** P-17 did not state one. | Interacts with the `minSdk` recommendation *only* for the Tesserafin-account path, which is not in the first vertical. | Read the Credential Manager overview/implementation guides before the account milestone, not before M1. |
| G-06 | **TV safe-area/overscan margins and minimum text size in dp.** P-11 publishes neither. | Needed before any TV layout is built; not needed for an empty TV shell. | Read the Android TV layout guide; defer to the milestone that builds TV screens. |
| G-07 | **Android text-scaling requirement.** Neither P-21 nor the accessibility principles page states one. | RFC-0006 §5.3 makes accessibility an invariant; text scaling is part of it. | Read the Android accessibility testing guidance before the shell's accessibility gate is written. |
| G-08 | **Server-side session revocation semantics.** Beyond `/Sessions/Logout` (I-02), how an administrator revokes another device's session and what the client observes was not established. | RFC-0006 §3.2 makes "what a client must do when a session becomes invalid mid-use" a layer-2 semantic, and `#221`'s wave gate 2 requires revocation to be observable. | Exercise a running server; belongs to the milestone that implements session handling, not to M0. |
| G-09 | **Auto-discovery reliability on real home networks.** I-04 shows the mechanism exists and defaults on; it does not show it works through client isolation, VLANs or broadcast suppression. | Decides whether "discover a server" can be the *primary* first-run path or must be presented alongside manual entry. | Measure on the maintainer's own network during the first vertical. The discovery document does not assume discovery succeeds. |
| G-10 | **Which playback-diagnostic fields are populated on a default server.** I-06 records RFC-0006's statement that they are `null` by default; it was not re-measured. | Decides how much of the Direct Play / remux / transcode explanation the first vertical can honestly show. | Query `/Items/{itemId}/PlaybackInfo` and `/System/PlaybackDiagnostics/Sessions/{id}` against a running server before the playback-explanation work. **Still open, deferred to M3** — the first milestone at which a real server and a real playback request both exist. |
| G-11 | **AppLlama free-tier catalogue.** See A-04. | The Pro decision. | The maintainer capture sheet. **Still open, deferred to the visual-design milestone** (owner decision Q8: `DEFER PRO UNTIL VISUAL DESIGN`). It was **not** inspected, and no sign-in, purchase or subscription is authorised. |
| G-12 | **Ten reference products (X-08 – X-17).** | Breadth of the flow study. | Manual inspection, or first-party documentation fetched from a session that is not blocked by bot protection. |
| G-13 | **Runtime availability floor of `KeyInfo.getSecurityLevel()`.** P-07 conditions its use on the app *targeting* API 29 or higher, and does not state the API level at which the method exists on a device. | It is quoted in owner question Q3 as part of the `minSdk` argument. Because `targetSdk 36` already satisfies "targets API 29+", this source does **not** by itself justify `minSdk 29` over `minSdk 26`; the Q3 recommendation is therefore argued from maintenance cost, and this gap is named so the argument is not read as stronger than it is. | Read the `KeyInfo` API reference for the added-in level. **Still open.** M1 fixes `minSdk 26` without it; the owner explicitly judged the API-29 security argument insufficient for exactly the reason this gap records. |

### F.1 Disposition at acceptance (2026-08-09)

**Thirteen gaps were named. Thirteen remain open.** Acceptance of the discovery packet resolved
decisions, not evidence. This table records only *who must close each gap and when* — a decision taken
around a gap is never recorded as the gap being closed, and no optional research is claimed as
performed.

| Gap | Disposition | Owning milestone |
| --- | --- | --- |
| G-01, G-02, G-13 | Future compatibility measurement. `minSdk 26` was chosen conservatively **because** the data is missing, so the gap no longer blocks M1 | Before **M3** implementation, and again before **first public release** |
| G-03 | Pre-store-registration verification. Does not block a single-package M1 architecture | Before any **store resource** is registered (needs Q4) |
| G-04 | Depends on Q4's outcome | Before the first release track |
| G-05, G-06, G-07 | As recorded in the rows above | The milestones named there |
| G-08 | Server session-revocation semantics | The session-handling milestone |
| G-09 | Discovery on a real household LAN | **M3** |
| G-10 | Needs a real server **and** a real playback request | **M3** |
| G-11 | AppLlama free catalogue — **not inspected**, optional | The **visual-design** milestone |
| G-12 | Breadth of the reference-product study | Optional; no conclusion rests on it |

**Not an evidence gap, and recorded here so it is not mistaken for one:** the cloud real-device
providers named in discovery §10.3 (AWS Device Farm, Suitest, TestingBot, RobusTest) are a
**shortlist to be re-verified**, not observed capacity. Nothing was subscribed, trialled or
activated; the TestingBot conditions in §10.3 require **written** vendor confirmation precisely
because its published pages contradict each other. **No physical hardware is confirmed available to
this project**, and cloud availability does not change that fact.
