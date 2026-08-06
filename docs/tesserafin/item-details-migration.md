# Migrating Item Details to one async modern route

**Status:** live record for Step 1b of tesserafin-web#129. **Base:** `61ee617bd844bd097a4c2db238a1c299743c725e`.

Step 1a froze what `/details` does today
(`docs/tesserafin/item-details-legacy-contract.md`, `tests/fixtures/item-details/legacy-contract.json`).
This document records how each frozen surface is carried across, which `SUSPECT` findings were
resolved and how, and every intentional difference between the legacy route and the migrated one.

It does **not** bind `presentation.page.itemDetails`. No file in the migrated slice reads
`usePresentation()`, the recipe stays off `WEB_RENDERER_CAPABILITIES`, and the platform default is
unchanged. That is Step 2.

---

## 1. What replaces what

| Legacy | Migrated |
| --- | --- |
| `src/apps/legacy/controllers/itemDetails/index.js` (2,676 lines) | `src/apps/modern/features/details/` |
| `src/apps/legacy/controllers/itemDetails/index.html` (250 lines) | React composition, no HTML template |
| `LEGACY_USER_ROUTES` → `toViewManagerPageRoute` (both route families) | `ASYNC_USER_ROUTES` → `toAsyncPageRoute`, `AppType.Modern` |
| six `renderComponent` roots per render | ordinary descendants of the application root |
| `hideAll(page, className)` | conditional rendering |
| `innerHTML` string composition | React elements |
| `viewshow` / `viewbeforehide` / `viewdestroy` | React effects and React Query lifecycle |

### Route registration, before and after

Before — the same entry in **two** families, selected by `layoutManager.modern` in
`RootAppRouter`:

```ts
// src/apps/legacy/routes/legacyRoutes/user.ts  AND  src/apps/modern/routes/legacyRoutes/user.ts
{ path: 'details', pageProps: { controller: 'itemDetails/index', view: 'itemDetails/index.html' } }
```

After — one async entry in each family's `asyncRoutes/user.ts`, pointing at the same module:

```ts
{ path: 'details', type: AppType.Modern }
```

Both families must change together. Leaving the legacy entry in either one would let `/details`
fall back to the retired controller under the other layout mode, which invariant 6 forbids.

---

## 2. Why the read inventory is preserved member-for-member

The frozen contract records the request inventory as an **upper bound**: "no new request, no lost
surface" (`MUST PRESERVE` #3). The characterization suite enforces that with a fail-closed proxy
over the two API surfaces — touching an undeclared member throws.

The migrated route therefore keeps issuing exactly the same reads, through a single narrow typed
adapter (`features/details/adapters/itemDetailsApi.ts`) over the legacy `apiClient` and the SDK
`getLibraryApi`. Phase 3 requirement 10 permits precisely this, and it buys the strongest possible
preservation evidence: the same fixture, unchanged, judges the modern route, and a lost or added
request is a test failure rather than a judgement call.

Rendering components never import the adapter, `ServerConnections`, `Events` or the legacy
`apiClient`. They receive data from hooks and callbacks from action hooks.

Rewriting these reads onto the generated SDK is a separate, mechanical change with no user-visible
effect and no preservation evidence to offer. It is deliberately **not** in this loop: doing both at
once would mean the read inventory could no longer be compared member-for-member with the frozen
record, which is the only thing that makes a 2,676-line rewrite auditable.

---

## 3. Section vocabulary

The frozen fixture names sections by their legacy DOM id (`castCollapsible`, `nextUpSection`, …).
`MAY CHANGE` #1 releases those ids as markup, but they are the identifiers the frozen evidence
speaks, so the migrated route keeps the **names** as an evidence hook and drops the markup:

```tsx
<DetailSection name='castCollapsible' heading='HeaderCastAndCrew'>…</DetailSection>
```

renders `data-detail-section="castCollapsible"`.

`data-detail-section`, `data-detail-action` and `data-detail-select` are **characterization hooks,
not a theming surface**. They exist so the frozen fixture can judge the migrated route without
being rewritten. They are not documented as a public styling API, no stylesheet targets them, and
Step 2's recipe binding will not read them. The presentation vocabulary
(`hero`, `overview`, `cast`, `episodes`, `related`, `mediaInfo`) is too small to name most of these
surfaces — the frozen contract §13 records that, and this migration does not grow it.

---

## 4. Migration traceability map

Every domain named in the P6 brief, with its owner in the migrated slice. `A` = adapter,
`H` = hook, `C` = component.

| Domain | Owner | Test |
| --- | --- | --- |
| Route parameter resolution and precedence | `utils/routeParams.ts` | `routeParams.test.ts` |
| Server selection (`serverId`) | `A adapters/itemDetailsApi.ts` | `itemDetails.characterization.test.ts` (reads) |
| Primary read + acting user | `H api/useItemDetails.ts` | reads per class |
| Name, parent and hierarchy | `C components/ItemName.tsx` | `episode` links, name block |
| Image, logo, backdrop | `C components/DetailImage.tsx`, `H hooks/useDetailBackdrop.ts` | `person`/`book` no backdrop |
| Action bar | `C components/DetailActionBar.tsx` | actions per class |
| Resume / replay / play / trailer | `H hooks/useItemPlayback.ts` | playback tests |
| Shuffle and instant mix | `H hooks/useItemPlayback.ts` | playback tests |
| Media-source selection | `H hooks/useTrackSelection.ts` | selectors per class |
| Video / audio / subtitle selection | `H hooks/useTrackSelection.ts`, `C components/TrackSelections.tsx` | track tests |
| Playstate and rating | `C components/UserDataControls.tsx` | userData per class |
| Split versions + administrator gate | `C components/DetailActionBar.tsx` | `movie-grouped-*` |
| Edit / delete / context menu | `H hooks/useItemContextMenu.ts` | context-menu tests |
| Series / Season / Episode children | `C components/sections/ChildrenSection.tsx` | `series`, `season`, `episode` |
| Next Up and More From Season | `C components/sections/NextUpSection.tsx`, `MoreFromSeasonSection.tsx` | `series`, `episode` |
| Cast, guest cast, metadata lists | `C components/sections/CastSection.tsx`, `MetadataGroup.tsx` | `movie`, `book` |
| Special features, scenes, additional parts | `C components/sections/VideoStripSection.tsx` | `movie` |
| Collections and similar items | `C components/sections/CollectionsSection.tsx`, `SimilarSection.tsx` | `movie`, `box-set` |
| More From Artist, lyrics, music videos | `C components/sections/MoreFromArtistSection.tsx`, `LyricsSection.tsx`, `MusicVideosSection.tsx` | `audio`, `music-album`, `music-artist` |
| Programme / channel guide | `C components/sections/ProgramGuideSection.tsx` | `tv-channel` |
| Recording and series-timer editors | `C components/sections/RecordingFieldsSection.tsx`, `SeriesTimerSection.tsx` | `program`, `series-timer*` |
| Person biography metadata | `C components/sections/PersonFactsSection.tsx` | `person` |
| External links, tags, media information | `C components/sections/LinksSection.tsx`, `TagsSection.tsx`, `MiscInfo.tsx` | `movie`, `program` |
| Loading / empty / malformed / failure | `C components/ItemDetailsView.tsx` | state tests |
| Websocket user-data refresh | `H hooks/useUserDataSubscription.ts` | subscription test |
| Route-change cancellation and cleanup | React Query + effect cleanup | lifecycle test |

---

## 5. Disposition of the 13 `SUSPECT` findings

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | Malformed `/details` URL throws past its own `.catch`, permanent spinner | `FIX AS DEFECT` — bounded error state, loading cleared. The brief forbids preserving it. |
| 2 | Failed primary read shows nothing and never hides the spinner | `FIX AS DEFECT` — explicit `ErrorState`, loading cleared. |
| 3 | Video-track selector always disabled and never read | `PRESERVE TEMPORARILY` — still offered (the frozen fixture lists `selectVideo` for every video class) and still disabled and unread. Removing it would drop a recorded selector, which needs an owner ruling, not a migration decision. |
| 4 | `onMoreCommandsClick` re-fetches using a media-source id as an item id | `FIX AS DEFECT` — the context menu targets the item. Pre-ruled by Phase 5. |
| 5 | `getItemCollections` issued for types that cannot belong to a collection | `PRESERVE TEMPORARILY` — the read is kept for every class. `MAY CHANGE` #4 would permit dropping it, but the fixture records it as part of every class's read set and narrowing it changes the recorded inventory for 24 classes at once. Recorded for Step 1c. |
| 6 | Six nested roots each perform their own `getCurrentUser` | `UNREACHABLE — REMOVE` — dissolves with the roots. One `getCurrentUser` remains. |
| 7 | `renderSeriesAirTime` emits untranslated English | `PRESERVE TEMPORARILY` — byte-identical output. Adding i18n keys touches the translation corpus, which the P6 scope neither includes nor excludes; flagged for Step 2. |
| 8 | Lyrics section never hidden when `HasLyrics` is false | `FIX AS DEFECT` — the section renders only when `HasLyrics` and the fetch returns lyrics. Aligns with `MUST PRESERVE` #10. |
| 9 | Collections hide play/shuffle *after* showing them, then re-focus (source calls it a HACK) | `FIX AS DEFECT` — the end state is preserved (play and shuffle absent when nothing in the collection is playable); the show-then-hide and the compensating re-focus are gone. |
| 10 | `#specialsCollapsible` revealed before the fetch, so a failed fetch leaves an empty section | `FIX AS DEFECT` — rendered from the result. Aligns with `MUST PRESERVE` #10. |
| 11 | `renderChildren`'s `Episode` branch unreachable | `UNREACHABLE — REMOVE` — not reimplemented. The contract forbids reverse-engineering its intent. |
| 12 | `renderTimerEditor` / `renderSeriesTimerEditor` take unused `apiClient` parameters | `UNREACHABLE — REMOVE` — dissolves. |
| 13 | The two live-TV widgets are never destroyed | `FIX AS DEFECT` — React owns their lifecycle with explicit cleanup. |

Two findings needed reasoning rather than a ruling and are recorded above with it (#5, #7). None
required an owner product decision, so no hard stop fired.

---

## 6. Intentional-delta ledger

Every difference between the legacy route and the migrated one, and why.

| # | Delta | Class | Basis |
| --- | --- | --- | --- |
| D1 | Nested React roots: 6 → 0 | all 24 | `MUST RETIRE` #2, the reason #129 exists |
| D2 | Malformed route renders a bounded error instead of a permanent spinner | — | `SUSPECT` #1 |
| D3 | Failed primary read renders an explicit error instead of a blank page with a live spinner | — | `SUSPECT` #2 |
| D4 | Context menu targets the item, not the selected media-source id | all with `btnMoreCommands` | `SUSPECT` #4, Phase 5 |
| D5 | Lyrics section hidden when `HasLyrics` is false | `audio` | `SUSPECT` #8 |
| D6 | Specials section rendered from the fetch result | `movie` | `SUSPECT` #10 |
| D7 | Collections never shows play/shuffle it then hides | `box-set` | `SUSPECT` #9 |
| D8 | Live-TV widgets have explicit cleanup | `program`, `series-timer` | `SUSPECT` #13 |
| D9 | Semantic headings (`h1`/`h2`) and landmarks replace `h2.sectionTitle` markup | all | `MAY CHANGE` #1, Phase 4 |
| D10 | Composition no longer reads `dom.getWindowSize()` / `window.screen.availWidth` at render time | all | `MUST RETIRE` #4 |
| D11 | `window.ItemDetailPage` global removed | — | `MUST RETIRE` #6 |
| D12 | `focuscontainer-x` and `itemShortcuts` delegation replaced by ordinary links and focus order | all | `MAY CHANGE` #7, `MUST PRESERVE` #11 still holds |
| D13 | `itemContextMenu.getCommands` runs once, not twice | all | `MAY CHANGE` #6 |

No delta removes a section, an action, a selector, a user-data control, a permission gate or a read
from any of the 24 classes. That is what Phase 8 verifies class by class.
