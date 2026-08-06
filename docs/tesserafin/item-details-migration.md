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
| Server selection (`serverId` chooses the client) | `adapters/itemDetailsApi.ts` `getDetailsApiClient` | reads per class |
| Primary read + acting user | `api/useItemDetails.ts` `useItemDetailsPrimary` | reads per class |
| Name, parent and hierarchy | `components/ItemName.tsx` | `episode` links to series and season |
| Image and poster | `components/ItemCollectionGrid.tsx`, `adapters` `scaledImageUrl` | `getScaledImageUrl` in the movie classes' reads |
| Action bar | `components/DetailActionBar.tsx` | actions per class |
| Resume / replay / play / trailer | `hooks/useItemActions.ts` | `itemDetails.actions.test.tsx` |
| Shuffle and instant mix | `hooks/useItemActions.ts` + `utils/itemPredicates.ts` | actions suite, `music-album` |
| Media-source selection | `hooks/useTrackSelection.ts` | selectors per class, actions suite |
| Video / audio / subtitle selection | `hooks/useTrackSelection.ts`, `components/TrackSelections.tsx` | track option/default tests |
| Playstate and rating | `components/DetailActionBar.tsx` (`PlayedButton`/`FavoriteButton`) | userData controls per class |
| Split versions + administrator gate | `utils/itemPredicates.ts` `canSplitVersions` | `movie-grouped-admin` vs `movie-grouped-regular` |
| Context menu and destructive actions | `hooks/useItemActions.ts` `showContextMenu` | actions suite (targets the item) |
| Series / Season / Episode children | `api/useItemDetails.ts` `useDetailChildren`, `components/ItemDetailsView.tsx` | `series`, `season`, `episode` |
| Next Up and More From Season | `useNextUp`, `useMoreFromSeason` | `series`, `episode` |
| Cast, guest cast | `utils/itemPredicates.ts` `splitCast`, `components/PeopleGrid.tsx` | `movie`, `book` |
| Metadata lists (the six former roots) | `components/MetadataLists.tsx` | nested-root count per class |
| Special features, scenes, additional parts | `useSpecialFeatures`, `renderableChapters`, `useAdditionalParts`, `components/SceneGrid.tsx` | `movie` |
| Collections and similar items | `useItemCollections`, `useSimilarItems` | `movie`, `box-set`, `minimal-video` |
| More From Artist, lyrics, music videos | `useMoreFromArtist`, `useLyrics`, `useMusicVideos` | `audio`, `music-album`, `music-artist` |
| Programme / channel guide | `useChannelGuide`, `ProgramGuide` in `ItemDetailsView.tsx` | `tv-channel` |
| Recording fields | `components/RecordingFields.tsx` | `program` (section and `getLiveTvProgram`) |
| Series-timer editor and schedule | `useSeriesTimerSchedule`, `components/ScheduleList.tsx` | `series-timer`, `series-timer-no-livetv` |
| Person biography metadata | `ItemDetailsView.tsx` birthday/death/birthplace blocks | `person` |
| External links, tags, media information | `ItemDetailsView.tsx` + `PrimaryMediaInfo`/`SecondaryMediaInfo` | `movie`, `program` |
| Loading / empty / malformed / failure | `components/ItemDetailsPage.tsx` | state tests |
| Websocket user-data refresh | `hooks/useUserDataRefresh.ts` | actions suite (matching item only) |
| Route-change cancellation and cleanup | React Query keys + effect cleanup | subscription lifecycle test |

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
| D14 | `apiClient.serverId()` is no longer touched | all 24 | Its only caller was `components/cardbuilder/cardImage`, which invariant 11 forbids. `item.ServerId` is already on the DTO, so calling it would be a fake call made to keep a test green. The poster still renders (`MUST PRESERVE` #9), through `getScaledImageUrl`. |
| D15 | `movie-resumable`, `movie-grouped-admin` and `movie-grouped-regular` no longer show an empty specials section | 3 classes | `SUSPECT` #10 — the section was revealed from `SpecialFeatureCount` before the fetch resolved. Rendering it from the result is `MUST PRESERVE` #10 applied to the surface that violated it. |
| D17 | The slice owns a stylesheet, `components/ItemDetailsView.scss`, on `--rf-*` tokens | all 24 | The first cut shipped with no layout at all and the owner rejected it. No legacy class name is reused: `.detailPagePrimaryContent`, `.detailImageContainer`, `.detailLogo` and friends stay dead, because resurrecting them to get styling back would make a legacy selector this route's public styling surface (invariant 8). Layout is keyed on a `hero`/`full` slot rather than on section names, so no rule turns a section name into something a theme could target. |
| D18 | The item's poster, logo and backdrop are rendered by `components/DetailImage.tsx` | all 24 | `MUST PRESERVE` #9 had **no owner** in the first cut: the route rendered no item image and every section assertion stayed green, because `.detailImageContainer` was a template element rather than a named section in the frozen record. It is now asserted per class, and `Person`/`Book` are asserted to render no backdrop. |
| D16 | Eight classes gain a section heading P5 could not see | `series`, `episode`, `music-album`, `music-artist`, `playlist`, `person`, `genre`, `music-genre` | `MAY CHANGE` #1. The legacy children/more-from titles were written into elements that carried no `.sectionTitle` class, so the P5 reader missed them; every section now has a real `h2`. Enumerated exactly in the migrated suite's `HEADING_ADDITIONS`. |

Apart from D14 and D15, both named above and both asserted as exact per-class exceptions, no delta
removes a section, an action, a selector, a user-data control, a permission gate or a read from any
of the 24 classes. That is what the migrated suite verifies class by class.

---

## 7. What the frozen fixture could not see

The frozen record names sections by the DOM ids the legacy TEMPLATE declared, and
`VIEW_SECTION_ORDER` was built from that template. Anything the controller rendered into an element
that was not in that list was invisible to P5's reader — and therefore invisible to a migration
judged only by it.

The first cut of this migration shipped with **no item artwork at all** and passed every one of the
24 section assertions. The owner caught it by looking at a screenshot. Three surfaces were in that
blind spot:

| Surface | Legacy owner | Now |
| --- | --- | --- |
| Poster | `renderImage` → `.detailImageContainer` | `DetailImage`, asserted per class |
| Logo | `renderLogo` → `.detailLogo` | `DetailImage`, asserted to be absent when the item declares none |
| Backdrop | `renderHeaderBackdrop` / `renderBackdrop` | `DetailImage`, asserted absent for `Person` and `Book` |

The lesson is recorded rather than just fixed: a section list is evidence about which BLOCKS
appear, not about whether the page is complete. `MUST PRESERVE` entries that name no section need
their own assertion, and now have one.

---

## 8. Deferred, and why

**Item Details-only CSS in shared stylesheets.** `.detailPagePrimaryContent`,
`.detailPageSecondaryContainer`, `.detailImageContainer`, `.detailLogo` and `.detailPageContent` have
no remaining non-stylesheet reference. They live inside `src/styles/librarybrowser.scss` and
`src/themes/purplehaze/theme.scss` — shared files, not an Item Details stylesheet — so removing them
is a stylesheet edit rather than a file deletion. Recorded here rather than done silently; the
reference check that proves them dead is reproducible with
`git ls-files | xargs grep -l <selector>`.
