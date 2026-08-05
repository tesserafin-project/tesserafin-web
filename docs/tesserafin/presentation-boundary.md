# The modern/legacy presentation boundary

**Status:** maintained. Paired with `src/apps/modern/routes/presentationBoundary.ratchet.test.ts`,
which fails when a slice on this map gains a prohibited dependency **or** keeps a recorded one it no
longer has. The numbers below are that test's baseline; the two change together or CI is red.

**Scope:** Tesserafin Web only. This is a **renderer/application-layer** boundary, not a missing
server capability — see [§1](#1-this-is-a-renderer-boundary-not-a-server-gap).

---

## 1. This is a renderer boundary, not a server gap

`presentation.page.home`, `.library` and `.itemDetails` are unbound because **their routes do not
read a recipe**, not because the server cannot answer something.

The evidence is direct. A page recipe orders and selects sections the route ALREADY renders from
data it ALREADY fetches — Home issues `getUserViews`, `getResumeItems`, `getNextUp` and
`getLatestMedia` today, under every theme, and a recipe that reorders those sections needs no fifth
request. Composition is a client-side ordering of data the client already has.

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
| **Home** | `/home` | yes (4 files) | **yes** | yes | none | **1 — ready, recipe unbound** |
| Library | `/library/:libraryId[/:destination]` | yes (6 files) | no | yes | none | 1 — ready, recipe unbound |
| Theme Studio | `/themestudio` | via direct component imports | no (renders its own resolution) | yes (5 files) | none | 1 — ready |
| Libraries (`movies`, `music`, `tv`, `books`, `boxsets`, `playlists`, `musicvideos`, `mixed`, `livetv`, `homevideos`) | 10 paths | no | no | no | `cardbuilder` (5 files), `mui-internals` (1 file) | **2 — hybrid** |
| Details drawer / preferences / syncPlay | in-route components | no | no | no | none *(MUI components, not MUI internals)* | 2 — hybrid |

`ui/` and `themes/platform/` are themselves clean (baseline `[]`), which is what lets the Home
result be attributed to the route rather than to something below it.

### 3.2 Legacy routes through `toViewManagerPageRoute` (`src/apps/modern/routes/legacyRoutes`)

Eight user routes and four public routes, each a `controller` + `view.html` pair:

`details`, `list`, `lyrics`, `mypreferencescontrols`, `mypreferenceshome`, `mypreferencesplayback`,
`mypreferencessubtitles`, `queue` · `addserver`, `selectserver`, `login`, `forgotpasswordpin`

All **outcome 3**. `details` is the Item Details route — it is a legacy controller today, which is
the single largest fact bearing on which vertical comes next (§6).

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

## 5. What is still open

Four things, and none of them is a server gap:

1. `presentation.page.home`, `.library` and `.itemDetails` — declared, resolved, read by no route.
2. `assets.roles` — declared, unbound, blocked on #117's package format and integrity model. It maps
   a role to a PACKAGE-RELATIVE path, and there is no theme package yet, so there is no file a
   loader could resolve.
3. `source.web.css` — reserved at `kind: "none"`; no isolated compiler boundary exists (RFC-0007 §7).
4. `recommendations`, a section in the Home vocabulary, has no data source in the modern Home route.
   Wiring it needs `/Movies/Recommendations`, and a recipe token whose presence makes a request fire
   would be a theme controlling API queries — forbidden by RFC-0007 §6.1. Offering it always, for
   every theme, is a **product** decision about what Home contains, not a theming one.

### 5.1 The line a page binding must not cross

Whichever route is bound first, the same rule applies: a recipe hides a section; it must never stop
that section's fetch. Home fetches `latestMedia` per library view from a child component, so
"omit the section" and "do not mount the child" are one keystroke apart — and taking that keystroke
would let a theme decide what the client asks the server for.

**Omitting a section is a presentation choice about what is shown; the data-fetch and business
semantics behind it stay unchanged.** If a section should ever stop being fetched, that is a product
decision recorded as such, not a side effect of a theme.

---

## 6. The next vertical: Home, then Library — and Item Details last

**Home** first. It is the only route family already reading `PresentationContext`, its slice has an
empty baseline, and `presentation.page.home`'s vocabulary (section order, shelf density) maps onto
sections `HomeTab` already renders. Binding it needs no migration at all.

**Library** second. Its slice is also outcome 1 — six files on `src/ui`, `--rf-*` tokens, zero
prohibited dependencies — and `presentation.page.library`'s vocabulary (`layout`, `cardAspect`,
`filters`) maps onto controls `LibraryView` already has.

**Item Details** last. It is a legacy `controller` + `view.html` route (§3.2), so binding
`presentation.page.itemDetails` means first rewriting it in modern React on `src/ui` — a migration,
not a binding, and a much larger change with a different risk profile.

Taking them in that order also keeps the `libraries/*` hybrid (§3.1) visible as a separate, later
item rather than folding an unrelated `cardbuilder` migration into a composition change.

---

## 7. Keeping this document true

`presentationBoundary.ratchet.test.ts` enforces §2 and §3.1 mechanically. It scans **each slice's own
source and its direct imports**, not the transitive graph — the module graph is cyclic through the
app shell (`lib/globalize` → `userSettings` → `jellyfin-apiclient` → `dashboard` → `appRouter` →
`RootAppRouter` → every route), so transitive reachability distinguishes nothing. Bundle-graph
weight is a separate concern with a separate gate, `npm run verify:bundle-budget`.

Comments are stripped before matching. `home/utils/mediaCardProps.ts` names
`components/cardbuilder/utils/url.ts` five times, every one of them explaining why it reimplements
that helper instead of importing it.

Sections 3.2–3.6 are read from the route tables and are not ratcheted; they change when a route moves
between `asyncRoutes` and `legacyRoutes`, which is already a visible diff.
