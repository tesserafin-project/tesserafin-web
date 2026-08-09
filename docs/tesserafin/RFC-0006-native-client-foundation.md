# RFC-0006 — Native-client foundation: shared contract, semantic layer and design primitives

- **Status**: Proposed (2026-08-09)
- **Date**: 2026-08-09
- **Author**: Tesserafin Project
- **Repository**: `tesserafin-web`
- **Issue**: [`tesserafin#99`](https://github.com/tesserafin-project/tesserafin/issues/99) (D1 —
  architecture only)
- **Relation**: builds on RFC-0001 §5 (native clients are separate codebases), RFC-0003 §9/§12
  (universal Web client plus administration centre; native clients in separate repositories over a
  shared API/SDK contract), RFC-0004 (no embedded-WebView target inside `tesserafin-web`),
  RFC-0005 §3 and §5 (unify the language, not the interface; the four-concept separation) and
  RFC-0007 (the universal / platform-renderer split, capability negotiation and the theme
  boundary). It does **not** supersede any of them.
- **Language note**: RFC-0007 moved this corpus to English and stated that the shift applies to that
  document *and its successors*. This RFC is a successor by publication date and is therefore in
  English, like the contracts it governs.
- **Number**: RFC-0007 §8.4 reserved `0006` for the native-client RFC "whenever it is published".
  This is that document, and it takes the reserved number. It is a **standalone** ADR: it makes its
  own decisions and cites only sources a reader can open in this repository or in
  `tesserafin-project/tesserafin`. See §1.4.

---

## 1. Purpose, status and method

### 1.1 What this RFC decides

Tesserafin intends to ship official native clients. Before any of them exists, three things have to
be settled, because getting them wrong is expensive to undo once four codebases depend on the
answer:

1. **What every official client shares** — the wire contract, and a semantic layer above it that
   owns the meanings no client may redefine.
2. **What no official client shares** — its user interface, its navigation, its platform
   integrations.
3. **What the shared design language is** — and, just as importantly, what it deliberately is not.

This RFC decides those three. It authorises **no implementation**: no SDK package, no generator, no
client repository, no application code, no licensing or account backend. Everything here is a
boundary, and every boundary is stated so that the first client implementation can be judged against
it rather than negotiating it again.

### 1.2 Decision status

**Proposed.** Acceptance is the maintainer's architectural review of the pull request that
introduces this document. Nothing in the repository changes behaviour when it is accepted; what
changes is that the first native-client implementation has a contract to conform to.

### 1.3 Web's place in this

**Tesserafin Web remains the desktop and browser reference client, and it is not a user interface
that native applications embed.**

This is a decision, not a description. RFC-0004 removed the last structural reason to treat the Web
bundle as a payload for a native shell: the webOS and Tizen firmware detection, the WinRT bridge and
the Orsay/Opera TV/Edge UWP branches are gone, and what remains of "TV" in this repository is the
generic ten-foot UX — `layoutManager.tv`, focus visibility, gamepad-to-key mapping — which is a Web
concern for Web users on a Web browser. A native client does not import any of it.

The consequence for scope is exact: `tesserafin-web` continues to be developed as the browser
product on desktop, mobile browsers and PWA, and nothing in this RFC creates an obligation for it to
become portable, embeddable or headless.

### 1.4 Sources, and one thing deliberately not used

Every claim in this RFC is traceable to a document or artefact in one of the two repositories:

| Source | What it supplies here |
| --- | --- |
| RFC-0001 §5, §6 | native clients are separate codebases; the target Web architecture |
| RFC-0003 §9, §12 | universal client + administration centre; shared API/SDK contract across separate repositories; explicit anti-goals |
| RFC-0004 | platform scope, the removal of embedded-TV targets, the generic-TV-UX commitment |
| RFC-0005 §3, §3.1, §3.2, §5, §6 | "unify the language, not the interface"; the unify/native table; the shared design socle; the four-concept separation |
| RFC-0007 §3, §4, §5, §6 | universal layer vs platform renderer layer; token and profile vocabulary; closed capability negotiation with required/optional fallback; the permanent theme boundary |
| `docs/tesserafin/presentation-boundary.md` | composition is a renderer concern, not a server capability |
| `tesserafin-design/` (`schema/tokens.schema.json`, `schema/theme.schema.json`, `README.md`) | the actual token groups and profile names, and the generator that already emits per-platform output |
| `src/lib/tesserafin-sdk/README.md`, `scripts/generate-tesserafin-sdk.mjs` | how a generated client is produced, pinned and verified today |
| `tesserafin/docs/openapi-contract.md`, `openapi/openapi.json`, `openapi/contract.lock.json` | the canonical contract, its `(version, sha256)` identity and its compatibility gate |
| `tesserafin/docs/versioning-policy.md` | the `1.0.0` public epoch and the rules for resolving a release |
| `tesserafin/docs/content-pack-contract.md` §3.8, §4.4.1 | the server/client ownership line, and the first genuinely cross-client product preference |
| `docs/tesserafin/design-web-playback-diagnostics.md` §2 | the real shape of the playback decision domain and what is not yet true of it |
| `tesserafin#146` | the core / official-module / plugin / theme / hosted-service classification |

**One source is deliberately not used.** `tesserafin#99`'s 2026-08-02 comment established that the
often-cited "RFC-0006 native-client strategy" exists only as an untracked local draft in a stale
checkout, under pre-rename paths and identifiers, and has never been committed or pushed to any
branch of any repository in the organisation. The owner's ruling on that issue is to write this ADR
standalone rather than publish someone's unpublished draft on their behalf. That ruling is followed
literally: the draft was not read as authority, no sentence of it is reproduced or translated here,
and nothing in this document depends on it. Where this RFC reaches a conclusion the roadmap already
attributes to that draft — a separate client repository, Kotlin Multiplatform for shared logic, no
WebView wrapper — it reaches it **as a decision of this RFC**, from the published sources in the
table above, and it is answerable as such.

---

## 2. Repository and platform direction

### 2.1 The client repository

Official native clients live in a **new repository, `tesserafin-mobile`**, and not in
`tesserafin-web` or `tesserafin`.

The reason is the one RFC-0003 §9 already gives for the Web rewrite and RFC-0004 §1 gives for
platform scope: a repository's toolchain, review surface and CI budget are shaped by what it builds.
`tesserafin-web` builds a browser bundle and is gated on `verify:bundle-budget`, Biome, Stylelint,
Vitest and Playwright; `tesserafin` builds a .NET server and is gated on `ci/run.sh`, the OpenAPI
drift check and oasdiff. Neither gate says anything useful about a Gradle/Xcode build, and adding
one to either repository would make every unrelated change pay for it.

`tesserafin-mobile` is **not created by this RFC.** It is named so that the first implementation
issue has an unambiguous target.

Whether webOS and Tizen eventually share `tesserafin-mobile` or get a repository of their own is
**deferred to the point at which either is scheduled**. Deciding it now would be deciding it without
knowing what those clients build with.

### 2.2 Platform order

| Wave | Platforms | Status here |
| --- | --- | --- |
| 1 | **Android and Android TV** | first implementation vertical; not implemented by this RFC |
| 2 | **iOS and tvOS** | follows wave 1 |
| 3 | **webOS and Tizen** | remain official targets, later |
| — | **Windows, macOS, Linux** | **no native client is planned**; the official desktop experience is the self-hosted server plus Tesserafin Web |

Android first is not a popularity argument. It is the wave that exercises the most of this
foundation at once: a phone and a ten-foot remote-driven surface from one shared logic layer, which
is precisely the case where a shared semantic layer either earns its existence or does not. If the
Android/Android TV pair cannot be built on §3 and §5 without either client having to reach around
them, that is a defect in this RFC and it will show up in wave 1 rather than in wave 3.

The desktop row is a **standing decision**, not an omission. It is stated here so that "the SDK
exists, therefore a desktop client is cheap" never becomes an implicit argument.

### 2.3 Implementation technology

- **Kotlin Multiplatform may be used to share protocol, session and domain logic** between Android
  and the Apple platforms, and it should be used **only where it genuinely reduces duplication**.
  Sharing a state machine that both platforms would otherwise write twice is a reduction; sharing a
  thin wrapper around one platform's own API is not.
- **Android and Android TV use native platform UI, expected to be Compose-based.** "Expected"
  is deliberate: the UI toolkit is the client repository's decision at implementation time, and this
  RFC does not need it to be settled to draw its boundaries. What this RFC does settle is that the
  UI is native and platform-owned.
- **iOS and tvOS retain SwiftUI or the platform-native UI of the day**, on the same terms.
- **There is no cross-platform shared UI-component requirement, now or later.** RFC-0005 §3 already
  ruled this for themes — "unify the language, not the interface", with React, Compose and SwiftUI
  named as independent native implementations of the same *concepts*. This RFC extends that ruling
  from the theme contract to the whole client architecture.

None of this is implemented in the pull request that introduces this document.

---

## 3. The three contract layers

This is the core of the RFC. Everything else follows from getting this split right.

```
┌─ LAYER 1 · WIRE / PROTOCOL ──────────────────────────────────────────────┐
│  Generated from openapi/openapi.json. Owned by the generator, never      │
│  hand-edited. Shape follows the server's serialization, not the product. │
└──────────────────────────────────────────────────────────────────────────┘
                                   │
┌─ LAYER 2 · SEMANTIC CLIENT ──────────────────────────────────────────────┐
│  Hand-owned, small, versioned separately. Owns the meanings every        │
│  official client must agree on. Consumes layer 1; exposes no layer-1     │
│  type it has not deliberately chosen to expose.                          │
└──────────────────────────────────────────────────────────────────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
┌────────────────┐      ┌────────────────────┐      ┌────────────────────┐
│ Web renderer   │      │ Android / TV       │      │ Apple              │
│ (implemented)  │      │ (wave 1)           │      │ (wave 2)           │
└────────────────┘      └────────────────────┘      └────────────────────┘
   LAYER 3 · PER-PLATFORM PRESENTATION AND INTEGRATION
```

The shape is intentionally the same one RFC-0007 §3 uses for themes. That is not aesthetic
symmetry: a client that resolves its presentation through one two-layer split and its data through
an unrelated one has two competing ideas of what "platform-specific" means, and the seams end up in
different places.

### 3.1 Layer 1 — the wire protocol

Layer 1 is **generated, committed and never hand-written**. `docs/openapi-contract.md` §6 already
states the permanent rule — *"tout ce qu'OpenAPI peut générer doit être généré"*, and no hand-written
wrapper may duplicate an operation the contract already carries. This RFC adopts that rule verbatim
for every official client.

What already exists proves the mechanism rather than merely proposing it:
`src/lib/tesserafin-sdk/generated/` is `openapi-generator-cli` output from a pinned spec, committed
so that every regeneration is a reviewable diff, with `spec/openapi.json` and `spec/version.json`
alongside it and `npm run verify:tesserafin-sdk-fresh` failing on any drift. A native generator is a
different template against the same contract, not a different contract.

**Layer 1 is not the application's domain model.** This is the single most important negative
statement in this RFC, and §8.3 records it as a rejected alternative rather than leaving it as
advice. The generated surface is shaped by Swashbuckle's schema reflection and by the generator
template — it is why `scripts/generate-tesserafin-sdk.mjs` has to unwrap single-property ID wrapper
schemas so a strongly-typed server-side identifier does not arrive as an object that interpolates
into a URL as `[object Object]`, and why it has to drop redundant inline `enum` arrays that the
template cannot parse. Those are facts about a toolchain. A client that lets them become facts about
its domain has adopted an accident as an architecture.

### 3.2 Layer 2 — the semantic client

Layer 2 is **hand-owned, deliberately small, and the only layer whose meanings are binding on every
official client**. It exists to answer one question: *what must two official clients agree about,
such that a household using both does not experience two different products?*

The semantics below need stable cross-client ownership. Each row states the meaning that is owned,
not an API shape — the shape is layer 1's and may change with the contract.

| Semantic | What layer 2 owns |
| --- | --- |
| **Server discovery and connection identity** | what "a server" is to a client; how one is named, stored, re-found and distinguished from another; that a household may hold several |
| **Authentication and session lifecycle** | sign-in, the states a session can be in, expiry, renewal, sign-out, and what a client must do when a session becomes invalid mid-use |
| **Users and permissions** | that permission is the server's answer and never the client's; how a client asks; how a client renders "you may not" without inventing its own rule |
| **Libraries and media identity** | that an item's identity is server-owned and opaque; the distinction RFC-0007 and `content-pack-contract.md` both rely on between a *library*, a *collection*, a *content pack* and a *theme* |
| **Content packs and browsing preference** | the vocabulary of `docs/content-pack-contract.md` §3, and that `ContentPackBrowsingPreference` is a per-user, server-side, cross-client preference (§4.4.1) — every official client observes the same choice |
| **Playback planning, and the Direct Play / remux / transcode explanation** | the decision vocabulary and the *reason* a plan was chosen, as a first-class result rather than a log line |
| **Progress, queues and session handoff** | what "where I am in this" means; what a queue is; what it means to move a session between devices |
| **Typed errors** | a closed, inspectable failure vocabulary — a client branches on a type, never on a message string or a raw status code |
| **Pagination** | one way to express and continue a page, so two clients cannot disagree about what "the next page" is |
| **Cancellation** | that an abandoned request is cancellable, and that cancellation is not an error |
| **Compatibility negotiation** | §4 — how a client establishes that it can talk to this server at all |

Three of these deserve their reasoning stated, because they are where a client is most likely to
improvise.

**Playback explanation.** The server already carries a real decision domain:
`PlaybackRequestContext`, `ClientCapabilities` (split into decode and output profiles),
`MediaSourceSnapshot`, `PlaybackConstraints` and `PlaybackDecision` with `ReasonNode`, `ReasonCode`
and `TransformKind`, with an architecture test forbidding it from importing the legacy DLNA model.
The honest state is equally documented: `DecisionVersion` is still the legacy value, the v2 engine
runs in shadow only and is disabled by default, and on a default server the diagnostic fields are
all `null` while the legacy-derived `Transforms` are best-effort and `SelectedStreams.Video` is
always `null`. Layer 2 must therefore own **two** things: the explanation vocabulary, and the
distinction between *"this is absent because the source is legacy"* and *"this is absent because it
is genuinely nothing"*. A client that cannot express that distinction will show a confident wrong
answer, which is worse than showing none.

**Content packs and browsing preference.** `content-pack-contract.md` §4.4.1 chose the user
configuration rather than a `DisplayPreferences` record precisely so that Web, Android, Android TV,
iOS and TV clients observe one choice. That decision is only worth anything if layer 2 makes it
binding; if each client re-derives "which navigation do I show", the contract's own reasoning is
defeated on first contact.

**Typed errors and cancellation.** These look like plumbing and are not. An error vocabulary that is
per-client becomes a support surface that is per-client, and a cancellation model that is per-client
becomes a set of platform-specific bugs about requests that outlive the screen that asked for them.

**What layer 2 must not become.** It is not a second API. It does not add capability the server does
not have, it does not cache business rules the server owns, it does not evaluate authorization, and
it does not grow a convenience method for every screen the first client happens to need. The
pressure will be to widen it; the discipline is that a new member of layer 2 has to name the
cross-client disagreement it prevents.

### 3.3 Layer 3 — per-platform presentation and integration

Everything a user can see or touch is layer 3, and it is owned by the platform. §6 enumerates it.
The rule is one sentence: **layer 3 may depend on layer 2, and layer 2 may never know that layer 3
exists.**

The Web renderer is the worked example that shows the split is real rather than aspirational.
`docs/tesserafin/presentation-boundary.md` records that all three `presentation.page.*` capabilities
were bound **with no server change at all**, that composition is a client-side arrangement of data
the client already has, and — the harder half — that a recipe may hide a section but must never stop
its fetch, because a presentation choice that changed what the client asks the server for would
have quietly turned layer 3 into layer 2. That invariant transfers to every native client without
modification.

---

## 4. Versioning, provenance and compatibility

### 4.1 What already exists, and is not re-invented here

| Control | Where | What it guarantees |
| --- | --- | --- |
| Canonical contract | `openapi/openapi.json`, generated only by `ci/openapi-generate.sh` | one authoritative document, deterministic byte-for-byte across cold generations |
| Contract identity | `openapi/contract.lock.json` — `{algorithm, sha256, spec, version}` | a contract is identified by the **pair** `(server version, sha256)`; the version alone is insufficient because the surface moves between version bumps |
| Drift gate | `OpenApiContractTests.CommittedContract_MatchesRunningServer`, in `ci/run.sh` | the committed contract is what the running server produces, in the same commit |
| Compatibility gate | `OpenAPI Check` → `ci/openapi-compat.sh` (oasdiff, pinned by digest) + `ci/openapi-severity-levels.txt` | merge-base vs head compared semantically; breaking changes surface as such |
| Generated-artifact freshness | `npm run verify:tesserafin-sdk-fresh` | regenerating from the committed spec produces zero diff, and `spec/version.json` carries a non-null version |
| Server ↔ client pairing | `ci/web-pair.lock.json` + `ci/verify-sdk-provenance.sh` | a full 40-character web commit, never a branch or tag; moving it is a deliberate act with a recorded reason |
| Product versions | `docs/versioning-policy.md` §6 | one authority per number; nothing else derives a version |

This RFC **adopts all seven for native clients** rather than proposing a parallel mechanism. A
native client's generated artefacts are pinned by the same `(version, sha256)` pair, verified by the
same freshness idea, and paired to a server commit by the same kind of lock.

### 4.2 Server-contract compatibility, from the client's side

A client must be able to answer *"can I talk to this server?"* before it depends on the answer.

- **Minimum supported server.** A client declares one, derived from the pinned spec rather than
  from an upstream package — `src/lib/tesserafin-sdk/versions.ts` already does exactly this, and
  `src/lib/jellyfin-apiclient/connectionManager.js` already reads `MINIMUM_VERSION` from it. Every
  official client follows that pattern.
- **Maximum supported server.** There is **no hard maximum.** A newer server that has only added
  surface is expected to work, because additive change is what the compatibility gate permits
  without a breaking-change verdict. What a client may not do is *assume* it: unknown fields are
  ignored, unknown enum members are handled as unknown rather than crashing or being silently
  coerced to a known one.
- **Version resolution is explicit.** `docs/versioning-policy.md` §3 forbids enumerating registry
  tags, sorting them globally by SemVer, or assuming the numerically largest is supported — under
  the current epoch the largest tag in the organisation is an unsupported pre-`1.x` development
  artefact, so "greatest SemVer wins" is not merely risky, it is guaranteed wrong. No client, and no
  future updater, implements that heuristic.

### 4.3 Failing when compatibility cannot be established

**A client that cannot establish compatibility must fail closed, visibly, and with a reason.**

Concretely, and in the same spirit as RFC-0007 §5.3's rule that a missing *required* capability
means the theme must not activate and the caller is told which one is missing:

- it does not proceed in a degraded mode it has not specified;
- it does not guess an API shape;
- it names what it needs and what it found — a version, or a capability, not a generic failure;
- the failure is distinguishable from "the server is unreachable" and from "your session expired",
  because the three have three different user actions.

Rendering something half-right and letting it look broken is worse than refusing with a reason. That
is RFC-0007's judgement about themes; it is equally true of a protocol.

### 4.4 Additive versus breaking, and semantic-layer versioning

Two version lines, deliberately distinct:

- **The contract** follows the server product version and its content hash, and the oasdiff policy
  decides whether a change is compatible. This RFC adds nothing to it.
- **The semantic layer (layer 2) carries its own SemVer**, because it can break for reasons the wire
  contract does not — a renamed meaning, a narrowed error vocabulary, a changed lifecycle. A layer-2
  major bump is a client-migration event and must be reviewed as one.

Additive at layer 2 means: a new member of a closed vocabulary that clients are already required to
treat as open-ended, a new optional input, a new field on a result. Anything that changes what an
existing name *means* is breaking, even when the type is unchanged — RFC-0007 §4.7 already paid this
cost knowingly, widening a closed enum from five members to eleven while retaining every existing
name verbatim, on the stated rule that *widening a closed enum is backward-compatible and renaming a
member is not*.

### 4.5 Conformance fixtures

Every official client must be checkable against the same evidence, and the checks must be **reusable
rather than re-implemented per platform**. Two kinds:

1. **Contract fixtures** — recorded request/response pairs for the semantics in §3.2, produced from
   a real server rather than hand-written, so a client can be exercised without one. The server
   already exports fixtures for the hardest case: `GET System/PlaybackDiagnostics/Sessions/{id}/Fixture`
   emits a playback case against `tests/PlaybackCompat/schema/fixture.schema.json`. That is the
   shape to generalise, not to invent.
2. **Behavioural conformance** — assertions a client passes, not bytes it matches: the browsing
   preference is observed and not re-derived; an unknown enum member does not crash; a cancelled
   request is not an error; a permission denial is rendered as the server's answer; an incompatible
   server fails closed with a named reason.

**No generator, package or fixture corpus is created by this RFC.** What is decided is that the
first client implementation owes them (§9.4).

---

## 5. Shared design primitives

### 5.1 What is shared, and at what level

RFC-0005 §3 already ruled the principle — *unify the language, not the interface* — and §3.1 drew
the line concretely: semantic colours, typography and scale, spacing and radii, shadow/blur/motion,
icon and asset roles, component names and states, and theme manifests are unified; React, Compose
and SwiftUI components, per-OS navigation, touch gestures, TV focus and remote behaviour, per-OS
menu conventions, performance constraints and exact screen layout stay native.

RFC-0007 then made that principle a real contract with a real schema. This RFC's contribution is
**not a new design system.** It is the statement that the *existing* universal layer is the
cross-client design contract, and the enumeration of what a native renderer is expected to consume.

The vocabulary is not hypothetical. `tesserafin-design/schema/tokens.schema.json` defines exactly
eight token groups today — `color` (with `light` and `dark`), `typography` (`fontFamily`,
`fontSize`, `fontWeight`), `shape` (`radius`), `spacing`, `elevation`, `motion` (`duration`,
`easing`), `density` and `blur` — and `theme.schema.json` defines the profile set: `pointer`,
`touch`, `remote`, `compact`, `medium`, `expanded`, `reducedMotion`, `reducedTransparency` and
`lowPower`.

| Primitive | Shared semantics | Native renderer's job |
| --- | --- | --- |
| **Colour roles** | semantic roles — surface, background, accent, focus, and the rest of the `color` group, per mode | mapping a role onto the platform's own colour system |
| **Typography scale** | family, size steps, weight steps as a scale | text style resolution, dynamic type, per-OS metrics |
| **Spacing and density** | the `spacing` and `density` groups, plus the `compact`/`medium`/`expanded` profiles | how a scale becomes a layout on a phone, a tablet and a ten-foot screen |
| **Motion** | `duration` and `easing` as semantics | the platform animation API; honouring the OS reduce-motion setting |
| **Focus and accessibility semantics** | the `focus` colour role, the `remote` and `reducedMotion` profiles, and the invariants of §5.3 | the platform accessibility API — see §6 |
| **Icon and asset roles** | the role vocabulary of RFC-0007 §4.5 — `logo`, `wordmark`, `monogram`, `favicon`, `backdrop`, `loginBackdrop`, `placeholderPoster`, `placeholderBackdrop` — as *roles*, never as URLs | supplying its built-in asset for any role the theme does not ship |
| **Dark / light** | `modes`, and the requirement that a theme declare which it provides | following the OS appearance setting, and the platform's own switch |
| **Input and power profiles** | `pointer`, `touch`, `remote`, `reducedMotion`, `reducedTransparency`, `lowPower` | detecting which apply, and applying the overrides |
| **Theme manifest concepts** | RFC-0007's universal layer in full: identity, compatibility, licence, modes, profiles, tokens, asset roles, semantic component variants, composition recipes, lineage | declaring its own `renderers.<platform>.supports`, and negotiating |

RFC-0007 §5.1 already reserves `renderers.android`, `renderers.ios` and `renderers.tv` in the
manifest, accepting only a `supports` list. **Adding a native renderer is therefore an additive
change to a slot that already exists**, not a contract revision — which is exactly what RFC-0007 §3
said the split was for.

`tesserafin-design/README.md` describes the generator as already producing per-platform output from
one declarative theme, with the Web renderer implemented first and Compose/SwiftUI renderers
arriving "when the corresponding native apps start". This RFC does not start them. It records that
when they do start, they consume **generated serialisations of the same schema, never a parallel
redefinition** — and that the output identifiers follow current naming, not the pre-rename names
RFC-0005 §3.2 used when it was written.

### 5.2 Shared semantics are not pixel-identical rendering

**This must be stated explicitly because it is the failure mode.**

Two official clients that resolve the same theme are expected to be *recognisably the same product*:
the same accent, the same relative type scale, the same density intent, the same motion character,
the same dark/light behaviour, the same focus semantics. They are **not** expected — and must not be
required — to produce the same pixels.

What is deliberately **not** unified:

- exact screen layout and component composition on any given screen size;
- component implementation and internal structure;
- navigation form (a phone's bottom bar, a TV's focus rail, a browser's sidebar);
- platform typography metrics, system fonts and dynamic-type behaviour;
- native gesture, haptic, scrolling and overscroll behaviour;
- per-OS control conventions.

A change that would force pixel identity — a shared component library, a layout DSL that dictates
absolute placement, a screenshot test comparing two platforms' rendering — is out of scope and is
rejected in §8.2. RFC-0007 §4.6 already made the structurally identical ruling for themes: a theme
selects a *published variant*, it never supplies a selector, a class name or a DOM structure, and
the reason is that exposing the internals would make every refactor unsafe forever. The same
argument applies across platforms with more force, because there is no single internal structure to
expose.

### 5.3 Accessibility is an invariant, not a token value

RFC-0007 §6.1 forbids a theme from weakening focus visibility, contrast, reduced-motion or
screen-reader behaviour, and §6.4 turned that from an assertion into a gate: every shipped palette
is measured against WCAG 2.2 SC 1.4.3 (4.5:1 for text) and SC 1.4.11 (3:1 for focus indicators and
meaningful UI colour), compositing alpha rather than measuring a translucent token as if it were
opaque. That gate found a real defect on its first run — three focus-ring colours between 1.38:1 and
2.01:1 against a 3:1 requirement — and the remaining known failures are held in a **ratchet** that
can only shrink.

**Every native renderer inherits that invariant.** A theme may not weaken accessibility on Android
or iOS any more than it may on the Web, and a native client may not treat a token value as
permission to fall below the platform's own accessibility floor. Where the two disagree, the
stricter wins.

---

## 6. Platform-owned responsibilities

The following are **native, per-platform, and explicitly not shared**. No item here belongs in
layer 2, and no item here is negotiable by a theme.

| Responsibility | Why it stays native |
| --- | --- |
| **Navigation** | RFC-0005 §3.1 names per-OS navigation as native. RFC-0007 §4.6 additionally rules that presentation may govern how navigation *looks*, never what it *contains* — destinations are authorization and library state |
| **Component implementation** | the whole point of §5.2; React, Compose and SwiftUI are independent implementations of shared concepts |
| **Accessibility APIs** | TalkBack, VoiceOver and the DOM accessibility tree are not abstractable without losing all three; the *invariant* is shared (§5.3), the API is not |
| **Lifecycle and background execution** | process death, background limits and foreground services are platform contracts with no cross-platform equivalent |
| **Secure credential storage** | Keystore, Keychain and browser storage have different threat models and different guarantees; layer 2 defines *when* a credential is valid, never *where* it is kept |
| **Media sessions** | `MediaSession`, `MPNowPlayingInfoCenter` and the Media Session API are OS integrations |
| **Casting and device integration** | per-OS discovery and transport |
| **Downloads and offline storage** | storage quota, eviction and background transfer are OS policy |
| **OS share sheets** | per-OS |
| **Billing and store APIs** | per-store, and additionally gated by #100 (§7) |
| **Push notifications** | per-OS transport and permission model |
| **TV remote and focus behaviour** | RFC-0004 §4 kept generic ten-foot UX in `tesserafin-web` **for Web**; a native TV client implements its platform's own focus system and imports none of it |

The test for anything not on this list: **if two platforms could reasonably implement it differently
without either being wrong, it is layer 3.**

---

## 7. Trust and privacy boundary

### 7.1 What this RFC states

1. **Self-hosted operation requires no Tesserafin account.** The server and Tesserafin Web are fully
   usable without one. `tesserafin#142` records this as agreed product doctrine, `#146` restates it
   as a product constraint, and `docs/content-pack-contract.md` §3.4 and §6 already hold the line for
   the content-pack vertical: "local-only operation requires no Tesserafin account", and "any
   mandatory Tesserafin account" is a listed non-goal.
2. **Native-client SDK traffic to the household server is the media plane, and stays there.** A
   client talks to the household's own server. That path carries libraries, playback and sessions,
   and it is not routed, proxied, mirrored or relayed through Tesserafin infrastructure.
3. **Nothing about a household's media reaches Tesserafin infrastructure by default.** No media
   library, no file names or paths, no playback history, no server addresses, no household user
   list, no local media identifiers. "By default" is doing real work in that sentence: any future
   opt-in must be an explicit, separately reviewed decision, and its absence must be the shipped
   behaviour.
4. **The SDK embeds no reusable master credential and no licensing secret.** A secret shipped inside
   a distributed binary is a published secret. This is a permanent constraint on layer 1 and layer 2,
   independent of whatever #100 decides.

### 7.2 What this RFC deliberately does not state

**Account, purchase, entitlement, activation, device-binding and revocation architecture belongs to
[`tesserafin#100`](https://github.com/tesserafin-project/tesserafin/issues/100), and is not decided
here.** That issue owns the Tesserafin account, OAuth/OIDC sign-in, per-store distribution and
purchase restoration, signed offline entitlement leases, renewal and grace policy, revocation,
device key pairs and multi-device policy.

The boundary between the two is a single sentence, and it is a decision of *this* RFC:

> **Media access is never coupled to the licensing control plane.**

A client's ability to reach the household server, authenticate against it, browse it and play from
it must not depend on the availability, reachability or verdict of any Tesserafin-hosted service.
Whatever #100 decides about entitlement, it decides on the other side of that line. §8.5 records the
coupling as rejected rather than merely undesirable.

---

## 8. Rejected alternatives

Each of these is a real option with a real argument for it. Each is rejected here so that proposing
it later requires superseding this RFC rather than reopening a settled question.

### 8.1 Official WebView wrappers

**Rejected.** Wrapping `tesserafin-web` in a native shell is the cheapest path to "an app on every
platform", and it is the one this project has already structurally walked away from: RFC-0004
removed the embedded-TV target from this repository outright, and `tesserafin#142` and `#146` both
record as doctrine that official native applications are premium native products, not embedded
WebViews.

The architectural objection is stronger than the cost argument. A WebView wrapper makes the Web
DOM the cross-platform contract by accident — every native platform then inherits a shape it has no
reason to have, and every Web refactor becomes a multi-platform risk. That is the same failure
RFC-0007 §4.7 refused when it declined to publish the Web renderer's private
`data-detail-section` identifiers as theme vocabulary.

### 8.2 Sharing UI components across every platform

**Rejected.** A single cross-platform component library sounds like the maximal reuse of §5, and it
inverts it. RFC-0005 §3 chose to unify the *language* precisely so that each platform could keep its
own interface; a shared component set unifies the interface and, in practice, produces something
that is native nowhere. TV focus behaviour, dynamic type, gesture conventions and platform
navigation are exactly the surfaces users notice, and they are the ones a shared component library
gets wrong first.

Kotlin Multiplatform is permitted for **protocol, session and domain logic** (§2.3) and is not a
route around this rejection.

### 8.3 Treating the generated SDK as the whole domain layer

**Rejected.** It is the default outcome if nobody decides otherwise, which is why it is recorded
here rather than assumed away. The generated surface is a function of the server's serialization and
the generator template — including the two documented shape repairs in
`scripts/generate-tesserafin-sdk.mjs`, which exist because the raw generated output was wrong in
ways that had nothing to do with the product. Building four clients directly on that surface would
mean every regeneration is a potential refactor of every client, and every toolchain quirk becomes
a product concept. Layer 2 exists so that the blast radius of a regeneration stops at one hand-owned
boundary.

### 8.4 Letting each client redefine content-pack or playback semantics

**Rejected.** These are the two places where per-client improvisation would be most tempting and
most damaging. `docs/content-pack-contract.md` §3.8 already assigns identity, membership,
authorization, ordering, provenance, query semantics and migration to the server, and explicitly
forbids the API from encoding React, Compose, SwiftUI, theme names, RFC-0007 capability names,
layout hints or card aspects — "if a future client needs a different arrangement of the same packs,
that is a client change, not an API change". Playback is the same shape of problem with worse
consequences: a client that invents its own account of why a stream was transcoded is a client that
gives users a confident wrong explanation.

### 8.5 Coupling media access to the future licensing control plane

**Rejected**, on the boundary stated in §7.2. Beyond the privacy argument, the reliability argument
is decisive: a household's ability to play its own files from its own server must not have a
remote dependency that can be unreachable, slow or wrong.

### 8.6 Publishing the unpublished Reefin-era draft as historical authority

**Rejected.** The draft is untracked, was never committed or pushed, sits on a deleted branch under
pre-rename paths and identifiers, and has not been re-read by its author since it was written. It is
not a repository artefact, and an ADR that said "this ratifies RFC-0006" would cite a document its
reader cannot open — which `tesserafin#99`'s own 2026-08-02 comment identified as the disqualifying
problem. Publishing it would also mean publishing someone's unfinished draft on their behalf, and
then treating a stale document as authority over decisions this RFC is accountable for.

Where this RFC agrees with what the roadmap attributes to that draft, the agreement is a
**convergence, not an inheritance** — reached from the published sources in §1.4 and defensible from
them alone.

---

## 9. Consequences and follow-ups

### 9.1 Decided now

- Web is the desktop/browser reference client and is never an embedded native UI (§1.3).
- No native Windows, macOS or Linux client is planned (§2.2).
- No WebView-based official mobile or TV client (§8.1).
- Official native clients live in `tesserafin-mobile`; Android and Android TV are wave 1, iOS and
  tvOS wave 2, webOS and Tizen later official targets (§2.1, §2.2).
- Kotlin Multiplatform is permitted for protocol/session/domain logic where it genuinely reduces
  duplication; UI stays native per platform; there is no cross-platform shared UI-component
  requirement (§2.3, §8.2).
- Three contract layers, with layer 2 owning the eleven semantics of §3.2 and layer 1 explicitly not
  being the domain model (§3, §8.3).
- Contract compatibility, provenance and pairing reuse the seven existing controls rather than
  inventing parallel ones; a client fails **closed with a named reason** when compatibility cannot be
  established; layer 2 carries its own SemVer (§4).
- RFC-0007's universal layer is the cross-client design contract; shared semantics explicitly do not
  mean pixel-identical rendering; accessibility invariants are inherited by every renderer (§5).
- The twelve responsibilities of §6 are permanently platform-owned.
- Media access is never coupled to the licensing control plane; no media data reaches Tesserafin
  infrastructure by default; no master credential ships in a client (§7).

### 9.2 Enabled later, and not started here

- A native code generator and the first generated native artefacts.
- The layer-2 package, in whatever form the client repository chooses.
- The `tesserafin-mobile` repository itself.
- Compose and SwiftUI token renderers in `tesserafin-design/`, and the `renderers.android` /
  `renderers.ios` / `renderers.tv` capability lists that RFC-0007 §5.1 already reserves slots for.
- A conformance fixture corpus and the behavioural conformance suite (§4.5).

### 9.3 Deliberately deferred

**To `tesserafin#100`:** the Tesserafin account, OAuth/OIDC sign-in, store distribution and purchase
restoration, entitlement leases and their claim set, renewal and offline grace policy, revocation,
device binding and multi-device policy, and recovery. This RFC decides only where the boundary falls
(§7.2).

**To the wave-1 implementation:** the Android UI toolkit decision in its final form; how much logic
is genuinely worth sharing through Kotlin Multiplatform; the concrete serialisation of layer 2's
vocabulary; the offline and download model; the exact conformance-fixture format.

**To the point of scheduling:** whether webOS and Tizen share `tesserafin-mobile` (§2.1).

**Not decided here at all:** anything in `tesserafin#146`'s classification — whether a given future
capability is core, an official module, a plugin, a theme package or a hosted service.

### 9.4 What the first client implementation owes

Wave 1 is not complete until it produces, as reviewable artefacts:

1. the conformance fixtures and the behavioural conformance suite of §4.5, in a form the second
   client can reuse without rewriting;
2. its `renderers.android` / `renderers.tv` capability declarations, and evidence of the
   required/optional fallback behaviour RFC-0007 §5.3 specifies;
3. evidence that the §5.3 accessibility invariants hold on the platform's own accessibility APIs;
4. a record of every place it found layer 2 insufficient — because that list, not this document, is
   the real test of whether §3.2 was drawn correctly.

### 9.5 Risks

- **Layer 2 grows without discipline.** The mitigation is the rule in §3.2: a new member must name
  the cross-client disagreement it prevents.
- **Wave 1 finds the split wrong.** This is a feature of doing Android and Android TV first (§2.2);
  the cost of discovering it in wave 1 is one client, not four.
- **The playback explanation contract firms up under a client's requirements rather than the
  server's.** The v2 engine is not yet the source of truth and its shadow mode is off by default;
  a client built against today's legacy-derived fields could bake in approximations. §3.2 requires
  the absent-because-legacy distinction to be explicit for exactly this reason.
- **A future desktop client is argued for on the basis that the SDK exists.** §2.2 is a standing
  decision, not an omission.
- **Native renderers drift from the theme schema.** RFC-0005 §3.2's rule is reaffirmed in §5.1:
  generated serialisations of the same schema, never a parallel redefinition.

### 9.6 Compatibility impact of this RFC

None. This document changes no code, no schema, no generated artefact, no dependency and no
behaviour. It is a boundary that future work is measured against.
