# The modern/legacy presentation boundary

**Status:** maintained. Paired with `tests/boundary/presentationBoundary.ratchet.test.ts`,
which fails when a slice on this map gains a prohibited dependency **or** keeps a recorded one it no
longer has. The numbers below are that test's baseline; the two change together or CI is red.

**Scope:** Tesserafin Web only. This is a **renderer/application-layer** boundary, not a missing
server capability — see [§1](#1-this-is-a-renderer-boundary-not-a-server-gap).

---

## 1. This is a renderer boundary, not a server gap

Every `presentation.*` capability the contract defines is now implemented by the Web renderer. Each
was unbound because **its route did not read a recipe**, never because the server could not answer
something — and each was bound with **no server change at all**.

The evidence is now direct three times over: `presentation.page.home`, `.library` and
`.itemDetails` were all bound with no server change. Home issues `getUserViews`, `getResumeItems`,
`getNextUp` and `getLatestMedia` under every theme; Library issues `getItems`, `getStudios` and
`getQueryFiltersLegacy` with identical parameters under every recipe, which
`LibraryView.recipe.test.tsx` asserts as a full request ledger. Composition is a client-side
arrangement of data the client already has, and Item Details is the same shape of problem: React
work inside `src/apps/modern`, not API work.

Nothing in the theme contract reaches the server either. `theme.json` is a static document; the
manifest lookup (`src/themes/platform/manifests.ts`) imports it at build time; the applied local
draft lives in `localStorage`. There is no theme endpoint to add, and none of the three page
capabilities would need one.

---

## 2. What a "prohibited dependency" is here, and what it is not

A dependency is prohibited when relying on it would **leak into the theme contract** — when shaping
that route would require a theme author to target something the platform has not published.

| Prohibited | Why it would leak |
|---|---|
| `components/cardbuilder/*` | imperative card DOM; its classes are not a published theming surface |
| `renderComponent` (nested React roots) | a subtree mounted outside the tree is invisible to `PresentationContext`, so it silently misses the resolved presentation |
| `@jellyfin/ux-web` assets | inherited third-party art, not a Tesserafin asset role |
| `themes/<id>/theme.scss` imported by a route | bypasses the token pipeline; the route would be styled by a file, not by tokens |
| `@mui/material/styles`, `@mui/base`, `@mui/private-*` | generated MUI class names are not a stable public API |
| `scripts/themeManager` event path | predates `PresentationContext` and cannot report a capability fallback |

**Explicitly NOT prohibited**, and deliberately left in place:

| Inherited dependency | Why it is harmless to composition |
|---|---|
| `components/Page` | app-shell page wrapper; contributes no theming surface a recipe touches |
| `scripts/libraryMenu.setTitle` | sets the document title; not presentation |
| the `.skinHeader.noHomeButtonHeader` class toggle in `routes/home.tsx` | a shell concern, tracked by RFC-0005 §4.2's own TODO |
| `mainAnimatedPage homePage libraryPage allLibraryPage` on `<Page>` | historical classes on the shell wrapper, not on any element a recipe orders |

The decisive fact for all four: **`renderers.web.source.kind` is `"none"`**. The schema accepts no
other value, so a theme cannot author CSS or a selector at all. A legacy class name that no theme
can address is not part of the theme contract, whatever else it is. Removing them is app
modernisation with its own justification — it is not a prerequisite for page composition, and
treating it as one would have turned a bounded vertical into an unbounded rewrite.

---

## 3. Route matrix

Three outcomes:

1. **theme-platform ready** — modern React, `src/ui` primitives, `--rf-*` tokens, no prohibited
   dependency. Composable now or composable as soon as its route reads a recipe.
2. **hybrid, bounded migration required** — modern React, but with at least one prohibited
   dependency that must go before a recipe can govern it.
3. **legacy, not safely theme-composable yet** — rendered through `toViewManagerPageRoute` and the
   view-manager/controller path.

### 3.1 Modern React routes (`src/apps/modern`)

| Route family | Paths | `src/ui` | `Presentation Context` | `--rf-*` | Prohibited | Outcome |
|---|---|---|---|---|---|---|
| **Home** | `/home` | yes (5 files) | **yes** | yes | none | **1 — ready, and BOUND** |
| **Library** | `/library/:libraryId[/:destination]` | yes (7 files) | **yes** | yes | none | **1 — ready, and BOUND** |
| Theme Studio | `/themestudio` | via direct component imports | no (renders its own resolution) | yes (5 files) | none | 1 — ready |
| Libraries (`movies`, `music`, `tv`, `books`, `boxsets`, `playlists`, `musicvideos`, `mixed`, `livetv`, `homevideos`) | 10 paths | no | no | no | `cardbuilder` (5 files), `mui-internals` (1 file) | **2 — hybrid** |
| Details drawer / preferences / syncPlay | in-route components | no | no | no | none *(MUI components, not MUI internals)* | 2 — hybrid |

`ui/` and `themes/platform/` are themselves clean (baseline `[]`), which is what lets the Home and
Library results be attributed to the routes rather than to something below them.

Library's `filters: 'drawer'` surface is `ui/components/FilterDrawer`, a new `src/ui` primitive
rather than MUI's `Drawer`. That choice is what kept the baseline empty: a MUI drawer would have put
`.MuiDrawer-paper` and `.MuiBackdrop-root` on the one element the recipe produces, and a theme
author wanting to shape it would have had nothing else to target — a generated class name becoming
the theme API, which §2 prohibits.

### 3.2 Legacy routes through `toViewManagerPageRoute` (`src/apps/modern/routes/legacyRoutes`)

Eight user routes and four public routes, each a `controller` + `view.html` pair:

`details`, `list`, `lyrics`, `mypreferencescontrols`, `mypreferenceshome`, `mypreferencesplayback`,
`mypreferencessubtitles`, `queue` · `addserver`, `selectserver`, `login`, `forgotpasswordpin`

All **outcome 3** — except `details`, which left this list in #129 Step 1b. The Item Details route
is modern React on `src/ui` (`apps/modern/features/details`), registered through
`toAsyncPageRoute`, and it reads `presentation.page.itemDetails` at its composition boundary since
#129 Step 2. Seven legacy user routes and four public routes remain.

### 3.3 Hybrid route

`/video` (`routes/video.tsx`) — modern controls mounted over the legacy playback view. **Outcome 3**
for composition purposes: playback presentation is out of theme scope entirely (RFC-0007 §6.1).

### 3.4 Dashboard (`src/apps/dashboard`)

29 async routes, 2 legacy. Modern React on MUI, not on `src/ui`, and no `--rf-*`. **Outcome 2**, and
low priority: administration is not a themed surface in the product sense.

### 3.5 Onboarding wizard (`src/apps/wizard`)

Six routes, all `toViewManagerPageRoute` (`start`, `user`, `library`, `settings`, `remoteaccess`,
`finish`). **Outcome 3**. Out of theme scope: a first-run flow must render before any theme choice
exists.

### 3.6 Playback and settings

Playback (`queue`, `/video`, `plugins/bookPlayer`) and preferences (`mypreferences*`) are outcome 3
and stay there. A theme may not control playback behaviour or account/security UI at all
(RFC-0007 §6.1), so migrating them buys nothing for the theme platform.

---

## 4. Where `@jellyfin/ux-web` still is

Not in any route. Three call sites, all inherited:

- `src/themes/_base/_theme.scss` and `src/themes/purplehaze/theme.scss` — banner/icon art in
  **legacy colour presets**, which declare no manifest at all;
- `src/components/toolbar/ServerButton.tsx` — one icon import.

Neither official theme references it. Replacing it is the `assets.roles` work in **#117**, which
needs a package format and an integrity model first — see §5.

---

## 5. What the Home vertical proves, and what is still open

**Proves.** A theme can order and select a live page's sections and set its shelf density, and that
choice survives Apply → reload → reset. Demonstrated in a real browser against a seeded Tesserafin
server (`tests/e2e/home-composition.spec.ts`):

```
official  My Media · Continue Watching · Next Up · Recently Added in Movies · Recently Added in Shows
applied   Harbour Lights (hero) · Continue Watching · Next Up · Recently Added x2 · My Media
```

with no server change, no `if (themeId === …)` anywhere in `ui/` or `apps/modern/features/home/`,
no legacy selector exposed as public theme API, and no change to the requests the page issues.

**Still open.** Three things, and none of them is a server gap. The `presentation.page.*` entry
that used to head this list is gone: Home, Library and Item Details are all bound.

1. `assets.roles` — declared, unbound, blocked on #117's package format and integrity model. It maps
   a role to a PACKAGE-RELATIVE path, and there is no theme package yet, so there is no file a
   loader could resolve.
2. `source.web.css` — reserved at `kind: "none"`; no isolated compiler boundary exists (RFC-0007 §7).
3. `recommendations`, a section in the Home vocabulary, has no data source in the modern Home route.
   Wiring it needs `/Movies/Recommendations`, and a recipe token whose presence makes a request fire
   would be a theme controlling API queries — forbidden by RFC-0007 §6.1. Offering it always, for
   every theme, is a **product** decision about what Home contains, not a theming one.

### 5.1 Composition is not a ranking engine

A recipe hides a section; it never stops that section's fetch. Home fetches `latestMedia` per
library view from a child component, so "omit the section" and "do not mount the child" are one
keystroke apart — and taking that keystroke would let a theme decide what the client asks the server
for. `LatestMediaSection` is therefore mounted even when the recipe omits it, `hidden`: it renders
nothing and still issues its per-view query.

The hero follows the same rule in the other direction. It is composed from Continue Watching / Next
Up data the page already has, it issues no query of its own, and the featured item is **not** removed
from its shelf — de-duplicating would mean the presence of `hero` in a recipe changed the contents
of another section.

**Omitting a section is a presentation choice about what is shown; the data-fetch and business
semantics behind it stay unchanged.** If a section should ever stop being fetched, that is a product
decision recorded as such, not a side effect of a theme.

---

## 6. The three verticals, and what each cost

**Home** is done — it needed no migration at all.

**Library** is done, and it needed none either. `presentation.page.library`'s vocabulary (`layout`,
`cardAspect`, `filters`) mapped onto controls `LibraryView` already had, the slice stayed at
baseline `[]`, and the platform default reproduced the pre-binding composition exactly — checked
against the route rather than assumed, after Home's default turned out to be wrong.

The invariant Library added to Home's is the one its server-side pagination made necessary:
**a recipe may not change the catalogue query or its result**. `LibraryView.recipe.test.tsx` compares
a full request LEDGER — endpoint and every parameter, including `startIndex`, `limit`, sort field
and order, and each filter — across six recipes plus a malformed record, and compares the rendered
item IDs in order on top of it. Home's ledger compared endpoint names only, which would not have
caught a shelf layout quietly asking for a smaller page.

**Item Details** is done, and it cost by far the most, because it was a **migration before it was a
binding**. It was a legacy `controller` + `view.html` route and one of the four `renderComponent`
call sites in the repository, so #129 took it in four steps: inventory the legacy contract (1a),
rewrite it in modern React on `src/ui` (1b), freeze its complete request and action ledger (1c),
and only then bind the recipe (2). Splitting it that way is what kept a bounded vertical from
becoming an unbounded rewrite.

Step 2 added two invariants to Home's and Library's, both forced by how much product surface this
route carries:

- **a derived vocabulary, not an exposed one.** The migrated route names 33 surfaces with private
  `data-detail-section` hooks. Publishing those as theme vocabulary would have made a Web DOM
  detail into a cross-platform contract, so the eleven published families are derived from what
  those surfaces MEAN, and `utils/itemDetailsRecipe.ts` is the only place the two vocabularies
  meet. The derivation is proven per item type rather than per fixture, so it also covers the four
  surfaces no equivalence class exercises.
- **fixed regions are structural.** Playback, the track selectors, the user-data controls, the
  recording editor, permission gates and required warnings are not merely "not offered" — the
  published enum cannot name them, so no recipe can reach one.

The Web renderer's `presentation.*` surface is now complete. What is left (§5) is `assets.roles`,
`source.web.css` and one Home data source, and none of the three is a composition problem.

Taking the three in this order kept the `libraries/*` hybrid (§3.1) visible as a separate, later
item rather than folding an unrelated `cardbuilder` migration into a composition change. None of
the three bindings touched it.

---

## 7. Keeping this document true

`tests/boundary/presentationBoundary.ratchet.test.ts` enforces §2 and §3.1 mechanically. It scans **each slice's own
source and its direct imports**, not the transitive graph — the module graph is cyclic through the
app shell (`lib/globalize` → `userSettings` → `jellyfin-apiclient` → `dashboard` → `appRouter` →
`RootAppRouter` → every route), so transitive reachability distinguishes nothing. Bundle-graph
weight is a separate concern with a separate gate, `npm run verify:bundle-budget`.

Comments are stripped before matching. `home/utils/mediaCardProps.ts` names
`components/cardbuilder/utils/url.ts` five times, every one of them explaining why it reimplements
that helper instead of importing it.

Sections 3.2–3.6 are read from the route tables and are not ratcheted; they change when a route moves
between `asyncRoutes` and `legacyRoutes`, which is already a visible diff.
