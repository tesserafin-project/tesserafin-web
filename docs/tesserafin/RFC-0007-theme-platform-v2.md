# RFC-0007 — Theme Platform v2

- **Status**: Accepted (2026-08-05)
- **Date**: 2026-08-05
- **Author**: Tesserafin Project
- **Repository**: `tesserafin-web`
- **Supersedes**: RFC-0005 §7 (theme contract), §7.3 (community package format v1) and §8's theme
  naming. Everything else in RFC-0005 — the design-system rationale (§3, §6), the audit (§4), the
  four-concept separation (§5), loading/budget/persistence (§9) — remains in force and is not
  restated here.
- **Language note**: RFC-0001 through RFC-0006 are written in French, and RFC-0004 recorded that
  convention explicitly. This document is in English because the theme contract is a **published
  contract for third-party authors**, not an internal design record, and every GitHub issue, PR and
  schema description it governs is already English. The shift is deliberate and applies to this
  document and its successors, not retroactively.

---

## 1. Why this RFC exists

RFC-0005 §7 defined a theme as, essentially, **a manifest plus a token set**. Layout, composition
and component behaviour were deliberately placed outside the theme, as "layout presets" and design-
system concerns. §7.3 then specified the community package format as "strictly declarative",
meaning tokens only.

The product direction recorded after the 1.0.0 release says something different. Issue #142 §B1
states that themes may control the **complete presentation layer** — colour, typography, spacing,
shapes, surfaces, motion, component variants and composition, navigation presentation, and the
presentation of library, details, search, home and player. §B4 adds that authoring should eventually
reach "maximum reasonable creator freedom, potentially including CSS/SCSS/LESS or another expressive
source layer for Web, without reducing themes to a crippled CSS subset".

**These two statements contradict each other, and the contradiction is not cosmetic.** Under
RFC-0005 a theme that wanted to reorder the home page or change how a media card is composed had
nowhere to say so; the only honest answer was "that is not a theme, that is a layout preset". Under
the current direction that answer is wrong.

This RFC resolves the contradiction in favour of the product direction, and it does so by
**evolving** the existing schema rather than starting a second theme system beside it. Nothing in
`tesserafin-design/` is abandoned: the token vocabulary is unchanged, the generator is unchanged in
shape, and both official themes migrate without losing a token.

What this RFC does **not** do is accept the direction uncritically. §6 sets the boundaries a theme
may never cross, and §7 explains why the advanced source layer is *reserved* rather than shipped.

---

## 2. Scope

**In scope**: the theme manifest contract; the split between the universal layer and the platform
renderer layer; capability declaration and fallback; the security and accessibility boundary; the
official-theme migration; the naming correction.

**Out of scope**, explicitly: marketplace upload, payments, account identity, package signing,
source protection, remix enforcement, and the choice or naming of a third official theme. §4.8
records *lineage metadata* only, which is the part a later marketplace needs to already exist; it
is not, and must not be presented as, an enforcement mechanism.

---

## 3. Two layers, and why the split is the whole design

```
┌─ UNIVERSAL LAYER ────────────────────────────────────────────┐
│  identity · compatibility · licence · modes · profiles       │
│  tokens (colour, type, space, shape, elevation, blur,        │
│          density, motion) · asset roles                      │
│  semantic component variants · composition recipes           │
│  lineage                                                     │
└──────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐   ┌───────────────────┐   ┌───────────────┐
│ Web renderer  │   │ Android/TV        │   │ Apple         │
│ (implemented) │   │ renderer (future) │   │ (future)      │
└───────────────┘   └───────────────────┘   └───────────────┘
```

The universal layer names **what a presentation means**: a surface, a media card, a navigation
shell, an accent colour, a motion duration. It never names a React component, a Compose modifier, a
SwiftUI view or a CSS selector.

The platform renderer layer is where everything platform-specific lives, under `renderers.<platform>`
in the manifest. Adding the Android renderer adds a key there and changes nothing above it.

This is not decoration. It is the constraint that stops the contract from becoming Web-only the
moment the advanced Web authoring layer arrives (§7): that layer is a *renderer* concern, declared
under `renderers.web.source`, and nothing in the universal layer depends on it. If a future change
would require the universal layer to know about CSS, that change is wrong and must be redesigned.

---

## 4. The universal layer

Normative source: `tesserafin-design/schema/theme.schema.json`. This section explains the intent;
the schema is what validates.

### 4.1 Identity and versioning

`id` is `namespace.name` and is **stable identity**: it is the persisted user setting, the MUI
colour-scheme key and the generated stylesheet selector. Renaming a theme changes `name`, never
`id`. `version` is the theme's own SemVer.

`contractVersion` is required and is `2`. A v1 manifest — one with no `contractVersion` — is
rejected with a message that says so, rather than producing a pile of schema errors caused by the
version difference itself.

### 4.2 Compatibility, author, licence

`compatibility` carries a loose SemVer range per platform; at least one is required. `license` is an
SPDX identifier. Both are required, because a theme whose licence is unknown cannot be redistributed
and a theme whose target version is unknown cannot be safely applied.

### 4.3 Modes and profiles

`modes` lists the colour modes the theme provides (`light`, `dark`). `profiles` carries per-profile
token overrides for `pointer`, `touch`, `remote`, `compact`, `medium`, `expanded`, `reducedMotion`,
`reducedTransparency` and `lowPower`.

**v2 change**: v1 typed a profile override as `additionalProperties: true`. That let an imported
theme carry arbitrary keys inside a profile, which is exactly the hole the "themes cannot execute
anything" claim depends on not existing. v2 types it as a genuine deep-partial of the token schema —
same groups, same leaf constraints, nothing required — and
`tesserafin-design/__tests__/schema-partial-parity.test.ts` fails if the two schemas drift.

### 4.4 Tokens

Unchanged from RFC-0005 §7.1. The token vocabulary did not move: no group, key or leaf constraint
was added, removed or retyped. That is what makes migration parity assertable rather than argued.

### 4.5 Asset roles

`assets` maps a **role** (`logo`, `wordmark`, `monogram`, `favicon`, `backdrop`, `loginBackdrop`,
`placeholderPoster`, `placeholderBackdrop`) to a package-relative path. The path pattern admits no
scheme and no `//`, so `https://…`, `data:…` and `javascript:…` are unrepresentable — a theme can
only name a file it ships. A renderer with no asset for a role uses its built-in one.

### 4.6 Semantic component variants

`presentation.surface`, `presentation.mediaCard` and `presentation.navigation` select among
**published** variants of the presentation primitives in `src/ui/` — the ones that already carry a
`data-rf-slot` attribute. Each value is a closed enum.

A theme selects a variant. It does not supply a selector, a class name or a DOM structure. The
reason is §6.2: the moment a theme could target `.MuiPaper-root` or an internal wrapper `<div>`, the
generated MUI class names and the internal DOM would become public API, and no refactor of `src/ui/`
would ever be safe again.

`presentation.navigation` governs how navigation **looks** — shell form, label policy, side. It
never governs what navigation **contains**: which destinations exist is authorization and library
state.

### 4.7 Declarative composition recipes

`presentation.page.home`, `.library` and `.itemDetails` order and select **published** sections. The
section vocabulary is a closed enum, so a recipe can reorder `continueWatching` before `nextUp`, or
drop `recommendations`, but it cannot introduce a section the renderer does not implement.

These three capabilities are **defined by this contract and not yet bound by the Web renderer** —
see §5.3 for what that means in practice and why it is stated rather than hidden.

### 4.8 Lineage

`lineage.basedOn` names the theme a derived theme derives from; `lineage.remixable` records the
author's intent; `lineage.attribution` carries the line a derivative is asked to display.

This is **metadata, not enforcement**. Nothing in this contract prevents someone from ignoring
`remixable: false`. Signing, source protection and marketplace policy are what would make it
meaningful, and all three are out of scope (§2). Recording the metadata now means a later
marketplace does not have to migrate every existing theme to acquire it.

---

## 5. The platform renderer layer

### 5.1 Renderer declarations

`renderers.web` declares what the Web renderer supports, plus the reserved `source` extension point
(§7). `renderers.android`, `.ios` and `.tv` are reserved and accept only `supports`.

Every renderer key is optional. A manifest that declares no renderer at all is valid — it is a purely
universal theme, and every renderer applies what it can.

### 5.2 Capabilities

The capability vocabulary is **closed**:

| Capability | Meaning | Web renderer |
|---|---|---|
| `tokens.core` | The eight token groups | **implemented** |
| `tokens.profiles` | Per-profile token overrides | **implemented** |
| `assets.roles` | Asset roles (§4.5) | **implemented** |
| `presentation.surface` | Surface variants | **implemented** |
| `presentation.mediaCard` | Media-card variants | **implemented** |
| `presentation.navigation` | Navigation presentation | **implemented** |
| `presentation.page.home` | Home composition recipe | defined, not yet bound |
| `presentation.page.library` | Library composition recipe | defined, not yet bound |
| `presentation.page.itemDetails` | Item-details composition recipe | defined, not yet bound |
| `source.web.css` | Advanced Web source layer (§7) | defined, not yet bound |

Closed rather than open on purpose: a theme that could claim an undefined capability would be asking
a renderer to guarantee something nobody has specified. An unknown capability name is a validation
error.

A theme splits its capabilities into `required` and `optional`.

### 5.3 Fallback, and why "defined but not bound" is stated out loud

`src/themes/platform/resolvePresentation.ts` is the one place a theme's declaration and a renderer's
declaration meet:

- a **required** capability the renderer does not implement means the theme **must not activate**,
  and the caller is told which capability is missing. Rendering it half-right and letting it look
  broken is worse than refusing with a reason.
- an **optional** capability the renderer does not implement means the theme's value for it is
  replaced by the **platform default**, and the substitution is reported in `fallbacks`. Falling
  back is a documented downgrade, not an error, and it is observable rather than invisible.
- fallback is **per capability, never per key**. A renderer either speaks `presentation.mediaCard`
  or it does not; partially honouring it would produce a presentation neither the theme author nor
  the platform designed.

The four "defined, not yet bound" rows above are the honest half of this design. The alternative —
leaving page composition and the source layer out of the contract until they are implemented —
would make the vocabulary look complete when it is not, and would force a breaking contract change
later. Declaring them and letting them fall back says the true thing, and
`resolvePresentation.test.ts` asserts the fallback actually happens.

---

## 6. What a theme may never do

### 6.1 Boundaries

A theme may not, under any renderer:

- execute JavaScript, or carry anything that becomes executable;
- issue a network request, or reference a network resource;
- read or influence authentication tokens, sessions or media APIs;
- weaken focus visibility, contrast, reduced-motion or screen-reader behaviour;
- replace or alter playback or session logic;
- override authorization, or change what a security-relevant surface says.

Presentation is the whole of a theme's authority. Permissions, data access, playback correctness,
business logic and required accessibility behaviour are outside it, permanently.

### 6.2 How this is enforced, not merely asserted

**The manifest schema is a closed declarative vocabulary.** Every object sets
`additionalProperties: false`; every leaf is an enum, a bounded pattern or a token value. A theme
cannot carry a script, a URL, a credential or an unknown key — not because anything strips them, but
because there is no key they could arrive under and no value shape that could hold them. Validation
rejects the whole document; it never sanitises part of one and continues.

`assertNoExecutableSurface` in `src/themes/platform/validateManifest.ts` is **defence in depth on top
of that, not the primary control**: it re-checks the raw package text for `<script>`, `javascript:`,
`data:text/html`, inline event handlers, network URLs, `eval(`, `new Function` and `import(`. It is
not a general code detector — that would be a losing game and is not the control doing the work.

**No unstable selector is ever exposed.** Themes address published semantic slots
(`data-rf-slot="surface"`, `data-rf-slot="media-card"`) and published variant enums. Generated MUI
class names and internal DOM structure are not part of the contract and never become part of it.
Had the only workable implementation required exposing them, this RFC would have stopped instead;
it did not, because `src/ui/` already publishes a primitive set with stable slots.

### 6.3 Import validation

One validator, one schema. `validateManifest.ts` reads `theme.schema.json` directly and runs it
through the same dependency-free validator the Node generator uses, so an in-app import and
`npm run generate:tokens` cannot disagree about what a valid theme is.

Every failure mode of an untrusted file is a returned issue, never a throw: malformed JSON, a
non-object document, a v1 manifest, a schema violation, an executable surface, an incompatible
version. The importer keeps the user's existing draft untouched.

### 6.4 Accessibility invariants

Themes control colour. Colour is where accessibility is most easily destroyed. So the palettes
themselves are gated: `tesserafin-design/__tests__/palette-contrast.test.ts` measures every shipped
palette against WCAG 2.2 SC 1.4.3 (4.5:1 for text) and SC 1.4.11 (3:1 for the focus indicator and
meaningful UI colour), compositing alpha rather than measuring a translucent token as if it were
opaque.

**This gate found a real defect on its first run.** `--rf-color-focus` is the focus ring —
`outline: 2px solid var(--rf-color-focus)` across the whole modern UI. Tesserafin Classic declared
it as `rgba(255,255,255,0.12)` in dark mode and `#bbb` in light: **1.38:1 and 1.71:1**, against a
3:1 requirement. Tesserafin Glass's light mode was 2.01:1. A keyboard-only user could not reliably
see where focus was. All three are corrected in this RFC's implementing PR; dark Classic now uses
the canonical Tesserafin water accent `#18b8b2` (7.74:1), light Classic a darker step of the same
hue `#0d7a76` (4.62:1), and light Glass the opaque form of its own existing primary `#0a6689`
(5.71:1).

Four contrast failures remain, all in Classic's inherited `#00a4dc` primary and `#ed6c02` warning.
They are recorded in `KNOWN_INSUFFICIENT` and the recording is a **ratchet, not a snapshot**: the
list is asserted to be exactly the set of current failures, so a pair that starts passing fails the
test until its waiver is deleted, and a pair that starts failing without a waiver fails outright.
The list can only shrink. The Classic palette refresh is what shrinks it to empty.

---

## 7. The advanced Web source layer — reserved, not shipped

The product direction requires that community themes not be permanently confined to a token-only
subset, and names CSS/SCSS/LESS/Sass as the eventual Web authoring surface.

This RFC **reserves** that layer and does **not** implement it. `renderers.web.source` exists in the
manifest with its shape fixed, and the schema accepts exactly one value: `kind: "none"`. Widening
that enum is the single schema change that opens the layer.

The reason for reserving rather than shipping is specific. An expressive source layer is only
compatible with §6.1 if compilation is genuinely isolated — a compiler that cannot reach the DOM,
the network, the filesystem or the host page, whose output is constrained to a declared property set,
and whose failure modes are bounded. That boundary was not proven within this loop, and shipping the
authoring surface before proving it would publish a promise the renderer cannot keep.

What this RFC does guarantee is that opening the layer later is **not** a breaking change: the
package format already has the slot, capability negotiation already handles "renderer does not
support this", and the universal layer does not depend on the layer existing.

**The visual controls shipped alongside this RFC are not the final creative boundary.** They are the
first bounded set.

---

## 8. Migration

### 8.1 Official themes

Both official themes migrate to v2. Their `tokens.json` files keep every token they had, and the
only value changes are the three `focus` colours corrected in §6.4. Their `id`s are unchanged, so no
user's saved theme preference is orphaned.

`official.classic` 0.1.0 → 0.2.0; `official.glass` 1.0.0 → 1.1.0.

### 8.2 Naming

RFC-0005 §8 named the official themes "Reefin Classic" and "Reefin Glass". Every **active,
user-facing** occurrence is now "Tesserafin Classic" and "Tesserafin Glass": the manifests, the
registry, both theme pickers, and the comments that describe current behaviour.

`scripts/verify-no-new-reefin.mjs` previously carried these two strings on its **exemption** list as
deferred branding. They have moved to its **denylist**, so the correction cannot silently regress.
That is a strengthening of that gate: nothing it matched before is unmatched now.

Genuinely historical references are preserved and marked as such — `reefin#39` in
`src/ui/tokens/profiles.ts` is a real issue link under the project's former name, and RFC-0001
through RFC-0005 are accepted history and are not rewritten. This RFC supersedes RFC-0005 §7/§8 in
the open, by existing, rather than by editing it.

### 8.4 Why 0007 and not 0006

The published corpus in this repository is RFC-0001 through RFC-0005. `0006` is nevertheless **not
free**: `tesserafin#104` records, in detail and with a dated correction, that RFC-0006 is the
native-client strategy — a real decision (a separate Kotlin Multiplatform repository, web wrappers
rejected) that exists only as an untracked draft and has never been published. Taking `0006` for the
theme platform would collide with a decision the roadmap already cites by number, and renumbering
afterwards is exactly the invisible rewriting of accepted history this project has committed not to
do. `0006` stays reserved for the native-client RFC whenever it is published.

### 8.3 Community themes

There are none yet, so there is no migration burden. A v1 manifest is rejected with a message naming
the version difference, not silently upgraded: silently upgrading would mean guessing at intent for
every field v2 added.

---

## 9. Consequences

**Accepted**: the manifest grew, and the schema is now the security boundary rather than merely a
validation convenience — so loosening it anywhere is a security change and must be reviewed as one.
`additionalProperties: false` is load-bearing, not stylistic.

**Accepted**: three page-composition capabilities and the source layer are published as vocabulary
before the Web renderer implements them. Callers must handle `fallbacks`.

**Rejected**: a parallel v2 theme system beside the existing one. Two systems would mean two
generators, two validators and two definitions of "valid theme", and the second would drift.

**Rejected**: constraining themes to tokens permanently. That is the position this RFC exists to
supersede.

**Deferred**: the third official theme (#142 §B2), package signing, marketplace, and the advanced
source layer's compiler boundary. Each has its own follow-up under the Theme Platform epic.
