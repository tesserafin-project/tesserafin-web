# The legacy Item Details contract, before migration

**Status:** frozen record. **Scope:** Step 1a of tesserafin-web#129.

This document records what `/details` does **today**, as measured, so that the React rewrite in
Step 1b can be judged against a fact instead of a memory. It changes nothing. It does not migrate
the route, does not create a modern route, does not bind `presentation.page.itemDetails`, and does
not touch `WEB_RENDERER_CAPABILITIES`, the theme schema, the recipes or the delivery budgets.

Everything below was produced by executing the production controller
(`src/apps/legacy/controllers/itemDetails/index.js`, 2,676 lines) against its own
`index.html`, with the two API surfaces behind fail-closed proxies. The executable form of the same
record is `tests/fixtures/item-details/legacy-contract.json`, asserted by
`tests/itemDetails/itemDetails.characterization.test.ts` and kept in step with this document by
`tests/itemDetails/legacyContract.consistency.test.ts`.

A finding here is classified as one of:

| Class | Meaning |
| --- | --- |
| `MUST PRESERVE` | Observable product behaviour that has to survive the migration. |
| `MAY CHANGE` | Implementation or presentation detail with no product guarantee. |
| `MUST RETIRE` | A legacy mechanism the migration exists to remove. |
| `SUSPECT` | Current behaviour that must not silently become normative. A decision is required. |

---

## 1. Route inputs and resolution rules

`/details` is registered as a **view-manager page**, not a React route. The same entry appears in
both `src/apps/legacy/routes/legacyRoutes/user.ts` and `src/apps/modern/routes/legacyRoutes/user.ts`;
`RootAppRouter` picks one set by `layoutManager.modern`, so the route resolves identically in both
layouts:

```ts
{ path: 'details', pageProps: { controller: 'itemDetails/index', view: 'itemDetails/index.html' } }
```

`ViewManagerPage` imports the controller and the template, runs the template through
`globalize.translateHtml`, and constructs `new controllerFactory(view, params)`.

### Parameter resolution

`getPromise(apiClient, params)` picks the primary lookup by **first match**, in this order:

| Parameter | Primary read |
| --- | --- |
| `id` | `apiClient.getItem(currentUserId, id)` |
| `seriesTimerId` | `apiClient.getLiveTvSeriesTimer(seriesTimerId)` |
| `genre` | `apiClient.getGenre(genre, currentUserId)` |
| `musicgenre` | `apiClient.getMusicGenre(musicgenre, currentUserId)` |
| `musicartist` | `apiClient.getArtist(musicartist, currentUserId)` |
| none of the above | `throw new Error('Invalid request')` |

Two further parameters are read but never select a lookup:

- `serverId` — chooses the API client (`ServerConnections.getApiClient(serverId)`), otherwise
  `ServerConnections.currentApiClient()`.
- `context` — forwarded into card and link URL building only. It never changes which requests are
  issued. Note that the nested metadata lists ignore it and use `inferContext(item)` instead
  (`index.js:1224`), so the two can disagree.

`MUST PRESERVE` — the parameter set, the precedence order, and the fact that `serverId` selects the
server rather than the item.

`SUSPECT` — the no-match case. `getPromise` throws **synchronously**, while the argument array of
`Promise.all([...])` in `reload()` is still being evaluated, so the exception escapes past the
`.catch` that was written to handle it. `loading.show()` has already run and `loading.hide()` never
does: a malformed `/details` URL leaves a permanent spinner. This is a defect, not a contract.

### `musicartist` is unreachable in practice

`musicartist` is in the resolution table and has no corresponding equivalence class below, because
no tracked call site builds a `/details?musicartist=` URL — `appRouter.getRouteUrl` routes
`MusicArtist` items by `id`. The branch is recorded as present and **untested**; it is not evidence
of a supported entry point.

---

## 2. Behavioural equivalence-class matrix

Classes were derived from the controller's own branch sites — `getPromise`, `reloadPlayButtons`,
`renderTrackSelections`, `setInitialCollapsibleState`, `renderChildren`, `renderSimilarItems`,
`renderMoreFromSeason`, `renderMoreFromArtist`, `renderChannelGuide`, `renderLyricsContainer`,
`renderSeriesTimerEditor`, `renderTimerEditor`, `showRecordingFields`, `renderHeaderBackdrop`,
`setPeopleHeader` and the Person-specific blocks in `reloadFromItem` — not from intuition about
item types.

Two collapses are asserted rather than assumed:

- **`Studio` collapses into `genre`.** Both fall into the same
  `Studio | Person | Genre | MusicGenre | MusicArtist` arm of `setInitialCollapsibleState` and
  neither adds instant mix in `reloadPlayButtons`. `Person` does **not** collapse with them: it
  additionally suppresses the header backdrop and renders birth/death/birthplace lines.
- **`Video`, `MusicVideo` and `Trailer` collapse into `movie`.** All are non-folder `MediaType:
  Video` items; `MusicVideo` differs only in which parent name `renderName` emits, which is a
  naming rule (§4), not a composition rule.

`MusicGenre` is kept separate from `genre` because `reloadPlayButtons` enables instant mix for it
and not for `Genre`.

| Class | Item types | Route parameter | Platform-default comparison |
| --- | --- | --- | --- |
| `movie` | `Movie`, `Video`, `MusicVideo`, `Trailer` | `id` | `MISMATCH` |
| `movie-resumable` | `Movie` | `id` | `MISMATCH` |
| `minimal-video` | `Movie` | `id` | `MISMATCH` |
| `series` | `Series` | `id` | `MISMATCH` |
| `season` | `Season` | `id` | `MISMATCH` |
| `episode` | `Episode` | `id` | `MISMATCH` |
| `music-album` | `MusicAlbum` | `id` | `NOT APPLICABLE` |
| `audio` | `Audio` | `id` | `NOT APPLICABLE` |
| `music-artist` | `MusicArtist` | `id` | `NOT APPLICABLE` |
| `playlist` | `Playlist` | `id` | `NOT APPLICABLE` |
| `box-set` | `BoxSet` | `id` | `MISMATCH` |
| `person` | `Person` | `id` | `MISMATCH` |
| `book` | `Book` | `id` | `NOT APPLICABLE` |
| `photo` | `Photo` | `id` | `NOT APPLICABLE` |
| `program` | `Program` | `id` | `MISMATCH` |
| `recording` | `Recording` | `id` | `MISMATCH` |
| `series-timer` | `SeriesTimer` | `seriesTimerId` | `NOT APPLICABLE` |
| `tv-channel` | `TvChannel` | `id` | `NOT APPLICABLE` |
| `genre` | `Genre`, `Studio` | `genre` | `NOT APPLICABLE` |
| `music-genre` | `MusicGenre` | `musicgenre` | `NOT APPLICABLE` |

---

## 3. Ordered pre-migration composition

Sections are listed by their stable view identifier, in document order, as measured. Headings resolve
to their translation key, so `HeaderCastAndCrew` is the identity of that section — not its English
wording.


#### `movie`

Playable standalone video with every optional surface present.

1. `nameContainer`
1. `mainDetailButtons`
1. `trackSelections`
1. `tagline`
1. `overview`
1. `itemTags`
1. `itemExternalLinks`
1. `itemDetailsGroup`
1. `additionalPartsCollapsible`
1. `castCollapsible`
1. `guestCastCollapsible`
1. `specialsCollapsible`
1. `scenesCollapsible`
1. `collectionsCollapsible`
1. `similarCollapsible`

- Headings, in order: `HeaderAdditionalParts`, `HeaderCastAndCrew`, `HeaderGuestCast`, `SpecialFeatures`, `HeaderScenes`, `Collections`, `HeaderMoreLikeThis`
- Actions, in order: `btnPlay`, `btnPlayTrailer`, `btnPlaystate`, `btnUserRating`, `btnMoreCommands`
- Selectors: `selectAudio`, `selectSource`, `selectSubtitles`, `selectVideo`
- User-data controls bound to the item: `btnPlaystate`, `btnUserRating`
- Legacy reads: `getAdditionalVideoParts`, `getCurrentUser`, `getCurrentUserId`, `getItem`, `getScaledImageUrl`, `getSimilarItems`, `getSpecialFeatures`, `serverId`, `subscribe`
- SDK reads: `getItemCollections`
- Nested React roots: 6 mounted, 6 unmounted on `viewdestroy`

#### `movie-resumable`

Same class as `movie`, with a non-zero resume position and no optional list results.

1. `nameContainer`
1. `mainDetailButtons`
1. `trackSelections`
1. `tagline`
1. `overview`
1. `itemTags`
1. `itemExternalLinks`
1. `itemDetailsGroup`
1. `castCollapsible`
1. `guestCastCollapsible`
1. `specialsCollapsible`
1. `scenesCollapsible`

- Headings, in order: `HeaderCastAndCrew`, `HeaderGuestCast`, `SpecialFeatures`, `HeaderScenes`
- Actions, in order: `btnPlay`, `btnReplay`, `btnPlayTrailer`, `btnPlaystate`, `btnUserRating`, `btnMoreCommands`
- Selectors: `selectAudio`, `selectSource`, `selectSubtitles`, `selectVideo`
- User-data controls bound to the item: `btnPlaystate`, `btnUserRating`
- Legacy reads: `getAdditionalVideoParts`, `getCurrentUser`, `getCurrentUserId`, `getItem`, `getScaledImageUrl`, `getSimilarItems`, `getSpecialFeatures`, `serverId`, `subscribe`
- SDK reads: `getItemCollections`
- Nested React roots: 6 mounted, 6 unmounted on `viewdestroy`

#### `minimal-video`

Playable video with no overview, tagline, tags, links, people, chapters, parts, specials or related items.

1. `nameContainer`
1. `mainDetailButtons`
1. `trackSelections`
1. `itemDetailsGroup`

- Headings, in order: (none)
- Actions, in order: `btnPlay`, `btnPlaystate`, `btnUserRating`, `btnMoreCommands`
- Selectors: `selectAudio`, `selectSource`, `selectSubtitles`, `selectVideo`
- User-data controls bound to the item: `btnPlaystate`, `btnUserRating`
- Legacy reads: `getCurrentUser`, `getCurrentUserId`, `getItem`, `getSimilarItems`, `serverId`, `subscribe`
- SDK reads: `getItemCollections`
- Nested React roots: 6 mounted, 6 unmounted on `viewdestroy`

#### `series`

Series: seasons as children in the PRIMARY column, Next Up, upcoming-on-TV schedule and air time.

1. `nameContainer`
1. `mainDetailButtons`
1. `overview`
1. `seriesAirTime`
1. `itemDetailsGroup`
1. `nextUpSection`
1. `listChildrenCollapsible`
1. `castCollapsible`

- Headings, in order: `NextUp`, `HeaderCastAndCrew`
- Actions, in order: `btnPlay`, `btnShuffle`, `btnPlaystate`, `btnUserRating`, `btnMoreCommands`
- Selectors: (none)
- User-data controls bound to the item: `btnPlaystate`, `btnUserRating`
- Legacy reads: `getCurrentUser`, `getCurrentUserId`, `getItem`, `getLiveTvPrograms`, `getNextUpEpisodes`, `getSeasons`, `getSimilarItems`, `serverId`, `subscribe`
- SDK reads: `getItemCollections`
- Nested React roots: 6 mounted, 6 unmounted on `viewdestroy`

#### `season`

Season: episodes as a list view in the primary column, no related surface.

1. `nameContainer`
1. `mainDetailButtons`
1. `itemDetailsGroup`
1. `listChildrenCollapsible`

- Headings, in order: (none)
- Actions, in order: `btnPlay`, `btnShuffle`, `btnPlaystate`, `btnUserRating`, `btnMoreCommands`
- Selectors: (none)
- User-data controls bound to the item: `btnPlaystate`, `btnUserRating`
- Legacy reads: `getCurrentUser`, `getCurrentUserId`, `getEpisodes`, `getItem`, `serverId`, `subscribe`
- SDK reads: `getItemCollections`
- Nested React roots: 6 mounted, 6 unmounted on `viewdestroy`

#### `episode`

Episode: leaf item with a sibling-episode strip and Series/Season parent links.

1. `nameContainer`
1. `mainDetailButtons`
1. `trackSelections`
1. `itemDetailsGroup`
1. `moreFromSeasonSection`

- Headings, in order: (none)
- Actions, in order: `btnPlay`, `btnPlaystate`, `btnUserRating`, `btnMoreCommands`
- Selectors: `selectAudio`, `selectSource`, `selectSubtitles`, `selectVideo`
- User-data controls bound to the item: `btnPlaystate`, `btnUserRating`
- Legacy reads: `getCurrentUser`, `getCurrentUserId`, `getEpisodes`, `getItem`, `serverId`, `subscribe`
- SDK reads: `getItemCollections`
- Nested React roots: 6 mounted, 6 unmounted on `viewdestroy`

#### `music-album`

Album: tracks as a list view, more-from-artist, music videos, instant mix and shuffle.

1. `nameContainer`
1. `mainDetailButtons`
1. `itemDetailsGroup`
1. `listChildrenCollapsible`
1. `moreFromArtistSection`
1. `musicVideosCollapsible`

- Headings, in order: `MusicVideos`
- Actions, in order: `btnPlay`, `btnInstantMix`, `btnShuffle`, `btnUserRating`, `btnMoreCommands`
- Selectors: (none)
- User-data controls bound to the item: `btnUserRating`
- Legacy reads: `getCurrentUser`, `getCurrentUserId`, `getItem`, `getItems`, `getSimilarItems`, `serverId`, `subscribe`
- SDK reads: `getItemCollections`
- Nested React roots: 6 mounted, 6 unmounted on `viewdestroy`

#### `audio`

Track: lyrics surface, instant mix, no played state.

1. `nameContainer`
1. `mainDetailButtons`
1. `itemDetailsGroup`
1. `lyricsSection`

- Headings, in order: `Lyrics`
- Actions, in order: `btnPlay`, `btnInstantMix`, `btnUserRating`, `btnMoreCommands`
- Selectors: (none)
- User-data controls bound to the item: `btnUserRating`
- Legacy reads: `ajax`, `getCurrentUser`, `getCurrentUserId`, `getItem`, `getItems`, `getSimilarItems`, `getUrl`, `serverId`, `subscribe`
- SDK reads: `getItemCollections`
- Nested React roots: 6 mounted, 6 unmounted on `viewdestroy`

#### `music-artist`

Artist: items-by-name children and an appears-on strip.

1. `nameContainer`
1. `mainDetailButtons`
1. `itemDetailsGroup`
1. `listChildrenCollapsible`

- Headings, in order: (none)
- Actions, in order: `btnPlay`, `btnInstantMix`, `btnShuffle`, `btnUserRating`, `btnMoreCommands`
- Selectors: (none)
- User-data controls bound to the item: `btnUserRating`
- Legacy reads: `getCurrentUser`, `getCurrentUserId`, `getItem`, `getItems`, `getSimilarItems`, `serverId`, `subscribe`
- SDK reads: `getItemCollections`
- Nested React roots: 6 mounted, 6 unmounted on `viewdestroy`

#### `playlist`

Playlist: children delegated to `scripts/playlistViewer`.

1. `nameContainer`
1. `mainDetailButtons`
1. `itemDetailsGroup`
1. `listChildrenCollapsible`

- Headings, in order: (none)
- Actions, in order: `btnPlay`, `btnShuffle`, `btnUserRating`, `btnMoreCommands`
- Selectors: (none)
- User-data controls bound to the item: `btnUserRating`
- Legacy reads: `getCurrentUser`, `getCurrentUserId`, `getItem`, `getJSON`, `getSimilarItems`, `getUrl`, `serverId`, `subscribe`
- SDK reads: `getItemCollections`
- Nested React roots: 6 mounted, 6 unmounted on `viewdestroy`

#### `box-set`

Collection: children grouped by item type into `.collectionItems`; both collapsibles stay hidden.

1. `nameContainer`
1. `mainDetailButtons`
1. `itemDetailsGroup`
1. `collectionItems`

- Headings, in order: `Movies`
- Actions, in order: `btnPlaystate`, `btnUserRating`, `btnMoreCommands`
- Selectors: (none)
- User-data controls bound to the item: `btnPlaystate`, `btnUserRating`
- Legacy reads: `getCurrentUser`, `getCurrentUserId`, `getItem`, `getItems`, `serverId`, `subscribe`
- SDK reads: `getItemCollections`
- Nested React roots: 6 mounted, 6 unmounted on `viewdestroy`

#### `person`

Person: items-by-name children, birth/death/birthplace lines, no backdrop, not playable.

1. `nameContainer`
1. `mainDetailButtons`
1. `overview`
1. `itemBirthday`
1. `itemBirthLocation`
1. `itemDetailsGroup`
1. `listChildrenCollapsible`

- Headings, in order: (none)
- Actions, in order: `btnUserRating`, `btnMoreCommands`
- Selectors: (none)
- User-data controls bound to the item: `btnUserRating`
- Legacy reads: `getCurrentUser`, `getCurrentUserId`, `getItem`, `getItems`, `serverId`, `subscribe`
- SDK reads: `getItemCollections`
- Nested React roots: 6 mounted, 6 unmounted on `viewdestroy`

#### `book`

Book: download action, no backdrop, cast surface, not playable.

1. `nameContainer`
1. `mainDetailButtons`
1. `itemDetailsGroup`
1. `castCollapsible`

- Headings, in order: `People`
- Actions, in order: `btnDownload`, `btnPlaystate`, `btnUserRating`, `btnMoreCommands`
- Selectors: (none)
- User-data controls bound to the item: `btnPlaystate`, `btnUserRating`
- Legacy reads: `getCurrentUser`, `getCurrentUserId`, `getItem`, `serverId`, `subscribe`
- SDK reads: `getItemCollections`
- Nested React roots: 6 mounted, 6 unmounted on `viewdestroy`

#### `photo`

Photo: not playable, no children, no related surface.

1. `nameContainer`
1. `mainDetailButtons`
1. `itemDetailsGroup`

- Headings, in order: (none)
- Actions, in order: `btnUserRating`, `btnMoreCommands`
- Selectors: (none)
- User-data controls bound to the item: `btnUserRating`
- Legacy reads: `getCurrentUser`, `getCurrentUserId`, `getItem`, `serverId`, `subscribe`
- SDK reads: `getItemCollections`
- Nested React roots: 6 mounted, 6 unmounted on `viewdestroy`

#### `program`

Live TV programme outside its airing window: the whole action bar is hidden and recording fields are embedded.

1. `nameContainer`
1. `itemMiscInfo-secondary`
1. `recordingFields`
1. `itemDetailsGroup`

- Headings, in order: (none)
- Actions, in order: (none — the action bar is hidden)
- Selectors: (none)
- User-data controls bound to the item: (none)
- Legacy reads: `getCurrentUser`, `getCurrentUserId`, `getItem`, `getLiveTvProgram`, `getSimilarItems`, `serverId`, `subscribe`
- SDK reads: `getItemCollections`
- Nested React roots: 6 mounted, 6 unmounted on `viewdestroy`

#### `recording`

In-progress recording: stop-recording action alongside playback.

1. `nameContainer`
1. `mainDetailButtons`
1. `trackSelections`
1. `itemDetailsGroup`

- Headings, in order: (none)
- Actions, in order: `btnPlay`, `btnCancelTimer`, `btnPlaystate`, `btnUserRating`, `btnMoreCommands`
- Selectors: `selectAudio`, `selectSource`, `selectSubtitles`, `selectVideo`
- User-data controls bound to the item: `btnPlaystate`, `btnUserRating`
- Legacy reads: `getCurrentUser`, `getCurrentUserId`, `getItem`, `getSimilarItems`, `serverId`, `subscribe`
- SDK reads: `getItemCollections`
- Nested React roots: 6 mounted, 6 unmounted on `viewdestroy`

#### `series-timer`

Series timer reached by `seriesTimerId`: schedule section and cancel-series action only.

1. `nameContainer`
1. `mainDetailButtons`
1. `itemDetailsGroup`
1. `seriesTimerScheduleSection`

- Headings, in order: `Schedule`
- Actions, in order: `btnCancelSeriesTimer`, `btnMoreCommands`
- Selectors: (none)
- User-data controls bound to the item: (none)
- Legacy reads: `getCurrentUser`, `getCurrentUserId`, `getLiveTvSeriesTimer`, `getLiveTvTimers`, `serverId`, `subscribe`
- SDK reads: `getItemCollections`
- Nested React roots: 6 mounted, 6 unmounted on `viewdestroy`

#### `tv-channel`

TV channel: programme guide, no media-source selection.

1. `nameContainer`
1. `mainDetailButtons`
1. `itemDetailsGroup`
1. `programGuideSection`

- Headings, in order: `Saturday, January 1`
- Actions, in order: `btnPlay`, `btnUserRating`, `btnMoreCommands`
- Selectors: (none)
- User-data controls bound to the item: `btnUserRating`
- Legacy reads: `getCurrentUser`, `getCurrentUserId`, `getItem`, `getLiveTvPrograms`, `serverId`, `subscribe`
- SDK reads: `getItemCollections`
- Nested React roots: 6 mounted, 6 unmounted on `viewdestroy`

#### `genre`

Genre reached by the `genre` route parameter: items-by-name children, no instant mix.

1. `nameContainer`
1. `mainDetailButtons`
1. `itemDetailsGroup`
1. `listChildrenCollapsible`

- Headings, in order: (none)
- Actions, in order: `btnPlay`, `btnShuffle`, `btnUserRating`, `btnMoreCommands`
- Selectors: (none)
- User-data controls bound to the item: `btnUserRating`
- Legacy reads: `getCurrentUser`, `getCurrentUserId`, `getGenre`, `getItems`, `serverId`, `subscribe`
- SDK reads: `getItemCollections`
- Nested React roots: 6 mounted, 6 unmounted on `viewdestroy`

#### `music-genre`

Music genre reached by the `musicgenre` route parameter: items-by-name children WITH instant mix.

1. `nameContainer`
1. `mainDetailButtons`
1. `itemDetailsGroup`
1. `listChildrenCollapsible`

- Headings, in order: (none)
- Actions, in order: `btnPlay`, `btnInstantMix`, `btnShuffle`, `btnUserRating`, `btnMoreCommands`
- Selectors: (none)
- User-data controls bound to the item: `btnUserRating`
- Legacy reads: `getCurrentUser`, `getCurrentUserId`, `getItems`, `getMusicGenre`, `serverId`, `subscribe`
- SDK reads: `getItemCollections`
- Nested React roots: 6 mounted, 6 unmounted on `viewdestroy`

---

## 4. Hero and image rules

There is no single "hero". Four independent image treatments run, each with its own gate:

| Treatment | Element | Gate |
| --- | --- | --- |
| Poster / primary card | every `.detailImageContainer` | always, via `buildCardImage` |
| Logo | `.detailLogo` | `item.ImageTags.Logo`, else `item.ParentLogoImageTag`, else hidden |
| Page backdrop | `components/backdrop` | not mobile **and** `window.innerWidth >= 1000`; otherwise `clearBackdrop()` |
| Header banner | `#itemBackdrop` | `layoutManager.mobile` **and** `userSettings.detailsBanner()`, and never for `Person` or `Book` |

The page also toggles `noBackdropTransparency` on itself when the banner is enabled but
`userSettings.enableBackdrops()` is off.

`MUST PRESERVE` — that a poster is always rendered; that `Person` and `Book` get no backdrop
treatment; that backdrop rendering is a user setting, not a theme decision.

`MAY CHANGE` — the specific breakpoint (`>= 1000`), the DOM ids and the class names.

`MUST RETIRE` — reading the viewport width directly out of `dom.getWindowSize()` at render time to
decide composition. A migrated route should express this as layout, not as a branch.

### Name block

`renderName` composes up to three lines from `AlbumArtists`, `ArtistItems` (only for `MusicVideo`),
`SeriesName` (`Episode`), `SeasonName`/`ParentIndexNumber`, `Album`/`AlbumId`, `OriginalTitle` and
`itemHelper.getDisplayName`. Artist links are capped at **10**, after which the remainder is
summarised with the `AndOtherArtists` key.

`MUST PRESERVE` — an `Episode` links to its series and its season; an album track links to its
album; the original title is shown when it differs from the display name; the 10-artist cap.

`MAY CHANGE` — the heading levels (`h1`/`h3`/`h4`), which the source itself flags as needing
rework (`// FIXME ... See GH #1022`).

---

## 5. Playback and media-source behaviour

`reloadPlayButtons` decides the action bar:

- **`Program`** — play is offered only while `StartDate <= now < EndDate`. Replay, instant mix and
  shuffle are always hidden. When play is not offered, `reloadFromItem` hides the whole
  `mainDetailButtons` container.
- **otherwise, when `playbackManager.canPlay(item)`** — play is offered; instant mix for
  `Audio`, `MusicAlbum`, `MusicGenre`, `MusicArtist`; shuffle for any `IsFolder` item and for
  `MusicAlbum`, `MusicGenre`, `MusicArtist`; replay only when
  `UserData.PlaybackPositionTicks > 0`.
- **otherwise** — play, replay, instant mix and shuffle are all hidden.

Play parameters come from the selector form, read at click time:

```js
{ startPositionTicks, mediaSourceId: .selectSource.value,
  audioStreamIndex: .selectAudio.value || null, subtitleStreamIndex: .selectSubtitles.value }
```

`startPositionTicks` is `UserData.PlaybackPositionTicks` when the pressed control carries
`data-action="resume"`, and `0` otherwise — which is what makes `btnPlay` (`resume`) and `btnReplay`
(`play`) different commands rather than different labels.

A `Program` does **not** play itself: `playCurrentItem` fetches
`getLiveTvChannel(item.ChannelId, userId)` and plays the channel.

Trailer availability requires `LocalTrailerCount || RemoteTrailers?.length` **and**
`PlayTrailers` in `playbackManager.getSupportedCommands()`.

`MUST PRESERVE` — every gate above, the resume-vs-replay distinction, the play option shape, and
the Program-plays-its-channel rule. RFC-0007 §6.1 already states that playback controls are not
theme-controllable; this is the concrete list that statement protects.

### Media-source, video, audio and subtitle selection

The whole selector form is hidden unless **all** of: `item.MediaSources` is non-empty,
`itemHelper.supportsMediaSourceSelection(item)`, `PlayMediaSource` is a supported command, and
`playbackManager.canPlay(item)`.

- **Version** — one option per media source; the container is hidden when there is only one; the
  first source is selected.
- **Video** — one option per video stream, labelled `DisplayTitle` or resolution + codec. The
  control is **always** `disabled`.
- **Audio** — sorted by `itemHelper.sortTracks` (embedded before external, forced first, default
  first, then index); selected by `DefaultAudioStreamIndex`; enabled only when there is more than
  one track.
- **Subtitles** — an explicit `-1` "Off" option first, then the tracks under the same sort;
  selected by `DefaultSubtitleStreamIndex`, or `-1` when it is null.

Changing the version re-renders all three track selectors, re-renders the misc-info line from the
selected source merged over the item, and fetches the alternate version's own DTO through the SDK
(`getLibraryApi(api).getItem`) to refresh resume position, watched state and part count. That
response is discarded if the selection changed while it was in flight.

`MUST PRESERVE` — the choices offered, the defaults, the "Off" subtitle option, the sort order, and
the fact that switching version refreshes user-data state from the selected version.

`SUSPECT` — the video selector is rendered, populated and then unconditionally disabled, and
`getPlayOptions` never reads it. Either it should be removed or it should work. It must not be
carried across as "the way it is".

---

## 6. User-data mutations

The route owns two user-data controls and delegates both:

| Control | Bound when | Mechanism |
| --- | --- | --- |
| `btnPlaystate` | `itemHelper.canMarkPlayed(item)` | `emby-playstatebutton.setItem(item)` |
| `btnUserRating` | `itemHelper.canRate(item)` | `emby-ratingbutton.setItem(item)` |

When the predicate is false the control is hidden **and** `setItem(null)` is called, so a stale item
cannot remain bound.

Incoming changes arrive over the websocket: the route subscribes to `UserDataChanged` on
`viewshow`, matches `Data.UserDataList` by `currentItem.UserData.Key`, replaces `currentItem.UserData`
and re-runs `reloadPlayButtons` — so a resume position set on another device changes this page's
actions without a reload. The subscription is released on `viewbeforehide`.

Other user-triggered mutations:

| Action | Effect |
| --- | --- |
| `btnCancelTimer` | `recordinghelper.cancelTimer(apiClient, item.TimerId)`, then reload |
| `btnCancelSeriesTimer` | `recordinghelper.cancelSeriesTimerWithConfirmation(id, serverId)`, then navigate to `livetv` |
| `btnSplitVersions` | confirm, then `DELETE Videos/{id}/AlternateSources`, then reload and fire `REFRESH_NEEDED` |
| `btnDownload` | `getLibraryApi(api).getDownloadUrl({itemId})` into `scripts/fileDownloader` |

`MUST PRESERVE` — every row above, the null-binding rule, and the websocket-driven refresh.

---

## 7. Context menu and administrative actions

`itemContextMenu.getCommands` is called once during render purely to decide whether `btnMoreCommands`
is shown; it is called again on click to open the menu. The options passed are fixed except for one:

```js
{ item, open: false, play: false, playAllFromHere: false, queueAllFromHere: false,
  positionTo: button, cancelTimer: false, record: false,
  deleteItem: item.CanDelete === true, shuffle: false, instantMix: false, user, share: true }
```

Deletion is gated on the **item's** `CanDelete` flag, not on the user's role.

After the menu closes: `result.deleted` navigates to `SeasonId || SeriesId || ParentId`, or home if
there is none; `result.updated` reloads the page.

`btnSplitVersions` requires `user.Policy.IsAdministrator` **and** at least one media source of
`Type: 'Grouping'`.

Live-TV editors are gated on `user.Policy.EnableLiveTvManagement`: the series-recording editor and
schedule for a `SeriesTimer`, the recording fields for a `Program`, and `btnCancelTimer` for a
`Recording` that is `InProgress` and has a `TimerId`.

`MUST PRESERVE` — the permission gates, `CanDelete` as the deletion gate, and the post-delete
navigation target.

`MAY CHANGE` — that the command list is computed twice.

`SUSPECT` — `onMoreCommandsClick` re-fetches the item using `.selectSource.value` **or**
`currentItem.Id` as an item id. A media-source id is not always an item id; for a non-version
selector state this fetches something other than the displayed item.

---

## 8. Data-read inventory

Two surfaces are in use, and both are inventoried per class in §3.

**Legacy `apiClient`:** `getCurrentUserId`, `getCurrentUser`, `serverId`, `subscribe`, `getItem`,
`getLiveTvSeriesTimer`, `getGenre`, `getMusicGenre`, `getArtist`, `getSeasons`, `getEpisodes`,
`getItems`, `getSimilarItems`, `getNextUpEpisodes`, `getSpecialFeatures`,
`getAdditionalVideoParts`, `getLiveTvPrograms`, `getLiveTvTimers`, `getLiveTvProgram`,
`getLiveTvChannel`, `getScaledImageUrl`, `getUrl`, `ajax`, `getJSON`.

**SDK `getLibraryApi(api)`:** `getItemCollections`, `getItem`, `getDownloadUrl`.

Three reads are unconditional for **every** class, including `Person`, `Photo` and `SeriesTimer`:
`getCurrentUser`, `getCurrentUserId` and `sdk.getItemCollections`.

`SUSPECT` — `getItemCollections` is issued for item types that can never belong to a collection.
It is a wasted request on at least `Person`, `SeriesTimer` and `TvChannel`.

`SUSPECT` — each of the six nested React roots mounts a full `RootContext`, and each one issues its
own `getCurrentUser`. One render of Item Details therefore performs **seven** current-user reads.

`MUST PRESERVE` — the per-class read sets in §3 as the set the migrated route must be able to
satisfy. `MAY CHANGE` — their number, order and concurrency, provided no new read appears and no
recorded surface loses its data.

---

## 9. Nested React roots and cleanup ownership

`renderDetails` calls `utils/reactUtils.renderComponent` once per entry in

```js
[PersonKind.Author, PersonKind.Creator, PersonKind.Director, PersonKind.Writer,
 BaseItemKind.Studio, BaseItemKind.Genre]
```

so **six** roots are created on every render, one per metadata list, each mounting
`components/itemDetails/ItemDetailsMetadataList` inside a fresh `QueryClientProvider` /
`ApiProvider` / `UserSettingsProvider` / `WebConfigProvider` / theme provider stack. A root whose
list is empty renders `null` but is still created.

Measured: **6 mounted, 6 unmounted** for every equivalence class. The unmount functions are pushed
onto `instance._unmount` and drained by `unmount(instance)`, which runs both at the top of
`reloadFromItem` (so a reload does not leak the previous render) and on `viewdestroy`.

Two other nested widgets are **not** roots and are **not** destroyed:

- `components/recordingcreator/recordingfields` — constructed into `instance.currentRecordingFields`
  and only set to `null` on `viewdestroy`; its `destroy`/`refresh` is never called.
- `components/recordingcreator/seriesrecordingeditor` — `embed()`ed into `.seriesRecordingEditor`
  and never torn down at all.

`MUST RETIRE` — the nested-root mechanism itself. #129 records the reason: a nested root is
invisible to `PresentationContext`, so a resolved presentation cannot reach it.

`SUSPECT` — the two undestroyed live-TV widgets.

Note that #129's body says Item Details is "one of the four `renderComponent` call sites". Measured
against this tree there are **two** call sites in the repository — `itemDetails/index.js:1222` and
`plugins/bookPlayer/plugin.js:332`; the `FilterDrawer.tsx` occurrence is a comment. The count in the
issue is stale.

---

## 10. Loading, empty, error and permission states

- **Loading** — `loading.show()` on every `reload()`; `loading.hide()` at the end of
  `reloadFromItem`, and again at the end of `renderSeriesSchedule`.
- **Empty** — every optional section is hidden when its data is absent or its read returns nothing.
  This is verified per class: a `minimal-video` shows no tagline, overview, tags, links, cast,
  guest cast, specials, scenes, parts, related or collections surface.
- **Primary failure** — a rejected primary read is logged (`failed to get item or current user`)
  and nothing is rendered: no action bar, an empty name container. **`loading.hide()` is never
  reached on this path.**
- **Section failure** — `renderItemCollections` and `renderLyricsContainer` catch and hide. Most
  other section reads have no `.catch`; the rejection is swallowed by the enclosing
  `reload().catch`, so a single failing section read aborts the remainder of `reloadFromItem`.
- **Restored view** — on `viewshow` with `e.detail.isRestored`, the route does **not** re-read.
  It re-renders track selections and the backdrop from the cached `currentItem`.

`MUST PRESERVE` — the empty-section rule, and that a failed primary read does not leave a
plausible-looking stale page.

`SUSPECT` — the spinner that never hides on the failure path, and the absence of any user-visible
error state at all: the page simply stays blank.

---

## 11. Keyboard and focus behaviour

- `autoFocus(page)` is called at the end of `reloadFromItem`, and **again** at the end of
  `renderCollectionItems`, with a comment calling the second call a HACK because `btnPlay` may have
  been hidden after focus landed on it.
- The action bar and several inline link groups carry `focuscontainer-x`, which the TV/keyboard
  navigation layer uses for horizontal focus movement.
- `itemShortcuts.on(view.querySelector('.nameContainer'))` is attached on `viewshow` and detached on
  `viewbeforehide`, delegating clicks on `data-action` links inside the name block.

`MUST PRESERVE` — that focus lands inside the page on load, and that every principal action is
reachable by keyboard.

`SUSPECT` — the double `autoFocus`, and the source's own note that "sometimes focus does not move
until all (?) sections are loaded".

`MAY CHANGE` — `focuscontainer-x` and the shortcut delegation, which are legacy navigation
mechanisms rather than product behaviour.

---

## 12. Findings

### MUST PRESERVE

1. Route parameters and their precedence, including `serverId` server selection.
2. The per-class ordered composition in §3.
3. The per-class read inventory in §3 as an upper bound: no new request, no lost surface.
4. Every playback gate in §5, the resume/replay distinction and the play-option shape.
5. The media-source, audio and subtitle choices, their defaults, the "Off" subtitle option and the
   `sortTracks` order.
6. The user-data controls, their predicates, the `setItem(null)` unbinding and the websocket-driven
   refresh.
7. `CanDelete` as the deletion gate, `IsAdministrator` for split-versions, `EnableLiveTvManagement`
   for every live-TV editor.
8. Episode links to its series and season; series shows seasons and Next Up; season shows episodes
   in server order.
9. A poster is always rendered; `Person` and `Book` never get a backdrop.
10. Absent data never manufactures a section.
11. Focus lands inside the page and every principal action is keyboard-reachable.

### MAY CHANGE

1. Every DOM id, class name and heading level in the view.
2. Which column a section is rendered in (`detailPagePrimaryContent` vs `detailPageSecondaryContainer`).
3. Card shapes, scroller behaviour and `overflow*` shape names.
4. The number, order and concurrency of requests, within the bound above.
5. Translated wording. Section identity is asserted by translation KEY, never by prose.
6. That `itemContextMenu.getCommands` runs twice.
7. The `>= 1000` backdrop breakpoint.

### MUST RETIRE

1. The view-manager controller and its `viewshow` / `viewbeforehide` / `viewdestroy` lifecycle.
2. The six nested React roots — the reason #129 exists.
3. `innerHTML` string composition for cast, children, related, collections and the programme guide.
4. Reading `dom.getWindowSize()` / `window.screen.availWidth` at render time to choose composition.
5. `hideAll(page, className)` as the show/hide mechanism.
6. `window.ItemDetailPage`, a global assigned at module load and read by nothing in this tree.

### SUSPECT — decision required

1. A `/details` URL with no recognised parameter throws synchronously past its own `.catch` and
   leaves a permanent spinner.
2. A failed primary read hides nothing, shows no error, and never hides the spinner.
3. The video-track selector is always disabled and never read.
4. `onMoreCommandsClick` re-fetches using a **media-source id** as an item id.
5. `sdk.getItemCollections` is issued for types that cannot belong to a collection.
6. Six nested roots each perform their own `getCurrentUser`.
7. `renderSeriesAirTime` emits untranslated English — `daily`, ` at `, `Aired `/`Airs `.
8. `renderLyricsContainer` never hides the lyrics section when `item.HasLyrics` is false; it only
   hides on the wrong type or a failed fetch.
9. `renderCollectionItems` hides play and shuffle **after** `reloadPlayButtons` showed them, then
   re-runs `autoFocus` to compensate — the source calls this a HACK.
10. `#specialsCollapsible` is revealed from `SpecialFeatureCount` before the fetch, so a failed
    fetch leaves a visible empty section.
11. `renderChildren`'s `item.Type === 'Episode'` branch is **unreachable** from
    `setInitialCollapsibleState`, which only calls it for `IsFolder` items. Its intent is unknown
    and must not be reverse-engineered into the migration.
12. `renderTimerEditor` and `renderSeriesTimerEditor` take `apiClient` parameters they never use.
13. The two live-TV widgets in §9 are never destroyed.

None of the `SUSPECT` items is being fixed in this loop. Rule: they are recorded so that the
migration cannot adopt them by accident.

---

## 13. Platform-default comparison

`PLATFORM_DEFAULT_PRESENTATION.page.itemDetails` currently declares:

```ts
{ hero: 'backdrop', sections: ['overview', 'cast', 'episodes', 'related', 'mediaInfo'] }
```

It is **read by nothing**. `presentation.page.itemDetails` is defined by the contract, resolved by
`resolvePresentation`, and not bound by any route — `src/themes/platform/contract.ts` keeps it off
`WEB_RENDERER_CAPABILITIES` for exactly that reason. Nothing in this loop changes that.

The comparison per class is in the §2 matrix. The verdicts mean:

- **`MISMATCH`** — the class renders at least one of the five vocabulary sections, but not in the
  declared order and not as that set. Every video/episodic class is a `MISMATCH`: the legacy order
  puts `mediaInfo` (the misc-info lines) and the action bar **above** `overview`, and interleaves
  surfaces the vocabulary has no word for (tagline, tags, external links, scenes, specials,
  additional parts, next up, collections). `hero: 'backdrop'` is also conditional in the legacy
  route (§4), where the vocabulary states it unconditionally.
- **`NOT APPLICABLE`** — the class renders none of `episodes` or `cast`-shaped content in the
  vocabulary's sense, or is not a media-detail page at all (`series-timer`, `tv-channel`, `genre`,
  `music-genre`, `photo`, `book`, `playlist`, and the music classes, whose principal surfaces —
  tracks, lyrics, more-from-artist, music videos — have no word in the vocabulary).
- No class returns `MATCH`.
- No class returns `AMBIGUOUS`.

**Consequence for Step 2, recorded now so it is not discovered late:** the declared platform default
does not describe the current route for any equivalence class. Binding it as written would be a
visible product change, not a no-op. The vocabulary is also too small — it has no term for the
action bar, the track selectors, children, scenes, specials, additional parts, next up, collections,
lyrics, the programme guide or the live-TV editors. Either the vocabulary grows or the default
changes; that is a decision for the binding step, and this document deliberately does not make it.

---

## 14. Explicit exclusions from the future theme contract

The following are **never** theme-controllable, per RFC-0007 §6.1, and are recorded here because
Item Details carries more of them than any other route:

- every control in `mainDetailButtons` — play, resume, replay, trailer, instant mix, shuffle,
  download, cancel timer, cancel series timer, played, rating, split versions, more commands;
- the media-source, video, audio and subtitle selectors;
- the context menu and every permission gate behind it;
- the live-TV recording editors;
- which requests the route issues. A recipe orders and selects; a section hidden by a recipe must
  still fetch, and hiding one must remain an explicit product decision.

---

## 15. Known evidence limitations

1. **Desktop layout only.** `layoutManager.mobile` and `layoutManager.tv` are false throughout.
   Mobile-only behaviour — the header banner, `renderName`'s mobile branch, `enableScrollX()`,
   the `action: 'link'` list variant for seasons — is recorded from the source but not executed.
2. **jsdom does not upgrade customized built-in elements.** `emby-select`, `emby-playstatebutton`,
   `emby-ratingbutton`, `emby-scroller` and `emby-itemscontainer` are exercised through recording
   stubs with the same imperative shape. `emby-scroller`'s upgrade also adds the `emby-scroller`
   class that `renderMoreFromSeason` looks up by; the stub adds it, so the null-dereference seen
   without it is a harness artifact, not route behaviour.
3. **No layout is measured.** `renderOverview`'s overflow detection compares `scrollHeight` to
   `offsetHeight`, both `0` in jsdom, so the show-more control's visibility is not characterized.
4. **Image URLs are not characterized.** `imageLoader` is stubbed; card markup is real.
5. **The browser evidence uses fixture responses**, not a real server. It proves the real route,
   the real bundle and real layout; it does not prove server compatibility.
6. **Fixtures are minimal DTOs.** They carry only fields the controller branches on, so a field the
   route ignores today would not show up as a change if a future DTO gained one.
7. **`musicartist` and the unreachable `Episode` child branch are recorded but not executed.**
