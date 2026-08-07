# Item Details — the migrated request and action ledger

> **Derived document.** Every number, row and identifier below comes from
> `tests/fixtures/item-details/migrated-request-action-ledger.json`, which is the authoritative
> record. `tests/itemDetails/ledger.consistency.test.ts` fails if this file and that fixture
> disagree, so there is one source of truth and this is not it.

Frozen for [#129](https://github.com/tesserafin-project/tesserafin-web/issues/129) **Step 1c**:
the migrated `/details` route's complete request and action ledger, recorded *before* any
presentation recipe is bound. Step 2 binds the recipe and must leave every row here unchanged.

## 1. What this record is, and what it is not

| | |
| --- | --- |
| Subject | the **migrated** modern React route, `src/apps/modern/routes/details.tsx` and `src/apps/modern/features/details` |
| Authoritative fixture | `tests/fixtures/item-details/migrated-request-action-ledger.json` |
| Bidirectional proof | `tests/itemDetails/itemDetails.ledger.test.tsx` |
| Effect-frontier proof | `tests/itemDetails/ledger.effectFrontier.test.ts` |
| Consistency proof | `tests/itemDetails/ledger.consistency.test.ts` |
| Browser proof | `tests/itemDetailsBrowser/itemDetails.ledger.browser.spec.ts` |
| Equivalence classes | 24 |

It does **not** supersede `tests/fixtures/item-details/legacy-contract.json`. That fixture is the
**historical** P5 record of the pre-migration route, frozen by
`PR #133 (61ee617b), re-pointed at the migrated route by PR #134 without editing the fixture`. It answers "what did the legacy route compose?";
this ledger answers "what does the migrated route *ask for*, and *do*?". The P5 fixture is
unchanged by this work and pinned by SHA-256 `54609b52e400bd2a04d495abf3c886559e7de50dd52b409187d7c2ebbd7ab62d`.

### Not theme-controllable

RFC-0007 §6.1 places playback controls, permission gates and required warnings outside the theme
contract. Item Details carries more of each than any other route, so **nothing in this ledger is
reachable from a presentation recipe** — before or after Step 2. A recipe orders and selects; it
never changes which requests the route issues and never changes playback behaviour.

Today `presentation.page.itemDetails` is read by the route: **false**, and
declared in `WEB_RENDERER_CAPABILITIES`: **false**.

## 2. Route inputs

| | |
| --- | --- |
| Path | `details` |
| Registration | `ASYNC_USER_ROUTES -> toAsyncPageRoute, in BOTH route families` |
| Lookup precedence | `id` → `seriesTimerId` → `genre` → `musicgenre` → `musicartist` |
| Server selection | `params.serverId ? ServerConnections.getApiClient(serverId) : ServerConnections.currentApiClient() — selects the SERVER, never the item` |
| `context` | params.context is forwarded to link building only; it changes no request |

## 3. Outward surfaces

| Surface | What it is |
| --- | --- |
| `legacy` | the jellyfin-apiclient instance returned by ServerConnections, reached only through adapters/itemDetailsApi.ts |
| `sdk` | getLibraryApi(api) from @jellyfin/sdk |
| `sdk.userData` | getUserDataApi(api) from @jellyfin/sdk, reached through hooks/useFetchItems |
| `service.playbackManager` | components/playback/playbackmanager |
| `service.itemContextMenu` | components/itemContextMenu |
| `service.confirm` | components/confirm/confirm |
| `service.recordingHelper` | components/recordingcreator/recordinghelper |
| `service.recordingFields` | components/recordingcreator/recordingfields — the one delegated widget |
| `service.fileDownloader` | scripts/fileDownloader |
| `service.appRouter` | components/router/appRouter |
| `service.dashboard` | utils/dashboard |
| `service.events` | utils/events |
| `service.libraryMenu` | scripts/libraryMenu |
| `service.router` | react-router-dom |

## 4. Causal phases

No total order is imposed. Rows in the same `group` are intentionally concurrent; `dependsOn` records the only ordering the route guarantees.

| Phase | Meaning |
| --- | --- |
| `primary` | the item and the acting user, in ONE Promise.all. Either rejection is one failure. |
| `subscription` | the UserDataChanged subscription, bound in a mount effect once the item is known. |
| `section` | the section fan-out. Unordered with respect to each other; every member depends on `primary`. |
| `delegated` | reads issued by the one imperative adapter, components/recordingcreator/recordingfields. |
| `render` | URL builders invoked while drawing. Their distinct argument sets are frozen; their call counts are not. |
| `action` | requests issued only when a control is activated. |

## 5. Identity roles

Every argument in the ledger is written in **roles**, not literals, and resolved per class at
assertion time. That is what makes "the item id where a media-source id belongs" a failure rather
than a coincidence.

| Role | Meaning |
| --- | --- |
| `itemId` | the item this route is showing |
| `userId` | the acting user |
| `serverId` | the server the item belongs to |
| `seriesId` | the parent series of an episode or season |
| `seasonId` | the parent season of an episode |
| `channelId` | the live-TV channel a programme airs on — the play TARGET for a Program |
| `albumId` | the parent album of a track |
| `timerId` | the recording timer, distinct from the recording item |
| `mediaSourceId.N` | the Nth media source of the item. NEVER interchangeable with itemId. |
| `albumArtistId.N` | the Nth album artist |
| `routeParam.X` | the literal value of route parameter X |

### Declared role collisions

Several fixtures give an item and its first media source the **same** id. Where that is true a
substitution is unobservable, so it is recorded rather than glossed over — and the discriminating
proof is a declared variant (§9) that selects the *alternate* source, whose id always differs.

| Class | Roles that resolve to the same value |
| --- | --- |
| `movie` | `itemId` = `movie-1`, `mediaSourceId.0` = `movie-1`, `routeParam.id` = `movie-1` |
| `movie-resumable` | `itemId` = `movie-1`, `mediaSourceId.0` = `movie-1`, `routeParam.id` = `movie-1` |
| `movie-grouped-admin` | `itemId` = `movie-grouped`, `mediaSourceId.0` = `movie-grouped`, `routeParam.id` = `movie-grouped` |
| `movie-grouped-regular` | `itemId` = `movie-grouped`, `mediaSourceId.0` = `movie-grouped`, `routeParam.id` = `movie-grouped` |
| `minimal-video` | `itemId` = `minimal-1`, `mediaSourceId.0` = `minimal-1`, `routeParam.id` = `minimal-1` |
| `series` | `itemId` = `series-1`, `routeParam.id` = `series-1` |
| `season` | `itemId` = `season-1`, `routeParam.id` = `season-1` |
| `episode` | `itemId` = `episode-1`, `mediaSourceId.0` = `episode-1`, `routeParam.id` = `episode-1` |
| `music-album` | `itemId` = `album-1`, `routeParam.id` = `album-1` |
| `audio` | `itemId` = `audio-1`, `mediaSourceId.0` = `audio-1`, `routeParam.id` = `audio-1` |
| `music-artist` | `itemId` = `artist-1`, `routeParam.id` = `artist-1` |
| `playlist` | `itemId` = `playlist-1`, `routeParam.id` = `playlist-1` |
| `box-set` | `itemId` = `boxset-1`, `routeParam.id` = `boxset-1` |
| `person` | `itemId` = `person-1`, `routeParam.id` = `person-1` |
| `book` | `itemId` = `book-1`, `mediaSourceId.0` = `book-1`, `routeParam.id` = `book-1` |
| `photo` | `itemId` = `photo-1`, `routeParam.id` = `photo-1` |
| `program` | `itemId` = `program-1`, `routeParam.id` = `program-1` |
| `recording` | `itemId` = `recording-1`, `mediaSourceId.0` = `recording-1`, `routeParam.id` = `recording-1` |
| `recording-no-livetv` | `itemId` = `recording-1`, `mediaSourceId.0` = `recording-1`, `routeParam.id` = `recording-1` |
| `series-timer` | `itemId` = `seriestimer-1`, `routeParam.seriesTimerId` = `seriestimer-1` |
| `series-timer-no-livetv` | `itemId` = `seriestimer-1`, `routeParam.seriesTimerId` = `seriestimer-1` |
| `tv-channel` | `itemId` = `channel-1`, `mediaSourceId.0` = `channel-1`, `routeParam.id` = `channel-1` |

## 6. Coverage matrix

| Class | Item type | Requests | Absent reads | Actions | Absent actions | LOCAL_ONLY | Disabled | Delegated | Variants |
| --- | --- | --: | --: | --: | --: | --: | --: | --: | --: |
| `movie` | `Movie` | 9 | 14 | 5 | 7 | 4 | 1 | 0 | 2 |
| `movie-resumable` | `Movie` | 9 | 14 | 6 | 6 | 4 | 1 | 0 | 2 |
| `movie-grouped-admin` | `Movie` | 11 | 14 | 6 | 6 | 4 | 1 | 0 | 2 |
| `movie-grouped-regular` | `Movie` | 9 | 14 | 5 | 7 | 4 | 1 | 0 | 2 |
| `minimal-video` | `Movie` | 6 | 16 | 4 | 8 | 3 | 1 | 0 | 0 |
| `series` | `Series` | 9 | 13 | 5 | 7 | 1 | 0 | 0 | 0 |
| `season` | `Season` | 6 | 16 | 5 | 7 | 0 | 0 | 0 | 0 |
| `episode` | `Episode` | 6 | 16 | 4 | 8 | 3 | 1 | 0 | 0 |
| `music-album` | `MusicAlbum` | 9 | 13 | 5 | 7 | 0 | 0 | 0 | 0 |
| `audio` | `Audio` | 9 | 14 | 4 | 8 | 0 | 0 | 0 | 0 |
| `music-artist` | `MusicArtist` | 8 | 14 | 5 | 7 | 0 | 0 | 0 | 0 |
| `playlist` | `Playlist` | 8 | 15 | 4 | 8 | 0 | 0 | 0 | 0 |
| `box-set` | `BoxSet` | 6 | 16 | 3 | 9 | 0 | 0 | 0 | 0 |
| `person` | `Person` | 6 | 16 | 2 | 10 | 1 | 0 | 0 | 0 |
| `book` | `Book` | 6 | 17 | 4 | 8 | 0 | 0 | 0 | 0 |
| `photo` | `Photo` | 5 | 17 | 2 | 10 | 0 | 0 | 0 | 0 |
| `program` | `Program` | 9 | 15 | 0 | 12 | 0 | 0 | 1 | 1 |
| `recording` | `Recording` | 6 | 16 | 5 | 7 | 3 | 1 | 0 | 0 |
| `recording-no-livetv` | `Recording` | 6 | 16 | 4 | 8 | 3 | 1 | 0 | 0 |
| `series-timer` | `SeriesTimer` | 6 | 16 | 2 | 10 | 0 | 0 | 0 | 0 |
| `series-timer-no-livetv` | `SeriesTimer` | 5 | 17 | 1 | 11 | 0 | 0 | 0 | 0 |
| `tv-channel` | `TvChannel` | 6 | 16 | 3 | 9 | 0 | 0 | 0 | 0 |
| `genre` | `Genre` | 6 | 16 | 4 | 8 | 0 | 0 | 0 | 0 |
| `music-genre` | `MusicGenre` | 6 | 16 | 5 | 7 | 0 | 0 | 0 | 0 |
| **total** | | **172** | **367** | **93** | **195** | **30** | **8** | **1** | **9** |

Unique request signatures: **38**. Unique action signatures: **15**.
Declared navigation affordances: **56**.

## 7. Requests, per class

`Cardinality` is exact where it is a number. `render-derived` and `call-site-derived` mark the two
kinds whose *distinct arguments* are frozen but whose call count is a function of how many times
React drew the tree — freezing that number would make the suite fail on an unrelated re-render.

### `movie`

Route parameters: `id` = `movie-1`.

| Row | Surface | Member | Kind | Phase | Trigger | Guard | Arguments | Identity | Cardinality |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `primary.item` | `legacy` | `getItem` | `REQUEST` | `primary` | route mount with a resolved lookup parameter | `params.kind === "id"` | `["$userId","$itemId"]` | `arg[0]` → userId | 1 |
| `primary.user` | `legacy` | `getCurrentUser` | `REQUEST` | `primary` | route mount, in the same Promise.all as primary.item | `params.kind !== null` | `[]` | — | 1 |
| `primary.currentUserId` | `legacy` | `getCurrentUserId` | `LOCAL_ACCESSOR` | `primary` | every adapter call that needs the acting user id | `none` | `[]` | — | call-site-derived |
| `subscription.userData` | `legacy` | `subscribe` | `SUBSCRIPTION` | `subscription` | useUserDataRefresh mount effect, once the item is known | `item is defined` | `[["UserDataChanged"]]` | — | 1 |
| `similar` | `legacy` | `getSimilarItems` | `REQUEST` | `section` | render, once the item resolves | `item.Type "Movie" is in SIMILAR_TYPES — issued whether or not a related section renders (invariant 16)` | `["$itemId",{"userId":"$userId","limit":12,"fields":"PrimaryImageAspectRatio,CanDelete"}]` | `arg[0]` → itemId | 1 |
| `collections` | `sdk` | `getItemCollections` | `REQUEST` | `section` | render, once item and user resolve | `item && user — issued by every class; only some render a collections section` | `[{"itemId":"$itemId","userId":"$userId","fields":["PrimaryImageAspectRatio"]}]` | `arg[0].itemId` → itemId<br>`arg[0].userId` → userId | 1 |
| `specials` | `legacy` | `getSpecialFeatures` | `REQUEST` | `section` | render, once item and user resolve | `item.SpecialFeatureCount > 0` | `["$userId","$itemId"]` | `arg[0]` → userId<br>`arg[1]` → itemId | 1 |
| `additionalParts` | `legacy` | `getAdditionalVideoParts` | `REQUEST` | `section` | render, once item and user resolve | `item.PartCount > 1` | `["$userId","$itemId"]` | `arg[0]` → userId<br>`arg[1]` → itemId | 1 |
| `artwork.scaledImageUrl` | `legacy` | `getScaledImageUrl` | `URL_BUILDER` | `render` | every render that draws artwork | `the item, or a rendered chapter, declares the image tag` | `["$itemId",[{"type":"Chapter","tag":"c1","maxWidth":400,"imageIndex":0}]]` | `arg[0]` → itemId | render-derived — the distinct option sets are frozen, the call count is not |

<details><summary>Declared absences — reads this class must NOT issue</summary>

| Signature | Why it is absent |
| --- | --- |
| `children.seasons` | item.Type is "Movie", not "Series" |
| `children.episodes` | item.Type is "Movie", not "Season" |
| `children.itemsByName` | item.Type "Movie" is not an items-by-name type |
| `children.playlist` | item.Type is "Movie", not "Playlist" |
| `children.folder` | item.IsFolder is not true |
| `moreFromSeason` | item.Type is "Movie", not "Episode" |
| `nextUp` | item.Type is "Movie", not "Series" |
| `seriesSchedule` | item.Type is "Movie", not "Series" |
| `musicVideos` | item.Type is "Movie", not "MusicAlbum" |
| `moreFromArtist` | hasMoreFromArtist is false for item.Type "Movie" |
| `lyrics` | item.Type is "Movie", not "Audio" |
| `channelGuide` | item.Type is "Movie", not "TvChannel" |
| `seriesTimerSchedule` | item.Type is "Movie", not "SeriesTimer" |
| `recordingFields.program` | item.Type is "Movie", not "Program" |

</details>

### `movie-resumable`

Route parameters: `id` = `movie-1`.

| Row | Surface | Member | Kind | Phase | Trigger | Guard | Arguments | Identity | Cardinality |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `primary.item` | `legacy` | `getItem` | `REQUEST` | `primary` | route mount with a resolved lookup parameter | `params.kind === "id"` | `["$userId","$itemId"]` | `arg[0]` → userId | 1 |
| `primary.user` | `legacy` | `getCurrentUser` | `REQUEST` | `primary` | route mount, in the same Promise.all as primary.item | `params.kind !== null` | `[]` | — | 1 |
| `primary.currentUserId` | `legacy` | `getCurrentUserId` | `LOCAL_ACCESSOR` | `primary` | every adapter call that needs the acting user id | `none` | `[]` | — | call-site-derived |
| `subscription.userData` | `legacy` | `subscribe` | `SUBSCRIPTION` | `subscription` | useUserDataRefresh mount effect, once the item is known | `item is defined` | `[["UserDataChanged"]]` | — | 1 |
| `similar` | `legacy` | `getSimilarItems` | `REQUEST` | `section` | render, once the item resolves | `item.Type "Movie" is in SIMILAR_TYPES — issued whether or not a related section renders (invariant 16)` | `["$itemId",{"userId":"$userId","limit":12,"fields":"PrimaryImageAspectRatio,CanDelete"}]` | `arg[0]` → itemId | 1 |
| `collections` | `sdk` | `getItemCollections` | `REQUEST` | `section` | render, once item and user resolve | `item && user — issued by every class; only some render a collections section` | `[{"itemId":"$itemId","userId":"$userId","fields":["PrimaryImageAspectRatio"]}]` | `arg[0].itemId` → itemId<br>`arg[0].userId` → userId | 1 |
| `specials` | `legacy` | `getSpecialFeatures` | `REQUEST` | `section` | render, once item and user resolve | `item.SpecialFeatureCount > 0` | `["$userId","$itemId"]` | `arg[0]` → userId<br>`arg[1]` → itemId | 1 |
| `additionalParts` | `legacy` | `getAdditionalVideoParts` | `REQUEST` | `section` | render, once item and user resolve | `item.PartCount > 1` | `["$userId","$itemId"]` | `arg[0]` → userId<br>`arg[1]` → itemId | 1 |
| `artwork.scaledImageUrl` | `legacy` | `getScaledImageUrl` | `URL_BUILDER` | `render` | every render that draws artwork | `the item, or a rendered chapter, declares the image tag` | `["$itemId",[{"type":"Chapter","tag":"c1","maxWidth":400,"imageIndex":0}]]` | `arg[0]` → itemId | render-derived — the distinct option sets are frozen, the call count is not |

<details><summary>Declared absences — reads this class must NOT issue</summary>

| Signature | Why it is absent |
| --- | --- |
| `children.seasons` | item.Type is "Movie", not "Series" |
| `children.episodes` | item.Type is "Movie", not "Season" |
| `children.itemsByName` | item.Type "Movie" is not an items-by-name type |
| `children.playlist` | item.Type is "Movie", not "Playlist" |
| `children.folder` | item.IsFolder is not true |
| `moreFromSeason` | item.Type is "Movie", not "Episode" |
| `nextUp` | item.Type is "Movie", not "Series" |
| `seriesSchedule` | item.Type is "Movie", not "Series" |
| `musicVideos` | item.Type is "Movie", not "MusicAlbum" |
| `moreFromArtist` | hasMoreFromArtist is false for item.Type "Movie" |
| `lyrics` | item.Type is "Movie", not "Audio" |
| `channelGuide` | item.Type is "Movie", not "TvChannel" |
| `seriesTimerSchedule` | item.Type is "Movie", not "SeriesTimer" |
| `recordingFields.program` | item.Type is "Movie", not "Program" |

</details>

### `movie-grouped-admin`

Route parameters: `id` = `movie-grouped`.

| Row | Surface | Member | Kind | Phase | Trigger | Guard | Arguments | Identity | Cardinality |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `primary.item` | `legacy` | `getItem` | `REQUEST` | `primary` | route mount with a resolved lookup parameter | `params.kind === "id"` | `["$userId","$itemId"]` | `arg[0]` → userId | 1 |
| `primary.user` | `legacy` | `getCurrentUser` | `REQUEST` | `primary` | route mount, in the same Promise.all as primary.item | `params.kind !== null` | `[]` | — | 1 |
| `primary.currentUserId` | `legacy` | `getCurrentUserId` | `LOCAL_ACCESSOR` | `primary` | every adapter call that needs the acting user id | `none` | `[]` | — | call-site-derived |
| `subscription.userData` | `legacy` | `subscribe` | `SUBSCRIPTION` | `subscription` | useUserDataRefresh mount effect, once the item is known | `item is defined` | `[["UserDataChanged"]]` | — | 1 |
| `similar` | `legacy` | `getSimilarItems` | `REQUEST` | `section` | render, once the item resolves | `item.Type "Movie" is in SIMILAR_TYPES — issued whether or not a related section renders (invariant 16)` | `["$itemId",{"userId":"$userId","limit":12,"fields":"PrimaryImageAspectRatio,CanDelete"}]` | `arg[0]` → itemId | 1 |
| `collections` | `sdk` | `getItemCollections` | `REQUEST` | `section` | render, once item and user resolve | `item && user — issued by every class; only some render a collections section` | `[{"itemId":"$itemId","userId":"$userId","fields":["PrimaryImageAspectRatio"]}]` | `arg[0].itemId` → itemId<br>`arg[0].userId` → userId | 1 |
| `specials` | `legacy` | `getSpecialFeatures` | `REQUEST` | `section` | render, once item and user resolve | `item.SpecialFeatureCount > 0` | `["$userId","$itemId"]` | `arg[0]` → userId<br>`arg[1]` → itemId | 1 |
| `additionalParts` | `legacy` | `getAdditionalVideoParts` | `REQUEST` | `section` | render, once item and user resolve | `item.PartCount > 1` | `["$userId","$itemId"]` | `arg[0]` → userId<br>`arg[1]` → itemId | 1 |
| `artwork.scaledImageUrl` | `legacy` | `getScaledImageUrl` | `URL_BUILDER` | `render` | every render that draws artwork | `the item, or a rendered chapter, declares the image tag` | `["$itemId",[{"type":"Chapter","tag":"c1","maxWidth":400,"imageIndex":0}]]` | `arg[0]` → itemId | render-derived — the distinct option sets are frozen, the call count is not |
| `action.splitVersions.url` | `legacy` | `getUrl` | `URL_BUILDER` | `action` | activate btnSplitVersions and confirm | `user.Policy.IsAdministrator && a media source of Type "Grouping" exists` | `["Videos/${itemId}/AlternateSources"]` | `arg[0]` → itemId (embedded in the path) — NOT a media-source id | 1 |
| `action.splitVersions` | `legacy` | `ajax` | `REQUEST` | `action` | activate btnSplitVersions and confirm | `user.Policy.IsAdministrator && a media source of Type "Grouping" exists` | `[{"type":"DELETE","url":"@path:Videos/${itemId}/AlternateSources"}]` | `arg[0].url` → itemId (embedded in the path) — NOT a media-source id | 1 |

<details><summary>Declared absences — reads this class must NOT issue</summary>

| Signature | Why it is absent |
| --- | --- |
| `children.seasons` | item.Type is "Movie", not "Series" |
| `children.episodes` | item.Type is "Movie", not "Season" |
| `children.itemsByName` | item.Type "Movie" is not an items-by-name type |
| `children.playlist` | item.Type is "Movie", not "Playlist" |
| `children.folder` | item.IsFolder is not true |
| `moreFromSeason` | item.Type is "Movie", not "Episode" |
| `nextUp` | item.Type is "Movie", not "Series" |
| `seriesSchedule` | item.Type is "Movie", not "Series" |
| `musicVideos` | item.Type is "Movie", not "MusicAlbum" |
| `moreFromArtist` | hasMoreFromArtist is false for item.Type "Movie" |
| `lyrics` | item.Type is "Movie", not "Audio" |
| `channelGuide` | item.Type is "Movie", not "TvChannel" |
| `seriesTimerSchedule` | item.Type is "Movie", not "SeriesTimer" |
| `recordingFields.program` | item.Type is "Movie", not "Program" |

</details>

### `movie-grouped-regular`

Route parameters: `id` = `movie-grouped`.

| Row | Surface | Member | Kind | Phase | Trigger | Guard | Arguments | Identity | Cardinality |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `primary.item` | `legacy` | `getItem` | `REQUEST` | `primary` | route mount with a resolved lookup parameter | `params.kind === "id"` | `["$userId","$itemId"]` | `arg[0]` → userId | 1 |
| `primary.user` | `legacy` | `getCurrentUser` | `REQUEST` | `primary` | route mount, in the same Promise.all as primary.item | `params.kind !== null` | `[]` | — | 1 |
| `primary.currentUserId` | `legacy` | `getCurrentUserId` | `LOCAL_ACCESSOR` | `primary` | every adapter call that needs the acting user id | `none` | `[]` | — | call-site-derived |
| `subscription.userData` | `legacy` | `subscribe` | `SUBSCRIPTION` | `subscription` | useUserDataRefresh mount effect, once the item is known | `item is defined` | `[["UserDataChanged"]]` | — | 1 |
| `similar` | `legacy` | `getSimilarItems` | `REQUEST` | `section` | render, once the item resolves | `item.Type "Movie" is in SIMILAR_TYPES — issued whether or not a related section renders (invariant 16)` | `["$itemId",{"userId":"$userId","limit":12,"fields":"PrimaryImageAspectRatio,CanDelete"}]` | `arg[0]` → itemId | 1 |
| `collections` | `sdk` | `getItemCollections` | `REQUEST` | `section` | render, once item and user resolve | `item && user — issued by every class; only some render a collections section` | `[{"itemId":"$itemId","userId":"$userId","fields":["PrimaryImageAspectRatio"]}]` | `arg[0].itemId` → itemId<br>`arg[0].userId` → userId | 1 |
| `specials` | `legacy` | `getSpecialFeatures` | `REQUEST` | `section` | render, once item and user resolve | `item.SpecialFeatureCount > 0` | `["$userId","$itemId"]` | `arg[0]` → userId<br>`arg[1]` → itemId | 1 |
| `additionalParts` | `legacy` | `getAdditionalVideoParts` | `REQUEST` | `section` | render, once item and user resolve | `item.PartCount > 1` | `["$userId","$itemId"]` | `arg[0]` → userId<br>`arg[1]` → itemId | 1 |
| `artwork.scaledImageUrl` | `legacy` | `getScaledImageUrl` | `URL_BUILDER` | `render` | every render that draws artwork | `the item, or a rendered chapter, declares the image tag` | `["$itemId",[{"type":"Chapter","tag":"c1","maxWidth":400,"imageIndex":0}]]` | `arg[0]` → itemId | render-derived — the distinct option sets are frozen, the call count is not |

<details><summary>Declared absences — reads this class must NOT issue</summary>

| Signature | Why it is absent |
| --- | --- |
| `children.seasons` | item.Type is "Movie", not "Series" |
| `children.episodes` | item.Type is "Movie", not "Season" |
| `children.itemsByName` | item.Type "Movie" is not an items-by-name type |
| `children.playlist` | item.Type is "Movie", not "Playlist" |
| `children.folder` | item.IsFolder is not true |
| `moreFromSeason` | item.Type is "Movie", not "Episode" |
| `nextUp` | item.Type is "Movie", not "Series" |
| `seriesSchedule` | item.Type is "Movie", not "Series" |
| `musicVideos` | item.Type is "Movie", not "MusicAlbum" |
| `moreFromArtist` | hasMoreFromArtist is false for item.Type "Movie" |
| `lyrics` | item.Type is "Movie", not "Audio" |
| `channelGuide` | item.Type is "Movie", not "TvChannel" |
| `seriesTimerSchedule` | item.Type is "Movie", not "SeriesTimer" |
| `recordingFields.program` | item.Type is "Movie", not "Program" |

</details>

### `minimal-video`

Route parameters: `id` = `minimal-1`.

| Row | Surface | Member | Kind | Phase | Trigger | Guard | Arguments | Identity | Cardinality |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `primary.item` | `legacy` | `getItem` | `REQUEST` | `primary` | route mount with a resolved lookup parameter | `params.kind === "id"` | `["$userId","$itemId"]` | `arg[0]` → userId | 1 |
| `primary.user` | `legacy` | `getCurrentUser` | `REQUEST` | `primary` | route mount, in the same Promise.all as primary.item | `params.kind !== null` | `[]` | — | 1 |
| `primary.currentUserId` | `legacy` | `getCurrentUserId` | `LOCAL_ACCESSOR` | `primary` | every adapter call that needs the acting user id | `none` | `[]` | — | call-site-derived |
| `subscription.userData` | `legacy` | `subscribe` | `SUBSCRIPTION` | `subscription` | useUserDataRefresh mount effect, once the item is known | `item is defined` | `[["UserDataChanged"]]` | — | 1 |
| `similar` | `legacy` | `getSimilarItems` | `REQUEST` | `section` | render, once the item resolves | `item.Type "Movie" is in SIMILAR_TYPES — issued whether or not a related section renders (invariant 16)` | `["$itemId",{"userId":"$userId","limit":12,"fields":"PrimaryImageAspectRatio,CanDelete"}]` | `arg[0]` → itemId | 1 |
| `collections` | `sdk` | `getItemCollections` | `REQUEST` | `section` | render, once item and user resolve | `item && user — issued by every class; only some render a collections section` | `[{"itemId":"$itemId","userId":"$userId","fields":["PrimaryImageAspectRatio"]}]` | `arg[0].itemId` → itemId<br>`arg[0].userId` → userId | 1 |

<details><summary>Declared absences — reads this class must NOT issue</summary>

| Signature | Why it is absent |
| --- | --- |
| `children.seasons` | item.Type is "Movie", not "Series" |
| `children.episodes` | item.Type is "Movie", not "Season" |
| `children.itemsByName` | item.Type "Movie" is not an items-by-name type |
| `children.playlist` | item.Type is "Movie", not "Playlist" |
| `children.folder` | item.IsFolder is not true |
| `moreFromSeason` | item.Type is "Movie", not "Episode" |
| `nextUp` | item.Type is "Movie", not "Series" |
| `seriesSchedule` | item.Type is "Movie", not "Series" |
| `specials` | item.SpecialFeatureCount is 0, not greater than 0 |
| `additionalParts` | item.PartCount is 0, not greater than 1 |
| `musicVideos` | item.Type is "Movie", not "MusicAlbum" |
| `moreFromArtist` | hasMoreFromArtist is false for item.Type "Movie" |
| `lyrics` | item.Type is "Movie", not "Audio" |
| `channelGuide` | item.Type is "Movie", not "TvChannel" |
| `seriesTimerSchedule` | item.Type is "Movie", not "SeriesTimer" |
| `recordingFields.program` | item.Type is "Movie", not "Program" |

</details>

### `series`

Route parameters: `id` = `series-1`.
Child container: `listChildrenCollapsible`.

| Row | Surface | Member | Kind | Phase | Trigger | Guard | Arguments | Identity | Cardinality |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `primary.item` | `legacy` | `getItem` | `REQUEST` | `primary` | route mount with a resolved lookup parameter | `params.kind === "id"` | `["$userId","$itemId"]` | `arg[0]` → userId | 1 |
| `primary.user` | `legacy` | `getCurrentUser` | `REQUEST` | `primary` | route mount, in the same Promise.all as primary.item | `params.kind !== null` | `[]` | — | 1 |
| `primary.currentUserId` | `legacy` | `getCurrentUserId` | `LOCAL_ACCESSOR` | `primary` | every adapter call that needs the acting user id | `none` | `[]` | — | call-site-derived |
| `subscription.userData` | `legacy` | `subscribe` | `SUBSCRIPTION` | `subscription` | useUserDataRefresh mount effect, once the item is known | `item is defined` | `[["UserDataChanged"]]` | — | 1 |
| `children.seasons` | `legacy` | `getSeasons` | `REQUEST` | `section` | render, once item and user resolve | `childrenKind(item) === "seasons" (item.Type === "Series")` | `["$itemId",{"userId":"$userId","Fields":"ItemCounts,PrimaryImageAspectRatio,CanDelete,MediaSourceCount"}]` | `arg[0]` → itemId | 1 |
| `nextUp` | `legacy` | `getNextUpEpisodes` | `REQUEST` | `section` | render, once item and user resolve | `item.Type === "Series" && user` | `[{"SeriesId":"$itemId","UserId":"$userId","Fields":"MediaSourceCount"}]` | `arg[0].SeriesId` → itemId | 1 |
| `seriesSchedule` | `legacy` | `getLiveTvPrograms` | `REQUEST` | `section` | render, once the item resolves | `item.Type === "Series"` | `[{"UserId":"$userId","ImageTypeLimit":1,"HasAired":false,"SortBy":"StartDate","EnableTotalRecordCount":false,"Limit":50,"EnableUserData":false,"Fields":"ChannelInfo,ChannelImage","LibrarySeriesId":"$itemId"}]` | `arg[0].LibrarySeriesId` → itemId | 1 |
| `similar` | `legacy` | `getSimilarItems` | `REQUEST` | `section` | render, once the item resolves | `item.Type "Series" is in SIMILAR_TYPES — issued whether or not a related section renders (invariant 16)` | `["$itemId",{"userId":"$userId","limit":12,"fields":"PrimaryImageAspectRatio,CanDelete"}]` | `arg[0]` → itemId | 1 |
| `collections` | `sdk` | `getItemCollections` | `REQUEST` | `section` | render, once item and user resolve | `item && user — issued by every class; only some render a collections section` | `[{"itemId":"$itemId","userId":"$userId","fields":["PrimaryImageAspectRatio"]}]` | `arg[0].itemId` → itemId<br>`arg[0].userId` → userId | 1 |

<details><summary>Declared absences — reads this class must NOT issue</summary>

| Signature | Why it is absent |
| --- | --- |
| `children.episodes` | item.Type is "Series", not "Season" |
| `children.itemsByName` | item.Type "Series" is not an items-by-name type |
| `children.playlist` | item.Type is "Series", not "Playlist" |
| `children.folder` | a more specific child kind applies |
| `moreFromSeason` | item.Type is "Series", not "Episode" |
| `specials` | item.SpecialFeatureCount is 0, not greater than 0 |
| `additionalParts` | item.PartCount is 0, not greater than 1 |
| `musicVideos` | item.Type is "Series", not "MusicAlbum" |
| `moreFromArtist` | hasMoreFromArtist is false for item.Type "Series" |
| `lyrics` | item.Type is "Series", not "Audio" |
| `channelGuide` | item.Type is "Series", not "TvChannel" |
| `seriesTimerSchedule` | item.Type is "Series", not "SeriesTimer" |
| `recordingFields.program` | item.Type is "Series", not "Program" |

</details>

### `season`

Route parameters: `id` = `season-1`.
Child container: `listChildrenCollapsible`.

| Row | Surface | Member | Kind | Phase | Trigger | Guard | Arguments | Identity | Cardinality |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `primary.item` | `legacy` | `getItem` | `REQUEST` | `primary` | route mount with a resolved lookup parameter | `params.kind === "id"` | `["$userId","$itemId"]` | `arg[0]` → userId | 1 |
| `primary.user` | `legacy` | `getCurrentUser` | `REQUEST` | `primary` | route mount, in the same Promise.all as primary.item | `params.kind !== null` | `[]` | — | 1 |
| `primary.currentUserId` | `legacy` | `getCurrentUserId` | `LOCAL_ACCESSOR` | `primary` | every adapter call that needs the acting user id | `none` | `[]` | — | call-site-derived |
| `subscription.userData` | `legacy` | `subscribe` | `SUBSCRIPTION` | `subscription` | useUserDataRefresh mount effect, once the item is known | `item is defined` | `[["UserDataChanged"]]` | — | 1 |
| `children.episodes` | `legacy` | `getEpisodes` | `REQUEST` | `section` | render, once item and user resolve | `childrenKind(item) === "episodes" (item.Type === "Season")` | `["$seriesId",{"seasonId":"$itemId","userId":"$userId","Fields":"ItemCounts,PrimaryImageAspectRatio,CanDelete,MediaSourceCount,Overview"}]` | `arg[0]` → seriesId<br>`arg[1].seasonId` → itemId | 1 |
| `collections` | `sdk` | `getItemCollections` | `REQUEST` | `section` | render, once item and user resolve | `item && user — issued by every class; only some render a collections section` | `[{"itemId":"$itemId","userId":"$userId","fields":["PrimaryImageAspectRatio"]}]` | `arg[0].itemId` → itemId<br>`arg[0].userId` → userId | 1 |

<details><summary>Declared absences — reads this class must NOT issue</summary>

| Signature | Why it is absent |
| --- | --- |
| `children.seasons` | item.Type is "Season", not "Series" |
| `children.itemsByName` | item.Type "Season" is not an items-by-name type |
| `children.playlist` | item.Type is "Season", not "Playlist" |
| `children.folder` | a more specific child kind applies |
| `moreFromSeason` | item.Type is "Season", not "Episode" |
| `nextUp` | item.Type is "Season", not "Series" |
| `seriesSchedule` | item.Type is "Season", not "Series" |
| `similar` | item.Type "Season" is not in SIMILAR_TYPES |
| `specials` | item.SpecialFeatureCount is 0, not greater than 0 |
| `additionalParts` | item.PartCount is 0, not greater than 1 |
| `musicVideos` | item.Type is "Season", not "MusicAlbum" |
| `moreFromArtist` | hasMoreFromArtist is false for item.Type "Season" |
| `lyrics` | item.Type is "Season", not "Audio" |
| `channelGuide` | item.Type is "Season", not "TvChannel" |
| `seriesTimerSchedule` | item.Type is "Season", not "SeriesTimer" |
| `recordingFields.program` | item.Type is "Season", not "Program" |

</details>

### `episode`

Route parameters: `id` = `episode-1`.

| Row | Surface | Member | Kind | Phase | Trigger | Guard | Arguments | Identity | Cardinality |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `primary.item` | `legacy` | `getItem` | `REQUEST` | `primary` | route mount with a resolved lookup parameter | `params.kind === "id"` | `["$userId","$itemId"]` | `arg[0]` → userId | 1 |
| `primary.user` | `legacy` | `getCurrentUser` | `REQUEST` | `primary` | route mount, in the same Promise.all as primary.item | `params.kind !== null` | `[]` | — | 1 |
| `primary.currentUserId` | `legacy` | `getCurrentUserId` | `LOCAL_ACCESSOR` | `primary` | every adapter call that needs the acting user id | `none` | `[]` | — | call-site-derived |
| `subscription.userData` | `legacy` | `subscribe` | `SUBSCRIPTION` | `subscription` | useUserDataRefresh mount effect, once the item is known | `item is defined` | `[["UserDataChanged"]]` | — | 1 |
| `moreFromSeason` | `legacy` | `getEpisodes` | `REQUEST` | `section` | render, once the item resolves | `item.Type === "Episode" && item.SeasonId && item.SeriesId` | `["$seriesId",{"SeasonId":"$seasonId","UserId":"$userId","Fields":"ItemCounts,PrimaryImageAspectRatio,CanDelete,MediaSourceCount"}]` | `arg[0]` → seriesId<br>`arg[1].SeasonId` → seasonId | 1 |
| `collections` | `sdk` | `getItemCollections` | `REQUEST` | `section` | render, once item and user resolve | `item && user — issued by every class; only some render a collections section` | `[{"itemId":"$itemId","userId":"$userId","fields":["PrimaryImageAspectRatio"]}]` | `arg[0].itemId` → itemId<br>`arg[0].userId` → userId | 1 |

<details><summary>Declared absences — reads this class must NOT issue</summary>

| Signature | Why it is absent |
| --- | --- |
| `children.seasons` | item.Type is "Episode", not "Series" |
| `children.episodes` | item.Type is "Episode", not "Season" |
| `children.itemsByName` | item.Type "Episode" is not an items-by-name type |
| `children.playlist` | item.Type is "Episode", not "Playlist" |
| `children.folder` | item.IsFolder is not true |
| `nextUp` | item.Type is "Episode", not "Series" |
| `seriesSchedule` | item.Type is "Episode", not "Series" |
| `similar` | item.Type "Episode" is not in SIMILAR_TYPES |
| `specials` | item.SpecialFeatureCount is 0, not greater than 0 |
| `additionalParts` | item.PartCount is 0, not greater than 1 |
| `musicVideos` | item.Type is "Episode", not "MusicAlbum" |
| `moreFromArtist` | hasMoreFromArtist is false for item.Type "Episode" |
| `lyrics` | item.Type is "Episode", not "Audio" |
| `channelGuide` | item.Type is "Episode", not "TvChannel" |
| `seriesTimerSchedule` | item.Type is "Episode", not "SeriesTimer" |
| `recordingFields.program` | item.Type is "Episode", not "Program" |

</details>

### `music-album`

Route parameters: `id` = `album-1`.
Child container: `listChildrenCollapsible`.

| Row | Surface | Member | Kind | Phase | Trigger | Guard | Arguments | Identity | Cardinality |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `primary.item` | `legacy` | `getItem` | `REQUEST` | `primary` | route mount with a resolved lookup parameter | `params.kind === "id"` | `["$userId","$itemId"]` | `arg[0]` → userId | 1 |
| `primary.user` | `legacy` | `getCurrentUser` | `REQUEST` | `primary` | route mount, in the same Promise.all as primary.item | `params.kind !== null` | `[]` | — | 1 |
| `primary.currentUserId` | `legacy` | `getCurrentUserId` | `LOCAL_ACCESSOR` | `primary` | every adapter call that needs the acting user id | `none` | `[]` | — | call-site-derived |
| `subscription.userData` | `legacy` | `subscribe` | `SUBSCRIPTION` | `subscription` | useUserDataRefresh mount effect, once the item is known | `item is defined` | `[["UserDataChanged"]]` | — | 1 |
| `children.folder` | `legacy` | `getItems` | `REQUEST` | `section` | render, once item and user resolve | `childrenKind(item) === "folder" (item.IsFolder)` | `["$userId",{"ParentId":"$itemId","Fields":"ItemCounts,PrimaryImageAspectRatio,CanDelete,MediaSourceCount","SortBy":"ParentIndexNumber,IndexNumber,SortName"}]` | `arg[0]` → userId<br>`arg[1].ParentId` → itemId | 1 |
| `similar` | `legacy` | `getSimilarItems` | `REQUEST` | `section` | render, once the item resolves | `item.Type "MusicAlbum" is in SIMILAR_TYPES — issued whether or not a related section renders (invariant 16)` | `["$itemId",{"userId":"$userId","limit":12,"fields":"PrimaryImageAspectRatio,CanDelete","ExcludeArtistIds":"$albumArtistId.0"}]` | `arg[0]` → itemId | 1 |
| `collections` | `sdk` | `getItemCollections` | `REQUEST` | `section` | render, once item and user resolve | `item && user — issued by every class; only some render a collections section` | `[{"itemId":"$itemId","userId":"$userId","fields":["PrimaryImageAspectRatio"]}]` | `arg[0].itemId` → itemId<br>`arg[0].userId` → userId | 1 |
| `musicVideos` | `legacy` | `getItems` | `REQUEST` | `section` | render, once item and user resolve | `item.Type === "MusicAlbum" && user` | `["$userId",{"SortBy":"SortName","SortOrder":"Ascending","IncludeItemTypes":"MusicVideo","Recursive":true,"Fields":"PrimaryImageAspectRatio,CanDelete,MediaSourceCount","AlbumIds":"$itemId"}]` | `arg[0]` → userId<br>`arg[1].AlbumIds` → itemId | 1 |
| `moreFromArtist` | `legacy` | `getItems` | `REQUEST` | `section` | render, once the item resolves | `hasMoreFromArtist(item)` | `["$userId",{"IncludeItemTypes":"MusicAlbum","Recursive":true,"ExcludeItemIds":"$itemId","SortBy":"PremiereDate,ProductionYear,SortName","SortOrder":"Descending","AlbumArtistIds":"$albumArtistId.0"}]` | `arg[0]` → userId<br>`arg[1].ExcludeItemIds` → itemId | 1 |

<details><summary>Declared absences — reads this class must NOT issue</summary>

| Signature | Why it is absent |
| --- | --- |
| `children.seasons` | item.Type is "MusicAlbum", not "Series" |
| `children.episodes` | item.Type is "MusicAlbum", not "Season" |
| `children.itemsByName` | item.Type "MusicAlbum" is not an items-by-name type |
| `children.playlist` | item.Type is "MusicAlbum", not "Playlist" |
| `moreFromSeason` | item.Type is "MusicAlbum", not "Episode" |
| `nextUp` | item.Type is "MusicAlbum", not "Series" |
| `seriesSchedule` | item.Type is "MusicAlbum", not "Series" |
| `specials` | item.SpecialFeatureCount is 0, not greater than 0 |
| `additionalParts` | item.PartCount is 0, not greater than 1 |
| `lyrics` | item.Type is "MusicAlbum", not "Audio" |
| `channelGuide` | item.Type is "MusicAlbum", not "TvChannel" |
| `seriesTimerSchedule` | item.Type is "MusicAlbum", not "SeriesTimer" |
| `recordingFields.program` | item.Type is "MusicAlbum", not "Program" |

</details>

### `audio`

Route parameters: `id` = `audio-1`.

| Row | Surface | Member | Kind | Phase | Trigger | Guard | Arguments | Identity | Cardinality |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `primary.item` | `legacy` | `getItem` | `REQUEST` | `primary` | route mount with a resolved lookup parameter | `params.kind === "id"` | `["$userId","$itemId"]` | `arg[0]` → userId | 1 |
| `primary.user` | `legacy` | `getCurrentUser` | `REQUEST` | `primary` | route mount, in the same Promise.all as primary.item | `params.kind !== null` | `[]` | — | 1 |
| `primary.currentUserId` | `legacy` | `getCurrentUserId` | `LOCAL_ACCESSOR` | `primary` | every adapter call that needs the acting user id | `none` | `[]` | — | call-site-derived |
| `subscription.userData` | `legacy` | `subscribe` | `SUBSCRIPTION` | `subscription` | useUserDataRefresh mount effect, once the item is known | `item is defined` | `[["UserDataChanged"]]` | — | 1 |
| `similar` | `legacy` | `getSimilarItems` | `REQUEST` | `section` | render, once the item resolves | `item.Type "Audio" is in SIMILAR_TYPES — issued whether or not a related section renders (invariant 16)` | `["$itemId",{"userId":"$userId","limit":12,"fields":"PrimaryImageAspectRatio,CanDelete"}]` | `arg[0]` → itemId | 1 |
| `collections` | `sdk` | `getItemCollections` | `REQUEST` | `section` | render, once item and user resolve | `item && user — issued by every class; only some render a collections section` | `[{"itemId":"$itemId","userId":"$userId","fields":["PrimaryImageAspectRatio"]}]` | `arg[0].itemId` → itemId<br>`arg[0].userId` → userId | 1 |
| `moreFromArtist` | `legacy` | `getItems` | `REQUEST` | `section` | render, once the item resolves | `hasMoreFromArtist(item)` | `["$userId",{"IncludeItemTypes":"MusicAlbum","Recursive":true,"ExcludeItemIds":"$itemId","SortBy":"PremiereDate,ProductionYear,SortName","SortOrder":"Descending","AlbumArtistIds":"$albumArtistId.0"}]` | `arg[0]` → userId<br>`arg[1].ExcludeItemIds` → itemId | 1 |
| `lyrics.url` | `legacy` | `getUrl` | `URL_BUILDER` | `section` | render, immediately before lyrics | `item.Type === "Audio" && item.HasLyrics` | `["Audio/${itemId}/Lyrics"]` | — | 1 |
| `lyrics` | `legacy` | `ajax` | `REQUEST` | `section` | render, once the item resolves | `item.Type === "Audio" && item.HasLyrics (delta D5: the legacy route never cleared this section)` | `[{"url":"@path:Audio/${itemId}/Lyrics","type":"GET","dataType":"json"}]` | `arg[0].url` → itemId (embedded in the path) | 1 |

<details><summary>Declared absences — reads this class must NOT issue</summary>

| Signature | Why it is absent |
| --- | --- |
| `children.seasons` | item.Type is "Audio", not "Series" |
| `children.episodes` | item.Type is "Audio", not "Season" |
| `children.itemsByName` | item.Type "Audio" is not an items-by-name type |
| `children.playlist` | item.Type is "Audio", not "Playlist" |
| `children.folder` | item.IsFolder is not true |
| `moreFromSeason` | item.Type is "Audio", not "Episode" |
| `nextUp` | item.Type is "Audio", not "Series" |
| `seriesSchedule` | item.Type is "Audio", not "Series" |
| `specials` | item.SpecialFeatureCount is 0, not greater than 0 |
| `additionalParts` | item.PartCount is 0, not greater than 1 |
| `musicVideos` | item.Type is "Audio", not "MusicAlbum" |
| `channelGuide` | item.Type is "Audio", not "TvChannel" |
| `seriesTimerSchedule` | item.Type is "Audio", not "SeriesTimer" |
| `recordingFields.program` | item.Type is "Audio", not "Program" |

</details>

### `music-artist`

Route parameters: `id` = `artist-1`.
Child container: `listChildrenCollapsible`.

| Row | Surface | Member | Kind | Phase | Trigger | Guard | Arguments | Identity | Cardinality |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `primary.item` | `legacy` | `getItem` | `REQUEST` | `primary` | route mount with a resolved lookup parameter | `params.kind === "id"` | `["$userId","$itemId"]` | `arg[0]` → userId | 1 |
| `primary.user` | `legacy` | `getCurrentUser` | `REQUEST` | `primary` | route mount, in the same Promise.all as primary.item | `params.kind !== null` | `[]` | — | 1 |
| `primary.currentUserId` | `legacy` | `getCurrentUserId` | `LOCAL_ACCESSOR` | `primary` | every adapter call that needs the acting user id | `none` | `[]` | — | call-site-derived |
| `subscription.userData` | `legacy` | `subscribe` | `SUBSCRIPTION` | `subscription` | useUserDataRefresh mount effect, once the item is known | `item is defined` | `[["UserDataChanged"]]` | — | 1 |
| `children.itemsByName` | `legacy` | `getItems` | `REQUEST` | `section` | render, once item and user resolve | `childrenKind(item) === "itemsByName" (item.Type "MusicArtist" is in ITEMS_BY_NAME_TYPES)` | `["$userId",{"SortBy":"PremiereDate,ProductionYear,SortName","SortOrder":"Ascending","Recursive":true,"Fields":"ItemCounts,PrimaryImageAspectRatio,CanDelete,MediaSourceCount","CollapseBoxSetItems":false,"ArtistIds":"$itemId"}]` | `arg[0]` → userId | 1 |
| `similar` | `legacy` | `getSimilarItems` | `REQUEST` | `section` | render, once the item resolves | `item.Type "MusicArtist" is in SIMILAR_TYPES — issued whether or not a related section renders (invariant 16)` | `["$itemId",{"userId":"$userId","limit":12,"fields":"PrimaryImageAspectRatio,CanDelete"}]` | `arg[0]` → itemId | 1 |
| `collections` | `sdk` | `getItemCollections` | `REQUEST` | `section` | render, once item and user resolve | `item && user — issued by every class; only some render a collections section` | `[{"itemId":"$itemId","userId":"$userId","fields":["PrimaryImageAspectRatio"]}]` | `arg[0].itemId` → itemId<br>`arg[0].userId` → userId | 1 |
| `moreFromArtist` | `legacy` | `getItems` | `REQUEST` | `section` | render, once the item resolves | `hasMoreFromArtist(item)` | `["$userId",{"IncludeItemTypes":"MusicAlbum","Recursive":true,"ExcludeItemIds":"$itemId","SortBy":"PremiereDate,ProductionYear,SortName","SortOrder":"Descending","ContributingArtistIds":"$itemId"}]` | `arg[0]` → userId<br>`arg[1].ExcludeItemIds` → itemId | 1 |

<details><summary>Declared absences — reads this class must NOT issue</summary>

| Signature | Why it is absent |
| --- | --- |
| `children.seasons` | item.Type is "MusicArtist", not "Series" |
| `children.episodes` | item.Type is "MusicArtist", not "Season" |
| `children.playlist` | item.Type is "MusicArtist", not "Playlist" |
| `children.folder` | a more specific child kind applies |
| `moreFromSeason` | item.Type is "MusicArtist", not "Episode" |
| `nextUp` | item.Type is "MusicArtist", not "Series" |
| `seriesSchedule` | item.Type is "MusicArtist", not "Series" |
| `specials` | item.SpecialFeatureCount is 0, not greater than 0 |
| `additionalParts` | item.PartCount is 0, not greater than 1 |
| `musicVideos` | item.Type is "MusicArtist", not "MusicAlbum" |
| `lyrics` | item.Type is "MusicArtist", not "Audio" |
| `channelGuide` | item.Type is "MusicArtist", not "TvChannel" |
| `seriesTimerSchedule` | item.Type is "MusicArtist", not "SeriesTimer" |
| `recordingFields.program` | item.Type is "MusicArtist", not "Program" |

</details>

### `playlist`

Route parameters: `id` = `playlist-1`.
Child container: `listChildrenCollapsible`.

| Row | Surface | Member | Kind | Phase | Trigger | Guard | Arguments | Identity | Cardinality |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `primary.item` | `legacy` | `getItem` | `REQUEST` | `primary` | route mount with a resolved lookup parameter | `params.kind === "id"` | `["$userId","$itemId"]` | `arg[0]` → userId | 1 |
| `primary.user` | `legacy` | `getCurrentUser` | `REQUEST` | `primary` | route mount, in the same Promise.all as primary.item | `params.kind !== null` | `[]` | — | 1 |
| `primary.currentUserId` | `legacy` | `getCurrentUserId` | `LOCAL_ACCESSOR` | `primary` | every adapter call that needs the acting user id | `none` | `[]` | — | call-site-derived |
| `subscription.userData` | `legacy` | `subscribe` | `SUBSCRIPTION` | `subscription` | useUserDataRefresh mount effect, once the item is known | `item is defined` | `[["UserDataChanged"]]` | — | 1 |
| `children.playlist.url` | `legacy` | `getUrl` | `URL_BUILDER` | `section` | render, immediately before children.playlist | `childrenKind(item) === "playlist"` | `["Playlists/${itemId}/Items?UserId=${userId}&Fields=ItemCounts,PrimaryImageAspectRatio,CanDelete,MediaSourceCount"]` | — | 1 |
| `children.playlist` | `legacy` | `getJSON` | `REQUEST` | `section` | render, once item and user resolve | `childrenKind(item) === "playlist"` | `["@path:Playlists/${itemId}/Items?UserId=${userId}&Fields=ItemCounts,PrimaryImageAspectRatio,CanDelete,MediaSourceCount"]` | `arg[0]` → itemId (embedded in the path) | 1 |
| `similar` | `legacy` | `getSimilarItems` | `REQUEST` | `section` | render, once the item resolves | `item.Type "Playlist" is in SIMILAR_TYPES — issued whether or not a related section renders (invariant 16)` | `["$itemId",{"userId":"$userId","limit":12,"fields":"PrimaryImageAspectRatio,CanDelete"}]` | `arg[0]` → itemId | 1 |
| `collections` | `sdk` | `getItemCollections` | `REQUEST` | `section` | render, once item and user resolve | `item && user — issued by every class; only some render a collections section` | `[{"itemId":"$itemId","userId":"$userId","fields":["PrimaryImageAspectRatio"]}]` | `arg[0].itemId` → itemId<br>`arg[0].userId` → userId | 1 |

<details><summary>Declared absences — reads this class must NOT issue</summary>

| Signature | Why it is absent |
| --- | --- |
| `children.seasons` | item.Type is "Playlist", not "Series" |
| `children.episodes` | item.Type is "Playlist", not "Season" |
| `children.itemsByName` | item.Type "Playlist" is not an items-by-name type |
| `children.folder` | a more specific child kind applies |
| `moreFromSeason` | item.Type is "Playlist", not "Episode" |
| `nextUp` | item.Type is "Playlist", not "Series" |
| `seriesSchedule` | item.Type is "Playlist", not "Series" |
| `specials` | item.SpecialFeatureCount is 0, not greater than 0 |
| `additionalParts` | item.PartCount is 0, not greater than 1 |
| `musicVideos` | item.Type is "Playlist", not "MusicAlbum" |
| `moreFromArtist` | hasMoreFromArtist is false for item.Type "Playlist" |
| `lyrics` | item.Type is "Playlist", not "Audio" |
| `channelGuide` | item.Type is "Playlist", not "TvChannel" |
| `seriesTimerSchedule` | item.Type is "Playlist", not "SeriesTimer" |
| `recordingFields.program` | item.Type is "Playlist", not "Program" |

</details>

### `box-set`

Route parameters: `id` = `boxset-1`.
Child container: `childrenCollapsible`.

| Row | Surface | Member | Kind | Phase | Trigger | Guard | Arguments | Identity | Cardinality |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `primary.item` | `legacy` | `getItem` | `REQUEST` | `primary` | route mount with a resolved lookup parameter | `params.kind === "id"` | `["$userId","$itemId"]` | `arg[0]` → userId | 1 |
| `primary.user` | `legacy` | `getCurrentUser` | `REQUEST` | `primary` | route mount, in the same Promise.all as primary.item | `params.kind !== null` | `[]` | — | 1 |
| `primary.currentUserId` | `legacy` | `getCurrentUserId` | `LOCAL_ACCESSOR` | `primary` | every adapter call that needs the acting user id | `none` | `[]` | — | call-site-derived |
| `subscription.userData` | `legacy` | `subscribe` | `SUBSCRIPTION` | `subscription` | useUserDataRefresh mount effect, once the item is known | `item is defined` | `[["UserDataChanged"]]` | — | 1 |
| `children.folder` | `legacy` | `getItems` | `REQUEST` | `section` | render, once item and user resolve | `childrenKind(item) === "folder" (item.IsFolder)` | `["$userId",{"ParentId":"$itemId","Fields":"ItemCounts,PrimaryImageAspectRatio,CanDelete,MediaSourceCount"}]` | `arg[0]` → userId<br>`arg[1].ParentId` → itemId | 1 |
| `collections` | `sdk` | `getItemCollections` | `REQUEST` | `section` | render, once item and user resolve | `item && user — issued by every class; only some render a collections section` | `[{"itemId":"$itemId","userId":"$userId","fields":["PrimaryImageAspectRatio"]}]` | `arg[0].itemId` → itemId<br>`arg[0].userId` → userId | 1 |

<details><summary>Declared absences — reads this class must NOT issue</summary>

| Signature | Why it is absent |
| --- | --- |
| `children.seasons` | item.Type is "BoxSet", not "Series" |
| `children.episodes` | item.Type is "BoxSet", not "Season" |
| `children.itemsByName` | item.Type "BoxSet" is not an items-by-name type |
| `children.playlist` | item.Type is "BoxSet", not "Playlist" |
| `moreFromSeason` | item.Type is "BoxSet", not "Episode" |
| `nextUp` | item.Type is "BoxSet", not "Series" |
| `seriesSchedule` | item.Type is "BoxSet", not "Series" |
| `similar` | item.Type "BoxSet" is not in SIMILAR_TYPES |
| `specials` | item.SpecialFeatureCount is 0, not greater than 0 |
| `additionalParts` | item.PartCount is 0, not greater than 1 |
| `musicVideos` | item.Type is "BoxSet", not "MusicAlbum" |
| `moreFromArtist` | hasMoreFromArtist is false for item.Type "BoxSet" |
| `lyrics` | item.Type is "BoxSet", not "Audio" |
| `channelGuide` | item.Type is "BoxSet", not "TvChannel" |
| `seriesTimerSchedule` | item.Type is "BoxSet", not "SeriesTimer" |
| `recordingFields.program` | item.Type is "BoxSet", not "Program" |

</details>

### `person`

Route parameters: `id` = `person-1`.
Child container: `listChildrenCollapsible`.

| Row | Surface | Member | Kind | Phase | Trigger | Guard | Arguments | Identity | Cardinality |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `primary.item` | `legacy` | `getItem` | `REQUEST` | `primary` | route mount with a resolved lookup parameter | `params.kind === "id"` | `["$userId","$itemId"]` | `arg[0]` → userId | 1 |
| `primary.user` | `legacy` | `getCurrentUser` | `REQUEST` | `primary` | route mount, in the same Promise.all as primary.item | `params.kind !== null` | `[]` | — | 1 |
| `primary.currentUserId` | `legacy` | `getCurrentUserId` | `LOCAL_ACCESSOR` | `primary` | every adapter call that needs the acting user id | `none` | `[]` | — | call-site-derived |
| `subscription.userData` | `legacy` | `subscribe` | `SUBSCRIPTION` | `subscription` | useUserDataRefresh mount effect, once the item is known | `item is defined` | `[["UserDataChanged"]]` | — | 1 |
| `children.itemsByName` | `legacy` | `getItems` | `REQUEST` | `section` | render, once item and user resolve | `childrenKind(item) === "itemsByName" (item.Type "Person" is in ITEMS_BY_NAME_TYPES)` | `["$userId",{"SortBy":"SortName","SortOrder":"Ascending","Recursive":true,"Fields":"ItemCounts,PrimaryImageAspectRatio,CanDelete,MediaSourceCount","CollapseBoxSetItems":false,"PersonIds":"$itemId"}]` | `arg[0]` → userId | 1 |
| `collections` | `sdk` | `getItemCollections` | `REQUEST` | `section` | render, once item and user resolve | `item && user — issued by every class; only some render a collections section` | `[{"itemId":"$itemId","userId":"$userId","fields":["PrimaryImageAspectRatio"]}]` | `arg[0].itemId` → itemId<br>`arg[0].userId` → userId | 1 |

<details><summary>Declared absences — reads this class must NOT issue</summary>

| Signature | Why it is absent |
| --- | --- |
| `children.seasons` | item.Type is "Person", not "Series" |
| `children.episodes` | item.Type is "Person", not "Season" |
| `children.playlist` | item.Type is "Person", not "Playlist" |
| `children.folder` | item.IsFolder is not true |
| `moreFromSeason` | item.Type is "Person", not "Episode" |
| `nextUp` | item.Type is "Person", not "Series" |
| `seriesSchedule` | item.Type is "Person", not "Series" |
| `similar` | item.Type "Person" is not in SIMILAR_TYPES |
| `specials` | item.SpecialFeatureCount is 0, not greater than 0 |
| `additionalParts` | item.PartCount is 0, not greater than 1 |
| `musicVideos` | item.Type is "Person", not "MusicAlbum" |
| `moreFromArtist` | hasMoreFromArtist is false for item.Type "Person" |
| `lyrics` | item.Type is "Person", not "Audio" |
| `channelGuide` | item.Type is "Person", not "TvChannel" |
| `seriesTimerSchedule` | item.Type is "Person", not "SeriesTimer" |
| `recordingFields.program` | item.Type is "Person", not "Program" |

</details>

### `book`

Route parameters: `id` = `book-1`.

| Row | Surface | Member | Kind | Phase | Trigger | Guard | Arguments | Identity | Cardinality |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `primary.item` | `legacy` | `getItem` | `REQUEST` | `primary` | route mount with a resolved lookup parameter | `params.kind === "id"` | `["$userId","$itemId"]` | `arg[0]` → userId | 1 |
| `primary.user` | `legacy` | `getCurrentUser` | `REQUEST` | `primary` | route mount, in the same Promise.all as primary.item | `params.kind !== null` | `[]` | — | 1 |
| `primary.currentUserId` | `legacy` | `getCurrentUserId` | `LOCAL_ACCESSOR` | `primary` | every adapter call that needs the acting user id | `none` | `[]` | — | call-site-derived |
| `subscription.userData` | `legacy` | `subscribe` | `SUBSCRIPTION` | `subscription` | useUserDataRefresh mount effect, once the item is known | `item is defined` | `[["UserDataChanged"]]` | — | 1 |
| `collections` | `sdk` | `getItemCollections` | `REQUEST` | `section` | render, once item and user resolve | `item && user — issued by every class; only some render a collections section` | `[{"itemId":"$itemId","userId":"$userId","fields":["PrimaryImageAspectRatio"]}]` | `arg[0].itemId` → itemId<br>`arg[0].userId` → userId | 1 |
| `action.downloadUrl` | `sdk` | `getDownloadUrl` | `URL_BUILDER` | `action` | activate btnDownload | `item.Type === "Book" && item.CanDownload` | `[{"itemId":"$itemId"}]` | `arg[0].itemId` → itemId | 1 |

<details><summary>Declared absences — reads this class must NOT issue</summary>

| Signature | Why it is absent |
| --- | --- |
| `children.seasons` | item.Type is "Book", not "Series" |
| `children.episodes` | item.Type is "Book", not "Season" |
| `children.itemsByName` | item.Type "Book" is not an items-by-name type |
| `children.playlist` | item.Type is "Book", not "Playlist" |
| `children.folder` | item.IsFolder is not true |
| `moreFromSeason` | item.Type is "Book", not "Episode" |
| `nextUp` | item.Type is "Book", not "Series" |
| `seriesSchedule` | item.Type is "Book", not "Series" |
| `similar` | item.Type "Book" is not in SIMILAR_TYPES |
| `specials` | item.SpecialFeatureCount is 0, not greater than 0 |
| `additionalParts` | item.PartCount is 0, not greater than 1 |
| `musicVideos` | item.Type is "Book", not "MusicAlbum" |
| `moreFromArtist` | hasMoreFromArtist is false for item.Type "Book" |
| `lyrics` | item.Type is "Book", not "Audio" |
| `channelGuide` | item.Type is "Book", not "TvChannel" |
| `seriesTimerSchedule` | item.Type is "Book", not "SeriesTimer" |
| `recordingFields.program` | item.Type is "Book", not "Program" |

</details>

### `photo`

Route parameters: `id` = `photo-1`.

| Row | Surface | Member | Kind | Phase | Trigger | Guard | Arguments | Identity | Cardinality |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `primary.item` | `legacy` | `getItem` | `REQUEST` | `primary` | route mount with a resolved lookup parameter | `params.kind === "id"` | `["$userId","$itemId"]` | `arg[0]` → userId | 1 |
| `primary.user` | `legacy` | `getCurrentUser` | `REQUEST` | `primary` | route mount, in the same Promise.all as primary.item | `params.kind !== null` | `[]` | — | 1 |
| `primary.currentUserId` | `legacy` | `getCurrentUserId` | `LOCAL_ACCESSOR` | `primary` | every adapter call that needs the acting user id | `none` | `[]` | — | call-site-derived |
| `subscription.userData` | `legacy` | `subscribe` | `SUBSCRIPTION` | `subscription` | useUserDataRefresh mount effect, once the item is known | `item is defined` | `[["UserDataChanged"]]` | — | 1 |
| `collections` | `sdk` | `getItemCollections` | `REQUEST` | `section` | render, once item and user resolve | `item && user — issued by every class; only some render a collections section` | `[{"itemId":"$itemId","userId":"$userId","fields":["PrimaryImageAspectRatio"]}]` | `arg[0].itemId` → itemId<br>`arg[0].userId` → userId | 1 |

<details><summary>Declared absences — reads this class must NOT issue</summary>

| Signature | Why it is absent |
| --- | --- |
| `children.seasons` | item.Type is "Photo", not "Series" |
| `children.episodes` | item.Type is "Photo", not "Season" |
| `children.itemsByName` | item.Type "Photo" is not an items-by-name type |
| `children.playlist` | item.Type is "Photo", not "Playlist" |
| `children.folder` | item.IsFolder is not true |
| `moreFromSeason` | item.Type is "Photo", not "Episode" |
| `nextUp` | item.Type is "Photo", not "Series" |
| `seriesSchedule` | item.Type is "Photo", not "Series" |
| `similar` | item.Type "Photo" is not in SIMILAR_TYPES |
| `specials` | item.SpecialFeatureCount is 0, not greater than 0 |
| `additionalParts` | item.PartCount is 0, not greater than 1 |
| `musicVideos` | item.Type is "Photo", not "MusicAlbum" |
| `moreFromArtist` | hasMoreFromArtist is false for item.Type "Photo" |
| `lyrics` | item.Type is "Photo", not "Audio" |
| `channelGuide` | item.Type is "Photo", not "TvChannel" |
| `seriesTimerSchedule` | item.Type is "Photo", not "SeriesTimer" |
| `recordingFields.program` | item.Type is "Photo", not "Program" |

</details>

### `program`

Route parameters: `id` = `program-1`.

| Row | Surface | Member | Kind | Phase | Trigger | Guard | Arguments | Identity | Cardinality |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `primary.item` | `legacy` | `getItem` | `REQUEST` | `primary` | route mount with a resolved lookup parameter | `params.kind === "id"` | `["$userId","$itemId"]` | `arg[0]` → userId | 1 |
| `primary.user` | `legacy` | `getCurrentUser` | `REQUEST` | `primary` | route mount, in the same Promise.all as primary.item | `params.kind !== null` | `[]` | — | 1 |
| `primary.currentUserId` | `legacy` | `getCurrentUserId` | `LOCAL_ACCESSOR` | `primary` | every adapter call that needs the acting user id | `none` | `[]` | — | call-site-derived |
| `subscription.userData` | `legacy` | `subscribe` | `SUBSCRIPTION` | `subscription` | useUserDataRefresh mount effect, once the item is known | `item is defined` | `[["UserDataChanged"]]` | — | 1 |
| `similar` | `legacy` | `getSimilarItems` | `REQUEST` | `section` | render, once the item resolves | `item.Type "Program" is in SIMILAR_TYPES — issued whether or not a related section renders (invariant 16)` | `["$itemId",{"userId":"$userId","limit":12,"fields":"PrimaryImageAspectRatio,CanDelete"}]` | `arg[0]` → itemId | 1 |
| `collections` | `sdk` | `getItemCollections` | `REQUEST` | `section` | render, once item and user resolve | `item && user — issued by every class; only some render a collections section` | `[{"itemId":"$itemId","userId":"$userId","fields":["PrimaryImageAspectRatio"]}]` | `arg[0].itemId` → itemId<br>`arg[0].userId` → userId | 1 |
| `recordingFields.program` | `legacy` | `getLiveTvProgram` | `REQUEST` | `delegated` | the recordingFields widget, constructed in an effect after the item resolves | `item.Type === "Program" && user.Policy.EnableLiveTvManagement` | `["$itemId","$userId"]` | `arg[0]` → itemId (the programme)<br>`arg[1]` → userId | 1 |
| `recordingFields.subscriptions` | `legacy` | `subscribe` | `SUBSCRIPTION` | `delegated` | the recordingFields widget | `item.Type === "Program" && user.Policy.EnableLiveTvManagement` | `[["TimerCreated"],["TimerCancelled"],["SeriesTimerCreated"],["SeriesTimerCancelled"]]` | — | 4 |
| `action.programChannel` | `legacy` | `getLiveTvChannel` | `REQUEST` | `action` | activate btnPlay on a Program inside its airing window | `item.Type === "Program" && item.ChannelId` | `["$channelId","$userId"]` | `arg[0]` → channelId — NOT itemId<br>`arg[1]` → userId | 1 |

<details><summary>Declared absences — reads this class must NOT issue</summary>

| Signature | Why it is absent |
| --- | --- |
| `children.seasons` | item.Type is "Program", not "Series" |
| `children.episodes` | item.Type is "Program", not "Season" |
| `children.itemsByName` | item.Type "Program" is not an items-by-name type |
| `children.playlist` | item.Type is "Program", not "Playlist" |
| `children.folder` | item.IsFolder is not true |
| `moreFromSeason` | item.Type is "Program", not "Episode" |
| `nextUp` | item.Type is "Program", not "Series" |
| `seriesSchedule` | item.Type is "Program", not "Series" |
| `specials` | item.SpecialFeatureCount is 0, not greater than 0 |
| `additionalParts` | item.PartCount is 0, not greater than 1 |
| `musicVideos` | item.Type is "Program", not "MusicAlbum" |
| `moreFromArtist` | hasMoreFromArtist is false for item.Type "Program" |
| `lyrics` | item.Type is "Program", not "Audio" |
| `channelGuide` | item.Type is "Program", not "TvChannel" |
| `seriesTimerSchedule` | item.Type is "Program", not "SeriesTimer" |

</details>

### `recording`

Route parameters: `id` = `recording-1`.

| Row | Surface | Member | Kind | Phase | Trigger | Guard | Arguments | Identity | Cardinality |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `primary.item` | `legacy` | `getItem` | `REQUEST` | `primary` | route mount with a resolved lookup parameter | `params.kind === "id"` | `["$userId","$itemId"]` | `arg[0]` → userId | 1 |
| `primary.user` | `legacy` | `getCurrentUser` | `REQUEST` | `primary` | route mount, in the same Promise.all as primary.item | `params.kind !== null` | `[]` | — | 1 |
| `primary.currentUserId` | `legacy` | `getCurrentUserId` | `LOCAL_ACCESSOR` | `primary` | every adapter call that needs the acting user id | `none` | `[]` | — | call-site-derived |
| `subscription.userData` | `legacy` | `subscribe` | `SUBSCRIPTION` | `subscription` | useUserDataRefresh mount effect, once the item is known | `item is defined` | `[["UserDataChanged"]]` | — | 1 |
| `similar` | `legacy` | `getSimilarItems` | `REQUEST` | `section` | render, once the item resolves | `item.Type "Recording" is in SIMILAR_TYPES — issued whether or not a related section renders (invariant 16)` | `["$itemId",{"userId":"$userId","limit":12,"fields":"PrimaryImageAspectRatio,CanDelete"}]` | `arg[0]` → itemId | 1 |
| `collections` | `sdk` | `getItemCollections` | `REQUEST` | `section` | render, once item and user resolve | `item && user — issued by every class; only some render a collections section` | `[{"itemId":"$itemId","userId":"$userId","fields":["PrimaryImageAspectRatio"]}]` | `arg[0].itemId` → itemId<br>`arg[0].userId` → userId | 1 |

<details><summary>Declared absences — reads this class must NOT issue</summary>

| Signature | Why it is absent |
| --- | --- |
| `children.seasons` | item.Type is "Recording", not "Series" |
| `children.episodes` | item.Type is "Recording", not "Season" |
| `children.itemsByName` | item.Type "Recording" is not an items-by-name type |
| `children.playlist` | item.Type is "Recording", not "Playlist" |
| `children.folder` | item.IsFolder is not true |
| `moreFromSeason` | item.Type is "Recording", not "Episode" |
| `nextUp` | item.Type is "Recording", not "Series" |
| `seriesSchedule` | item.Type is "Recording", not "Series" |
| `specials` | item.SpecialFeatureCount is 0, not greater than 0 |
| `additionalParts` | item.PartCount is 0, not greater than 1 |
| `musicVideos` | item.Type is "Recording", not "MusicAlbum" |
| `moreFromArtist` | hasMoreFromArtist is false for item.Type "Recording" |
| `lyrics` | item.Type is "Recording", not "Audio" |
| `channelGuide` | item.Type is "Recording", not "TvChannel" |
| `seriesTimerSchedule` | item.Type is "Recording", not "SeriesTimer" |
| `recordingFields.program` | item.Type is "Recording", not "Program" |

</details>

### `recording-no-livetv`

Route parameters: `id` = `recording-1`.

| Row | Surface | Member | Kind | Phase | Trigger | Guard | Arguments | Identity | Cardinality |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `primary.item` | `legacy` | `getItem` | `REQUEST` | `primary` | route mount with a resolved lookup parameter | `params.kind === "id"` | `["$userId","$itemId"]` | `arg[0]` → userId | 1 |
| `primary.user` | `legacy` | `getCurrentUser` | `REQUEST` | `primary` | route mount, in the same Promise.all as primary.item | `params.kind !== null` | `[]` | — | 1 |
| `primary.currentUserId` | `legacy` | `getCurrentUserId` | `LOCAL_ACCESSOR` | `primary` | every adapter call that needs the acting user id | `none` | `[]` | — | call-site-derived |
| `subscription.userData` | `legacy` | `subscribe` | `SUBSCRIPTION` | `subscription` | useUserDataRefresh mount effect, once the item is known | `item is defined` | `[["UserDataChanged"]]` | — | 1 |
| `similar` | `legacy` | `getSimilarItems` | `REQUEST` | `section` | render, once the item resolves | `item.Type "Recording" is in SIMILAR_TYPES — issued whether or not a related section renders (invariant 16)` | `["$itemId",{"userId":"$userId","limit":12,"fields":"PrimaryImageAspectRatio,CanDelete"}]` | `arg[0]` → itemId | 1 |
| `collections` | `sdk` | `getItemCollections` | `REQUEST` | `section` | render, once item and user resolve | `item && user — issued by every class; only some render a collections section` | `[{"itemId":"$itemId","userId":"$userId","fields":["PrimaryImageAspectRatio"]}]` | `arg[0].itemId` → itemId<br>`arg[0].userId` → userId | 1 |

<details><summary>Declared absences — reads this class must NOT issue</summary>

| Signature | Why it is absent |
| --- | --- |
| `children.seasons` | item.Type is "Recording", not "Series" |
| `children.episodes` | item.Type is "Recording", not "Season" |
| `children.itemsByName` | item.Type "Recording" is not an items-by-name type |
| `children.playlist` | item.Type is "Recording", not "Playlist" |
| `children.folder` | item.IsFolder is not true |
| `moreFromSeason` | item.Type is "Recording", not "Episode" |
| `nextUp` | item.Type is "Recording", not "Series" |
| `seriesSchedule` | item.Type is "Recording", not "Series" |
| `specials` | item.SpecialFeatureCount is 0, not greater than 0 |
| `additionalParts` | item.PartCount is 0, not greater than 1 |
| `musicVideos` | item.Type is "Recording", not "MusicAlbum" |
| `moreFromArtist` | hasMoreFromArtist is false for item.Type "Recording" |
| `lyrics` | item.Type is "Recording", not "Audio" |
| `channelGuide` | item.Type is "Recording", not "TvChannel" |
| `seriesTimerSchedule` | item.Type is "Recording", not "SeriesTimer" |
| `recordingFields.program` | item.Type is "Recording", not "Program" |

</details>

### `series-timer`

Route parameters: `seriesTimerId` = `seriestimer-1`.

| Row | Surface | Member | Kind | Phase | Trigger | Guard | Arguments | Identity | Cardinality |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `primary.item` | `legacy` | `getLiveTvSeriesTimer` | `REQUEST` | `primary` | route mount with a resolved lookup parameter | `params.kind === "seriesTimerId"` | `["$itemId"]` | `arg[0]` → lookupValue | 1 |
| `primary.user` | `legacy` | `getCurrentUser` | `REQUEST` | `primary` | route mount, in the same Promise.all as primary.item | `params.kind !== null` | `[]` | — | 1 |
| `primary.currentUserId` | `legacy` | `getCurrentUserId` | `LOCAL_ACCESSOR` | `primary` | every adapter call that needs the acting user id | `none` | `[]` | — | call-site-derived |
| `subscription.userData` | `legacy` | `subscribe` | `SUBSCRIPTION` | `subscription` | useUserDataRefresh mount effect, once the item is known | `item is defined` | `[["UserDataChanged"]]` | — | 1 |
| `collections` | `sdk` | `getItemCollections` | `REQUEST` | `section` | render, once item and user resolve | `item && user — issued by every class; only some render a collections section` | `[{"itemId":"$itemId","userId":"$userId","fields":["PrimaryImageAspectRatio"]}]` | `arg[0].itemId` → itemId<br>`arg[0].userId` → userId | 1 |
| `seriesTimerSchedule` | `legacy` | `getLiveTvTimers` | `REQUEST` | `section` | render, once the item resolves | `item.Type === "SeriesTimer" && user.Policy.EnableLiveTvManagement` | `[{"UserId":"$userId","ImageTypeLimit":1,"SortBy":"StartDate","EnableTotalRecordCount":false,"EnableUserData":false,"SeriesTimerId":"$itemId","Fields":"ChannelInfo,ChannelImage"}]` | `arg[0].SeriesTimerId` → itemId (a SeriesTimer IS the timer) | 1 |

<details><summary>Declared absences — reads this class must NOT issue</summary>

| Signature | Why it is absent |
| --- | --- |
| `children.seasons` | item.Type is "SeriesTimer", not "Series" |
| `children.episodes` | item.Type is "SeriesTimer", not "Season" |
| `children.itemsByName` | item.Type "SeriesTimer" is not an items-by-name type |
| `children.playlist` | item.Type is "SeriesTimer", not "Playlist" |
| `children.folder` | item.IsFolder is not true |
| `moreFromSeason` | item.Type is "SeriesTimer", not "Episode" |
| `nextUp` | item.Type is "SeriesTimer", not "Series" |
| `seriesSchedule` | item.Type is "SeriesTimer", not "Series" |
| `similar` | item.Type "SeriesTimer" is not in SIMILAR_TYPES |
| `specials` | item.SpecialFeatureCount is 0, not greater than 0 |
| `additionalParts` | item.PartCount is 0, not greater than 1 |
| `musicVideos` | item.Type is "SeriesTimer", not "MusicAlbum" |
| `moreFromArtist` | hasMoreFromArtist is false for item.Type "SeriesTimer" |
| `lyrics` | item.Type is "SeriesTimer", not "Audio" |
| `channelGuide` | item.Type is "SeriesTimer", not "TvChannel" |
| `recordingFields.program` | item.Type is "SeriesTimer", not "Program" |

</details>

### `series-timer-no-livetv`

Route parameters: `seriesTimerId` = `seriestimer-1`.

| Row | Surface | Member | Kind | Phase | Trigger | Guard | Arguments | Identity | Cardinality |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `primary.item` | `legacy` | `getLiveTvSeriesTimer` | `REQUEST` | `primary` | route mount with a resolved lookup parameter | `params.kind === "seriesTimerId"` | `["$itemId"]` | `arg[0]` → lookupValue | 1 |
| `primary.user` | `legacy` | `getCurrentUser` | `REQUEST` | `primary` | route mount, in the same Promise.all as primary.item | `params.kind !== null` | `[]` | — | 1 |
| `primary.currentUserId` | `legacy` | `getCurrentUserId` | `LOCAL_ACCESSOR` | `primary` | every adapter call that needs the acting user id | `none` | `[]` | — | call-site-derived |
| `subscription.userData` | `legacy` | `subscribe` | `SUBSCRIPTION` | `subscription` | useUserDataRefresh mount effect, once the item is known | `item is defined` | `[["UserDataChanged"]]` | — | 1 |
| `collections` | `sdk` | `getItemCollections` | `REQUEST` | `section` | render, once item and user resolve | `item && user — issued by every class; only some render a collections section` | `[{"itemId":"$itemId","userId":"$userId","fields":["PrimaryImageAspectRatio"]}]` | `arg[0].itemId` → itemId<br>`arg[0].userId` → userId | 1 |

<details><summary>Declared absences — reads this class must NOT issue</summary>

| Signature | Why it is absent |
| --- | --- |
| `children.seasons` | item.Type is "SeriesTimer", not "Series" |
| `children.episodes` | item.Type is "SeriesTimer", not "Season" |
| `children.itemsByName` | item.Type "SeriesTimer" is not an items-by-name type |
| `children.playlist` | item.Type is "SeriesTimer", not "Playlist" |
| `children.folder` | item.IsFolder is not true |
| `moreFromSeason` | item.Type is "SeriesTimer", not "Episode" |
| `nextUp` | item.Type is "SeriesTimer", not "Series" |
| `seriesSchedule` | item.Type is "SeriesTimer", not "Series" |
| `similar` | item.Type "SeriesTimer" is not in SIMILAR_TYPES |
| `specials` | item.SpecialFeatureCount is 0, not greater than 0 |
| `additionalParts` | item.PartCount is 0, not greater than 1 |
| `musicVideos` | item.Type is "SeriesTimer", not "MusicAlbum" |
| `moreFromArtist` | hasMoreFromArtist is false for item.Type "SeriesTimer" |
| `lyrics` | item.Type is "SeriesTimer", not "Audio" |
| `channelGuide` | item.Type is "SeriesTimer", not "TvChannel" |
| `seriesTimerSchedule` | user.Policy.EnableLiveTvManagement is not true |
| `recordingFields.program` | item.Type is "SeriesTimer", not "Program" |

</details>

### `tv-channel`

Route parameters: `id` = `channel-1`.

| Row | Surface | Member | Kind | Phase | Trigger | Guard | Arguments | Identity | Cardinality |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `primary.item` | `legacy` | `getItem` | `REQUEST` | `primary` | route mount with a resolved lookup parameter | `params.kind === "id"` | `["$userId","$itemId"]` | `arg[0]` → userId | 1 |
| `primary.user` | `legacy` | `getCurrentUser` | `REQUEST` | `primary` | route mount, in the same Promise.all as primary.item | `params.kind !== null` | `[]` | — | 1 |
| `primary.currentUserId` | `legacy` | `getCurrentUserId` | `LOCAL_ACCESSOR` | `primary` | every adapter call that needs the acting user id | `none` | `[]` | — | call-site-derived |
| `subscription.userData` | `legacy` | `subscribe` | `SUBSCRIPTION` | `subscription` | useUserDataRefresh mount effect, once the item is known | `item is defined` | `[["UserDataChanged"]]` | — | 1 |
| `collections` | `sdk` | `getItemCollections` | `REQUEST` | `section` | render, once item and user resolve | `item && user — issued by every class; only some render a collections section` | `[{"itemId":"$itemId","userId":"$userId","fields":["PrimaryImageAspectRatio"]}]` | `arg[0].itemId` → itemId<br>`arg[0].userId` → userId | 1 |
| `channelGuide` | `legacy` | `getLiveTvPrograms` | `REQUEST` | `section` | render, once the item resolves | `item.Type === "TvChannel"` | `[{"ChannelIds":"$itemId","UserId":"$userId","HasAired":false,"SortBy":"StartDate","EnableTotalRecordCount":false,"EnableImages":false,"ImageTypeLimit":0,"EnableUserData":false}]` | `arg[0].ChannelIds` → itemId (a TvChannel IS the channel) | 1 |

<details><summary>Declared absences — reads this class must NOT issue</summary>

| Signature | Why it is absent |
| --- | --- |
| `children.seasons` | item.Type is "TvChannel", not "Series" |
| `children.episodes` | item.Type is "TvChannel", not "Season" |
| `children.itemsByName` | item.Type "TvChannel" is not an items-by-name type |
| `children.playlist` | item.Type is "TvChannel", not "Playlist" |
| `children.folder` | item.IsFolder is not true |
| `moreFromSeason` | item.Type is "TvChannel", not "Episode" |
| `nextUp` | item.Type is "TvChannel", not "Series" |
| `seriesSchedule` | item.Type is "TvChannel", not "Series" |
| `similar` | item.Type "TvChannel" is not in SIMILAR_TYPES |
| `specials` | item.SpecialFeatureCount is 0, not greater than 0 |
| `additionalParts` | item.PartCount is 0, not greater than 1 |
| `musicVideos` | item.Type is "TvChannel", not "MusicAlbum" |
| `moreFromArtist` | hasMoreFromArtist is false for item.Type "TvChannel" |
| `lyrics` | item.Type is "TvChannel", not "Audio" |
| `seriesTimerSchedule` | item.Type is "TvChannel", not "SeriesTimer" |
| `recordingFields.program` | item.Type is "TvChannel", not "Program" |

</details>

### `genre`

Route parameters: `genre` = `Drama`.
Child container: `listChildrenCollapsible`.

| Row | Surface | Member | Kind | Phase | Trigger | Guard | Arguments | Identity | Cardinality |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `primary.item` | `legacy` | `getGenre` | `REQUEST` | `primary` | route mount with a resolved lookup parameter | `params.kind === "genre"` | `["$routeParam.genre","$userId"]` | `arg[0]` → lookupValue | 1 |
| `primary.user` | `legacy` | `getCurrentUser` | `REQUEST` | `primary` | route mount, in the same Promise.all as primary.item | `params.kind !== null` | `[]` | — | 1 |
| `primary.currentUserId` | `legacy` | `getCurrentUserId` | `LOCAL_ACCESSOR` | `primary` | every adapter call that needs the acting user id | `none` | `[]` | — | call-site-derived |
| `subscription.userData` | `legacy` | `subscribe` | `SUBSCRIPTION` | `subscription` | useUserDataRefresh mount effect, once the item is known | `item is defined` | `[["UserDataChanged"]]` | — | 1 |
| `children.itemsByName` | `legacy` | `getItems` | `REQUEST` | `section` | render, once item and user resolve | `childrenKind(item) === "itemsByName" (item.Type "Genre" is in ITEMS_BY_NAME_TYPES)` | `["$userId",{"SortBy":"SortName","SortOrder":"Ascending","Recursive":true,"Fields":"ItemCounts,PrimaryImageAspectRatio,CanDelete,MediaSourceCount","CollapseBoxSetItems":false,"GenreIds":"$itemId"}]` | `arg[0]` → userId | 1 |
| `collections` | `sdk` | `getItemCollections` | `REQUEST` | `section` | render, once item and user resolve | `item && user — issued by every class; only some render a collections section` | `[{"itemId":"$itemId","userId":"$userId","fields":["PrimaryImageAspectRatio"]}]` | `arg[0].itemId` → itemId<br>`arg[0].userId` → userId | 1 |

<details><summary>Declared absences — reads this class must NOT issue</summary>

| Signature | Why it is absent |
| --- | --- |
| `children.seasons` | item.Type is "Genre", not "Series" |
| `children.episodes` | item.Type is "Genre", not "Season" |
| `children.playlist` | item.Type is "Genre", not "Playlist" |
| `children.folder` | a more specific child kind applies |
| `moreFromSeason` | item.Type is "Genre", not "Episode" |
| `nextUp` | item.Type is "Genre", not "Series" |
| `seriesSchedule` | item.Type is "Genre", not "Series" |
| `similar` | item.Type "Genre" is not in SIMILAR_TYPES |
| `specials` | item.SpecialFeatureCount is 0, not greater than 0 |
| `additionalParts` | item.PartCount is 0, not greater than 1 |
| `musicVideos` | item.Type is "Genre", not "MusicAlbum" |
| `moreFromArtist` | hasMoreFromArtist is false for item.Type "Genre" |
| `lyrics` | item.Type is "Genre", not "Audio" |
| `channelGuide` | item.Type is "Genre", not "TvChannel" |
| `seriesTimerSchedule` | item.Type is "Genre", not "SeriesTimer" |
| `recordingFields.program` | item.Type is "Genre", not "Program" |

</details>

### `music-genre`

Route parameters: `musicgenre` = `Jazz`.
Child container: `listChildrenCollapsible`.

| Row | Surface | Member | Kind | Phase | Trigger | Guard | Arguments | Identity | Cardinality |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `primary.item` | `legacy` | `getMusicGenre` | `REQUEST` | `primary` | route mount with a resolved lookup parameter | `params.kind === "musicgenre"` | `["$routeParam.musicgenre","$userId"]` | `arg[0]` → lookupValue | 1 |
| `primary.user` | `legacy` | `getCurrentUser` | `REQUEST` | `primary` | route mount, in the same Promise.all as primary.item | `params.kind !== null` | `[]` | — | 1 |
| `primary.currentUserId` | `legacy` | `getCurrentUserId` | `LOCAL_ACCESSOR` | `primary` | every adapter call that needs the acting user id | `none` | `[]` | — | call-site-derived |
| `subscription.userData` | `legacy` | `subscribe` | `SUBSCRIPTION` | `subscription` | useUserDataRefresh mount effect, once the item is known | `item is defined` | `[["UserDataChanged"]]` | — | 1 |
| `children.itemsByName` | `legacy` | `getItems` | `REQUEST` | `section` | render, once item and user resolve | `childrenKind(item) === "itemsByName" (item.Type "MusicGenre" is in ITEMS_BY_NAME_TYPES)` | `["$userId",{"SortBy":"SortName","SortOrder":"Ascending","Recursive":true,"Fields":"ItemCounts,PrimaryImageAspectRatio,CanDelete,MediaSourceCount","CollapseBoxSetItems":false,"GenreIds":"$itemId"}]` | `arg[0]` → userId | 1 |
| `collections` | `sdk` | `getItemCollections` | `REQUEST` | `section` | render, once item and user resolve | `item && user — issued by every class; only some render a collections section` | `[{"itemId":"$itemId","userId":"$userId","fields":["PrimaryImageAspectRatio"]}]` | `arg[0].itemId` → itemId<br>`arg[0].userId` → userId | 1 |

<details><summary>Declared absences — reads this class must NOT issue</summary>

| Signature | Why it is absent |
| --- | --- |
| `children.seasons` | item.Type is "MusicGenre", not "Series" |
| `children.episodes` | item.Type is "MusicGenre", not "Season" |
| `children.playlist` | item.Type is "MusicGenre", not "Playlist" |
| `children.folder` | a more specific child kind applies |
| `moreFromSeason` | item.Type is "MusicGenre", not "Episode" |
| `nextUp` | item.Type is "MusicGenre", not "Series" |
| `seriesSchedule` | item.Type is "MusicGenre", not "Series" |
| `similar` | item.Type "MusicGenre" is not in SIMILAR_TYPES |
| `specials` | item.SpecialFeatureCount is 0, not greater than 0 |
| `additionalParts` | item.PartCount is 0, not greater than 1 |
| `musicVideos` | item.Type is "MusicGenre", not "MusicAlbum" |
| `moreFromArtist` | hasMoreFromArtist is false for item.Type "MusicGenre" |
| `lyrics` | item.Type is "MusicGenre", not "Audio" |
| `channelGuide` | item.Type is "MusicGenre", not "TvChannel" |
| `seriesTimerSchedule` | item.Type is "MusicGenre", not "SeriesTimer" |
| `recordingFields.program` | item.Type is "MusicGenre", not "Program" |

</details>

## 8. Actions, per class

Every row is exercised through the mounted production component, by focusing and activating the
real control — never by calling a handler directly.

### `movie`

| Action | Trigger | State | Preconditions | Service | Member | Payload | Target | × | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --: | --- |
| `btnPlay` | activate the play control (pointer or keyboard) | visible, enabled | `playbackGates(item).canPlay` | `components/playback/playbackmanager` | `play` | `{"items":["$itemId"],"startPositionTicks":0,"mediaSourceId":"$itemId","audioStreamIndex":"1","subtitleStreamIndex":"3"}` | the item, at the selection current AT CLICK TIME | 1 | none — playback is owned by the player |
| `btnPlayTrailer` | activate the trailer control | visible, enabled | `item.LocalTrailerCount or item.RemoteTrailers, and the player supports PlayTrailers` | `components/playback/playbackmanager` | `playTrailers` | `["$itemId"]` | the item — never the selected media source | 1 | none |
| `btnPlaystate` | activate the played control | visible, enabled | `itemHelper.canMarkPlayed(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useTogglePlayedMutation` | `markPlayedItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id — never a media-source id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnUserRating` | activate the favourite control | visible, enabled | `itemHelper.canRate(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useToggleFavoriteMutation` | `markFavoriteItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnMoreCommands` | activate the more-commands control | visible when components/itemContextMenu getCommands returns at least one command | `getCommands(contextMenuOptions(item, user)).length > 0` | `components/itemContextMenu` | `show` | `{"item":"$itemId","user":"$userId","open":false,"play":false,"playAllFromHere":false,"queueAllFromHere":false,"cancelTimer":false,"record":false,"deleteItem":true,"shuffle":false,"instantMix":false,"share":true,"positionTo":"<the action bar element>"}` | the ITEM — never the selected media-source id (SUSPECT #4, delta D4) | 1 | result.deleted -> appRouter.showItem(parent) or goHome(); result.updated -> refresh(); dismissal -> nothing |

<details><summary>Declared absences — controls this class must NOT offer</summary>

| Action | Why it is absent |
| --- | --- |
| `btnReplay` | no stored resume position, or the item is not playable |
| `btnInstantMix` | item.Type "Movie" is not in INSTANT_MIX_TYPES, or the item is not playable |
| `btnShuffle` | the item is neither a folder nor a shuffleable music type |
| `btnCancelTimer` | item.Type is "Movie", not "Recording" |
| `btnCancelSeriesTimer` | item.Type is "Movie", not "SeriesTimer" |
| `btnDownload` | item.Type "Movie" is not a downloadable Book |
| `btnSplitVersions` | the item has no media source of Type "Grouping" |

</details>

### `movie-resumable`

| Action | Trigger | State | Preconditions | Service | Member | Payload | Target | × | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --: | --- |
| `btnPlay` | activate the play control (pointer or keyboard) | visible, enabled | `playbackGates(item).canPlay` | `components/playback/playbackmanager` | `play` | `{"items":["$itemId"],"startPositionTicks":6000000000,"mediaSourceId":"$itemId","audioStreamIndex":"1","subtitleStreamIndex":"3"}` | the item, at the selection current AT CLICK TIME | 1 | none — playback is owned by the player |
| `btnReplay` | activate the play-from-beginning control | visible, enabled | `playbackGates(item).canPlay && playbackGates(item).isResumable` | `components/playback/playbackmanager` | `play` | `{"items":["$itemId"],"startPositionTicks":0,"mediaSourceId":"$itemId","audioStreamIndex":"1","subtitleStreamIndex":"3"}` | the item, always from tick 0 even with a stored resume position | 1 | none |
| `btnPlayTrailer` | activate the trailer control | visible, enabled | `item.LocalTrailerCount or item.RemoteTrailers, and the player supports PlayTrailers` | `components/playback/playbackmanager` | `playTrailers` | `["$itemId"]` | the item — never the selected media source | 1 | none |
| `btnPlaystate` | activate the played control | visible, enabled | `itemHelper.canMarkPlayed(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useTogglePlayedMutation` | `markPlayedItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id — never a media-source id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnUserRating` | activate the favourite control | visible, enabled | `itemHelper.canRate(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useToggleFavoriteMutation` | `markFavoriteItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnMoreCommands` | activate the more-commands control | visible when components/itemContextMenu getCommands returns at least one command | `getCommands(contextMenuOptions(item, user)).length > 0` | `components/itemContextMenu` | `show` | `{"item":"$itemId","user":"$userId","open":false,"play":false,"playAllFromHere":false,"queueAllFromHere":false,"cancelTimer":false,"record":false,"deleteItem":true,"shuffle":false,"instantMix":false,"share":true,"positionTo":"<the action bar element>"}` | the ITEM — never the selected media-source id (SUSPECT #4, delta D4) | 1 | result.deleted -> appRouter.showItem(parent) or goHome(); result.updated -> refresh(); dismissal -> nothing |

<details><summary>Declared absences — controls this class must NOT offer</summary>

| Action | Why it is absent |
| --- | --- |
| `btnInstantMix` | item.Type "Movie" is not in INSTANT_MIX_TYPES, or the item is not playable |
| `btnShuffle` | the item is neither a folder nor a shuffleable music type |
| `btnCancelTimer` | item.Type is "Movie", not "Recording" |
| `btnCancelSeriesTimer` | item.Type is "Movie", not "SeriesTimer" |
| `btnDownload` | item.Type "Movie" is not a downloadable Book |
| `btnSplitVersions` | the acting user is not an administrator |

</details>

### `movie-grouped-admin`

| Action | Trigger | State | Preconditions | Service | Member | Payload | Target | × | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --: | --- |
| `btnPlay` | activate the play control (pointer or keyboard) | visible, enabled | `playbackGates(item).canPlay` | `components/playback/playbackmanager` | `play` | `{"items":["$itemId"],"startPositionTicks":0,"mediaSourceId":"$itemId","audioStreamIndex":"1","subtitleStreamIndex":"3"}` | the item, at the selection current AT CLICK TIME | 1 | none — playback is owned by the player |
| `btnPlayTrailer` | activate the trailer control | visible, enabled | `item.LocalTrailerCount or item.RemoteTrailers, and the player supports PlayTrailers` | `components/playback/playbackmanager` | `playTrailers` | `["$itemId"]` | the item — never the selected media source | 1 | none |
| `btnPlaystate` | activate the played control | visible, enabled | `itemHelper.canMarkPlayed(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useTogglePlayedMutation` | `markPlayedItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id — never a media-source id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnUserRating` | activate the favourite control | visible, enabled | `itemHelper.canRate(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useToggleFavoriteMutation` | `markFavoriteItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnSplitVersions` | activate the split-versions control, then confirm | visible, enabled | `user.Policy.IsAdministrator && a media source of Type "Grouping" exists` | `the legacy api client, through components/confirm/confirm` | `ajax` | `{"type":"DELETE","url":"@path:Videos/${itemId}/AlternateSources"}` | the ITEM id in the path — never a media-source id | 1 | refresh() + Events.trigger(document, "refreshneeded") |
| `btnMoreCommands` | activate the more-commands control | visible when components/itemContextMenu getCommands returns at least one command | `getCommands(contextMenuOptions(item, user)).length > 0` | `components/itemContextMenu` | `show` | `{"item":"$itemId","user":"$userId","open":false,"play":false,"playAllFromHere":false,"queueAllFromHere":false,"cancelTimer":false,"record":false,"deleteItem":true,"shuffle":false,"instantMix":false,"share":true,"positionTo":"<the action bar element>"}` | the ITEM — never the selected media-source id (SUSPECT #4, delta D4) | 1 | result.deleted -> appRouter.showItem(parent) or goHome(); result.updated -> refresh(); dismissal -> nothing |

<details><summary>Declared absences — controls this class must NOT offer</summary>

| Action | Why it is absent |
| --- | --- |
| `btnReplay` | no stored resume position, or the item is not playable |
| `btnInstantMix` | item.Type "Movie" is not in INSTANT_MIX_TYPES, or the item is not playable |
| `btnShuffle` | the item is neither a folder nor a shuffleable music type |
| `btnCancelTimer` | item.Type is "Movie", not "Recording" |
| `btnCancelSeriesTimer` | item.Type is "Movie", not "SeriesTimer" |
| `btnDownload` | item.Type "Movie" is not a downloadable Book |

</details>

### `movie-grouped-regular`

| Action | Trigger | State | Preconditions | Service | Member | Payload | Target | × | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --: | --- |
| `btnPlay` | activate the play control (pointer or keyboard) | visible, enabled | `playbackGates(item).canPlay` | `components/playback/playbackmanager` | `play` | `{"items":["$itemId"],"startPositionTicks":0,"mediaSourceId":"$itemId","audioStreamIndex":"1","subtitleStreamIndex":"3"}` | the item, at the selection current AT CLICK TIME | 1 | none — playback is owned by the player |
| `btnPlayTrailer` | activate the trailer control | visible, enabled | `item.LocalTrailerCount or item.RemoteTrailers, and the player supports PlayTrailers` | `components/playback/playbackmanager` | `playTrailers` | `["$itemId"]` | the item — never the selected media source | 1 | none |
| `btnPlaystate` | activate the played control | visible, enabled | `itemHelper.canMarkPlayed(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useTogglePlayedMutation` | `markPlayedItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id — never a media-source id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnUserRating` | activate the favourite control | visible, enabled | `itemHelper.canRate(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useToggleFavoriteMutation` | `markFavoriteItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnMoreCommands` | activate the more-commands control | visible when components/itemContextMenu getCommands returns at least one command | `getCommands(contextMenuOptions(item, user)).length > 0` | `components/itemContextMenu` | `show` | `{"item":"$itemId","user":"$userId","open":false,"play":false,"playAllFromHere":false,"queueAllFromHere":false,"cancelTimer":false,"record":false,"deleteItem":true,"shuffle":false,"instantMix":false,"share":true,"positionTo":"<the action bar element>"}` | the ITEM — never the selected media-source id (SUSPECT #4, delta D4) | 1 | result.deleted -> appRouter.showItem(parent) or goHome(); result.updated -> refresh(); dismissal -> nothing |

<details><summary>Declared absences — controls this class must NOT offer</summary>

| Action | Why it is absent |
| --- | --- |
| `btnReplay` | no stored resume position, or the item is not playable |
| `btnInstantMix` | item.Type "Movie" is not in INSTANT_MIX_TYPES, or the item is not playable |
| `btnShuffle` | the item is neither a folder nor a shuffleable music type |
| `btnCancelTimer` | item.Type is "Movie", not "Recording" |
| `btnCancelSeriesTimer` | item.Type is "Movie", not "SeriesTimer" |
| `btnDownload` | item.Type "Movie" is not a downloadable Book |
| `btnSplitVersions` | the acting user is not an administrator |

</details>

### `minimal-video`

| Action | Trigger | State | Preconditions | Service | Member | Payload | Target | × | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --: | --- |
| `btnPlay` | activate the play control (pointer or keyboard) | visible, enabled | `playbackGates(item).canPlay` | `components/playback/playbackmanager` | `play` | `{"items":["$itemId"],"startPositionTicks":0,"mediaSourceId":"$itemId","audioStreamIndex":null,"subtitleStreamIndex":"-1"}` | the item, at the selection current AT CLICK TIME | 1 | none — playback is owned by the player |
| `btnPlaystate` | activate the played control | visible, enabled | `itemHelper.canMarkPlayed(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useTogglePlayedMutation` | `markPlayedItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id — never a media-source id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnUserRating` | activate the favourite control | visible, enabled | `itemHelper.canRate(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useToggleFavoriteMutation` | `markFavoriteItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnMoreCommands` | activate the more-commands control | visible when components/itemContextMenu getCommands returns at least one command | `getCommands(contextMenuOptions(item, user)).length > 0` | `components/itemContextMenu` | `show` | `{"item":"$itemId","user":"$userId","open":false,"play":false,"playAllFromHere":false,"queueAllFromHere":false,"cancelTimer":false,"record":false,"deleteItem":false,"shuffle":false,"instantMix":false,"share":true,"positionTo":"<the action bar element>"}` | the ITEM — never the selected media-source id (SUSPECT #4, delta D4) | 1 | result.deleted -> appRouter.showItem(parent) or goHome(); result.updated -> refresh(); dismissal -> nothing |

<details><summary>Declared absences — controls this class must NOT offer</summary>

| Action | Why it is absent |
| --- | --- |
| `btnReplay` | no stored resume position, or the item is not playable |
| `btnInstantMix` | item.Type "Movie" is not in INSTANT_MIX_TYPES, or the item is not playable |
| `btnShuffle` | the item is neither a folder nor a shuffleable music type |
| `btnPlayTrailer` | the item declares no local or remote trailer |
| `btnCancelTimer` | item.Type is "Movie", not "Recording" |
| `btnCancelSeriesTimer` | item.Type is "Movie", not "SeriesTimer" |
| `btnDownload` | item.Type "Movie" is not a downloadable Book |
| `btnSplitVersions` | the acting user is not an administrator |

</details>

### `series`

| Action | Trigger | State | Preconditions | Service | Member | Payload | Target | × | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --: | --- |
| `btnPlay` | activate the play control (pointer or keyboard) | visible, enabled | `playbackGates(item).canPlay` | `components/playback/playbackmanager` | `play` | `{"items":["$itemId"],"startPositionTicks":0,"mediaSourceId":"","audioStreamIndex":null,"subtitleStreamIndex":"-1"}` | the item, at the selection current AT CLICK TIME | 1 | none — playback is owned by the player |
| `btnShuffle` | activate the shuffle control | visible, enabled | `item.IsFolder \|\| item.Type is in SHUFFLE_TYPES` | `components/playback/playbackmanager` | `shuffle` | `["$itemId"]` | the item | 1 | none |
| `btnPlaystate` | activate the played control | visible, enabled | `itemHelper.canMarkPlayed(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useTogglePlayedMutation` | `markPlayedItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id — never a media-source id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnUserRating` | activate the favourite control | visible, enabled | `itemHelper.canRate(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useToggleFavoriteMutation` | `markFavoriteItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnMoreCommands` | activate the more-commands control | visible when components/itemContextMenu getCommands returns at least one command | `getCommands(contextMenuOptions(item, user)).length > 0` | `components/itemContextMenu` | `show` | `{"item":"$itemId","user":"$userId","open":false,"play":false,"playAllFromHere":false,"queueAllFromHere":false,"cancelTimer":false,"record":false,"deleteItem":false,"shuffle":false,"instantMix":false,"share":true,"positionTo":"<the action bar element>"}` | the ITEM — never the selected media-source id (SUSPECT #4, delta D4) | 1 | result.deleted -> appRouter.showItem(parent) or goHome(); result.updated -> refresh(); dismissal -> nothing |

<details><summary>Declared absences — controls this class must NOT offer</summary>

| Action | Why it is absent |
| --- | --- |
| `btnReplay` | no stored resume position, or the item is not playable |
| `btnInstantMix` | item.Type "Series" is not in INSTANT_MIX_TYPES, or the item is not playable |
| `btnPlayTrailer` | the item declares no local or remote trailer |
| `btnCancelTimer` | item.Type is "Series", not "Recording" |
| `btnCancelSeriesTimer` | item.Type is "Series", not "SeriesTimer" |
| `btnDownload` | item.Type "Series" is not a downloadable Book |
| `btnSplitVersions` | the acting user is not an administrator |

</details>

### `season`

| Action | Trigger | State | Preconditions | Service | Member | Payload | Target | × | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --: | --- |
| `btnPlay` | activate the play control (pointer or keyboard) | visible, enabled | `playbackGates(item).canPlay` | `components/playback/playbackmanager` | `play` | `{"items":["$itemId"],"startPositionTicks":0,"mediaSourceId":"","audioStreamIndex":null,"subtitleStreamIndex":"-1"}` | the item, at the selection current AT CLICK TIME | 1 | none — playback is owned by the player |
| `btnShuffle` | activate the shuffle control | visible, enabled | `item.IsFolder \|\| item.Type is in SHUFFLE_TYPES` | `components/playback/playbackmanager` | `shuffle` | `["$itemId"]` | the item | 1 | none |
| `btnPlaystate` | activate the played control | visible, enabled | `itemHelper.canMarkPlayed(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useTogglePlayedMutation` | `markPlayedItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id — never a media-source id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnUserRating` | activate the favourite control | visible, enabled | `itemHelper.canRate(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useToggleFavoriteMutation` | `markFavoriteItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnMoreCommands` | activate the more-commands control | visible when components/itemContextMenu getCommands returns at least one command | `getCommands(contextMenuOptions(item, user)).length > 0` | `components/itemContextMenu` | `show` | `{"item":"$itemId","user":"$userId","open":false,"play":false,"playAllFromHere":false,"queueAllFromHere":false,"cancelTimer":false,"record":false,"deleteItem":false,"shuffle":false,"instantMix":false,"share":true,"positionTo":"<the action bar element>"}` | the ITEM — never the selected media-source id (SUSPECT #4, delta D4) | 1 | result.deleted -> appRouter.showItem(parent) or goHome(); result.updated -> refresh(); dismissal -> nothing |

<details><summary>Declared absences — controls this class must NOT offer</summary>

| Action | Why it is absent |
| --- | --- |
| `btnReplay` | no stored resume position, or the item is not playable |
| `btnInstantMix` | item.Type "Season" is not in INSTANT_MIX_TYPES, or the item is not playable |
| `btnPlayTrailer` | the item declares no local or remote trailer |
| `btnCancelTimer` | item.Type is "Season", not "Recording" |
| `btnCancelSeriesTimer` | item.Type is "Season", not "SeriesTimer" |
| `btnDownload` | item.Type "Season" is not a downloadable Book |
| `btnSplitVersions` | the acting user is not an administrator |

</details>

### `episode`

| Action | Trigger | State | Preconditions | Service | Member | Payload | Target | × | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --: | --- |
| `btnPlay` | activate the play control (pointer or keyboard) | visible, enabled | `playbackGates(item).canPlay` | `components/playback/playbackmanager` | `play` | `{"items":["$itemId"],"startPositionTicks":0,"mediaSourceId":"$itemId","audioStreamIndex":null,"subtitleStreamIndex":"-1"}` | the item, at the selection current AT CLICK TIME | 1 | none — playback is owned by the player |
| `btnPlaystate` | activate the played control | visible, enabled | `itemHelper.canMarkPlayed(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useTogglePlayedMutation` | `markPlayedItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id — never a media-source id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnUserRating` | activate the favourite control | visible, enabled | `itemHelper.canRate(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useToggleFavoriteMutation` | `markFavoriteItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnMoreCommands` | activate the more-commands control | visible when components/itemContextMenu getCommands returns at least one command | `getCommands(contextMenuOptions(item, user)).length > 0` | `components/itemContextMenu` | `show` | `{"item":"$itemId","user":"$userId","open":false,"play":false,"playAllFromHere":false,"queueAllFromHere":false,"cancelTimer":false,"record":false,"deleteItem":false,"shuffle":false,"instantMix":false,"share":true,"positionTo":"<the action bar element>"}` | the ITEM — never the selected media-source id (SUSPECT #4, delta D4) | 1 | result.deleted -> appRouter.showItem(parent) or goHome(); result.updated -> refresh(); dismissal -> nothing |

<details><summary>Declared absences — controls this class must NOT offer</summary>

| Action | Why it is absent |
| --- | --- |
| `btnReplay` | no stored resume position, or the item is not playable |
| `btnInstantMix` | item.Type "Episode" is not in INSTANT_MIX_TYPES, or the item is not playable |
| `btnShuffle` | the item is neither a folder nor a shuffleable music type |
| `btnPlayTrailer` | the item declares no local or remote trailer |
| `btnCancelTimer` | item.Type is "Episode", not "Recording" |
| `btnCancelSeriesTimer` | item.Type is "Episode", not "SeriesTimer" |
| `btnDownload` | item.Type "Episode" is not a downloadable Book |
| `btnSplitVersions` | the acting user is not an administrator |

</details>

### `music-album`

| Action | Trigger | State | Preconditions | Service | Member | Payload | Target | × | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --: | --- |
| `btnPlay` | activate the play control (pointer or keyboard) | visible, enabled | `playbackGates(item).canPlay` | `components/playback/playbackmanager` | `play` | `{"items":["$itemId"],"startPositionTicks":0,"mediaSourceId":"","audioStreamIndex":null,"subtitleStreamIndex":"-1"}` | the item, at the selection current AT CLICK TIME | 1 | none — playback is owned by the player |
| `btnInstantMix` | activate the instant-mix control | visible, enabled | `item.Type "MusicAlbum" is in INSTANT_MIX_TYPES` | `components/playback/playbackmanager` | `instantMix` | `["$itemId"]` | the item | 1 | none |
| `btnShuffle` | activate the shuffle control | visible, enabled | `item.IsFolder \|\| item.Type is in SHUFFLE_TYPES` | `components/playback/playbackmanager` | `shuffle` | `["$itemId"]` | the item | 1 | none |
| `btnUserRating` | activate the favourite control | visible, enabled | `itemHelper.canRate(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useToggleFavoriteMutation` | `markFavoriteItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnMoreCommands` | activate the more-commands control | visible when components/itemContextMenu getCommands returns at least one command | `getCommands(contextMenuOptions(item, user)).length > 0` | `components/itemContextMenu` | `show` | `{"item":"$itemId","user":"$userId","open":false,"play":false,"playAllFromHere":false,"queueAllFromHere":false,"cancelTimer":false,"record":false,"deleteItem":false,"shuffle":false,"instantMix":false,"share":true,"positionTo":"<the action bar element>"}` | the ITEM — never the selected media-source id (SUSPECT #4, delta D4) | 1 | result.deleted -> appRouter.showItem(parent) or goHome(); result.updated -> refresh(); dismissal -> nothing |

<details><summary>Declared absences — controls this class must NOT offer</summary>

| Action | Why it is absent |
| --- | --- |
| `btnReplay` | no stored resume position, or the item is not playable |
| `btnPlayTrailer` | the item declares no local or remote trailer |
| `btnCancelTimer` | item.Type is "MusicAlbum", not "Recording" |
| `btnCancelSeriesTimer` | item.Type is "MusicAlbum", not "SeriesTimer" |
| `btnDownload` | item.Type "MusicAlbum" is not a downloadable Book |
| `btnPlaystate` | itemHelper.canMarkPlayed is false for item.Type "MusicAlbum" |
| `btnSplitVersions` | the acting user is not an administrator |

</details>

### `audio`

| Action | Trigger | State | Preconditions | Service | Member | Payload | Target | × | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --: | --- |
| `btnPlay` | activate the play control (pointer or keyboard) | visible, enabled | `playbackGates(item).canPlay` | `components/playback/playbackmanager` | `play` | `{"items":["$itemId"],"startPositionTicks":0,"mediaSourceId":"$itemId","audioStreamIndex":null,"subtitleStreamIndex":"-1"}` | the item, at the selection current AT CLICK TIME | 1 | none — playback is owned by the player |
| `btnInstantMix` | activate the instant-mix control | visible, enabled | `item.Type "Audio" is in INSTANT_MIX_TYPES` | `components/playback/playbackmanager` | `instantMix` | `["$itemId"]` | the item | 1 | none |
| `btnUserRating` | activate the favourite control | visible, enabled | `itemHelper.canRate(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useToggleFavoriteMutation` | `markFavoriteItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnMoreCommands` | activate the more-commands control | visible when components/itemContextMenu getCommands returns at least one command | `getCommands(contextMenuOptions(item, user)).length > 0` | `components/itemContextMenu` | `show` | `{"item":"$itemId","user":"$userId","open":false,"play":false,"playAllFromHere":false,"queueAllFromHere":false,"cancelTimer":false,"record":false,"deleteItem":false,"shuffle":false,"instantMix":false,"share":true,"positionTo":"<the action bar element>"}` | the ITEM — never the selected media-source id (SUSPECT #4, delta D4) | 1 | result.deleted -> appRouter.showItem(parent) or goHome(); result.updated -> refresh(); dismissal -> nothing |

<details><summary>Declared absences — controls this class must NOT offer</summary>

| Action | Why it is absent |
| --- | --- |
| `btnReplay` | no stored resume position, or the item is not playable |
| `btnShuffle` | the item is neither a folder nor a shuffleable music type |
| `btnPlayTrailer` | the item declares no local or remote trailer |
| `btnCancelTimer` | item.Type is "Audio", not "Recording" |
| `btnCancelSeriesTimer` | item.Type is "Audio", not "SeriesTimer" |
| `btnDownload` | item.Type "Audio" is not a downloadable Book |
| `btnPlaystate` | itemHelper.canMarkPlayed is false for item.Type "Audio" |
| `btnSplitVersions` | the acting user is not an administrator |

</details>

### `music-artist`

| Action | Trigger | State | Preconditions | Service | Member | Payload | Target | × | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --: | --- |
| `btnPlay` | activate the play control (pointer or keyboard) | visible, enabled | `playbackGates(item).canPlay` | `components/playback/playbackmanager` | `play` | `{"items":["$itemId"],"startPositionTicks":0,"mediaSourceId":"","audioStreamIndex":null,"subtitleStreamIndex":"-1"}` | the item, at the selection current AT CLICK TIME | 1 | none — playback is owned by the player |
| `btnInstantMix` | activate the instant-mix control | visible, enabled | `item.Type "MusicArtist" is in INSTANT_MIX_TYPES` | `components/playback/playbackmanager` | `instantMix` | `["$itemId"]` | the item | 1 | none |
| `btnShuffle` | activate the shuffle control | visible, enabled | `item.IsFolder \|\| item.Type is in SHUFFLE_TYPES` | `components/playback/playbackmanager` | `shuffle` | `["$itemId"]` | the item | 1 | none |
| `btnUserRating` | activate the favourite control | visible, enabled | `itemHelper.canRate(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useToggleFavoriteMutation` | `markFavoriteItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnMoreCommands` | activate the more-commands control | visible when components/itemContextMenu getCommands returns at least one command | `getCommands(contextMenuOptions(item, user)).length > 0` | `components/itemContextMenu` | `show` | `{"item":"$itemId","user":"$userId","open":false,"play":false,"playAllFromHere":false,"queueAllFromHere":false,"cancelTimer":false,"record":false,"deleteItem":false,"shuffle":false,"instantMix":false,"share":true,"positionTo":"<the action bar element>"}` | the ITEM — never the selected media-source id (SUSPECT #4, delta D4) | 1 | result.deleted -> appRouter.showItem(parent) or goHome(); result.updated -> refresh(); dismissal -> nothing |

<details><summary>Declared absences — controls this class must NOT offer</summary>

| Action | Why it is absent |
| --- | --- |
| `btnReplay` | no stored resume position, or the item is not playable |
| `btnPlayTrailer` | the item declares no local or remote trailer |
| `btnCancelTimer` | item.Type is "MusicArtist", not "Recording" |
| `btnCancelSeriesTimer` | item.Type is "MusicArtist", not "SeriesTimer" |
| `btnDownload` | item.Type "MusicArtist" is not a downloadable Book |
| `btnPlaystate` | itemHelper.canMarkPlayed is false for item.Type "MusicArtist" |
| `btnSplitVersions` | the acting user is not an administrator |

</details>

### `playlist`

| Action | Trigger | State | Preconditions | Service | Member | Payload | Target | × | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --: | --- |
| `btnPlay` | activate the play control (pointer or keyboard) | visible, enabled | `playbackGates(item).canPlay` | `components/playback/playbackmanager` | `play` | `{"items":["$itemId"],"startPositionTicks":0,"mediaSourceId":"","audioStreamIndex":null,"subtitleStreamIndex":"-1"}` | the item, at the selection current AT CLICK TIME | 1 | none — playback is owned by the player |
| `btnShuffle` | activate the shuffle control | visible, enabled | `item.IsFolder \|\| item.Type is in SHUFFLE_TYPES` | `components/playback/playbackmanager` | `shuffle` | `["$itemId"]` | the item | 1 | none |
| `btnUserRating` | activate the favourite control | visible, enabled | `itemHelper.canRate(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useToggleFavoriteMutation` | `markFavoriteItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnMoreCommands` | activate the more-commands control | visible when components/itemContextMenu getCommands returns at least one command | `getCommands(contextMenuOptions(item, user)).length > 0` | `components/itemContextMenu` | `show` | `{"item":"$itemId","user":"$userId","open":false,"play":false,"playAllFromHere":false,"queueAllFromHere":false,"cancelTimer":false,"record":false,"deleteItem":false,"shuffle":false,"instantMix":false,"share":true,"positionTo":"<the action bar element>"}` | the ITEM — never the selected media-source id (SUSPECT #4, delta D4) | 1 | result.deleted -> appRouter.showItem(parent) or goHome(); result.updated -> refresh(); dismissal -> nothing |

<details><summary>Declared absences — controls this class must NOT offer</summary>

| Action | Why it is absent |
| --- | --- |
| `btnReplay` | no stored resume position, or the item is not playable |
| `btnInstantMix` | item.Type "Playlist" is not in INSTANT_MIX_TYPES, or the item is not playable |
| `btnPlayTrailer` | the item declares no local or remote trailer |
| `btnCancelTimer` | item.Type is "Playlist", not "Recording" |
| `btnCancelSeriesTimer` | item.Type is "Playlist", not "SeriesTimer" |
| `btnDownload` | item.Type "Playlist" is not a downloadable Book |
| `btnPlaystate` | itemHelper.canMarkPlayed is false for item.Type "Playlist" |
| `btnSplitVersions` | the acting user is not an administrator |

</details>

### `box-set`

| Action | Trigger | State | Preconditions | Service | Member | Payload | Target | × | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --: | --- |
| `btnPlaystate` | activate the played control | visible, enabled | `itemHelper.canMarkPlayed(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useTogglePlayedMutation` | `markPlayedItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id — never a media-source id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnUserRating` | activate the favourite control | visible, enabled | `itemHelper.canRate(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useToggleFavoriteMutation` | `markFavoriteItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnMoreCommands` | activate the more-commands control | visible when components/itemContextMenu getCommands returns at least one command | `getCommands(contextMenuOptions(item, user)).length > 0` | `components/itemContextMenu` | `show` | `{"item":"$itemId","user":"$userId","open":false,"play":false,"playAllFromHere":false,"queueAllFromHere":false,"cancelTimer":false,"record":false,"deleteItem":false,"shuffle":false,"instantMix":false,"share":true,"positionTo":"<the action bar element>"}` | the ITEM — never the selected media-source id (SUSPECT #4, delta D4) | 1 | result.deleted -> appRouter.showItem(parent) or goHome(); result.updated -> refresh(); dismissal -> nothing |

<details><summary>Declared absences — controls this class must NOT offer</summary>

| Action | Why it is absent |
| --- | --- |
| `btnPlay` | the collection's children contain nothing playable (delta D7) |
| `btnReplay` | no stored resume position, or the item is not playable |
| `btnInstantMix` | item.Type "BoxSet" is not in INSTANT_MIX_TYPES, or the item is not playable |
| `btnShuffle` | the collection's children contain nothing playable (delta D7) |
| `btnPlayTrailer` | the item declares no local or remote trailer |
| `btnCancelTimer` | item.Type is "BoxSet", not "Recording" |
| `btnCancelSeriesTimer` | item.Type is "BoxSet", not "SeriesTimer" |
| `btnDownload` | item.Type "BoxSet" is not a downloadable Book |
| `btnSplitVersions` | the acting user is not an administrator |

</details>

### `person`

| Action | Trigger | State | Preconditions | Service | Member | Payload | Target | × | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --: | --- |
| `btnUserRating` | activate the favourite control | visible, enabled | `itemHelper.canRate(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useToggleFavoriteMutation` | `markFavoriteItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnMoreCommands` | activate the more-commands control | visible when components/itemContextMenu getCommands returns at least one command | `getCommands(contextMenuOptions(item, user)).length > 0` | `components/itemContextMenu` | `show` | `{"item":"$itemId","user":"$userId","open":false,"play":false,"playAllFromHere":false,"queueAllFromHere":false,"cancelTimer":false,"record":false,"deleteItem":false,"shuffle":false,"instantMix":false,"share":true,"positionTo":"<the action bar element>"}` | the ITEM — never the selected media-source id (SUSPECT #4, delta D4) | 1 | result.deleted -> appRouter.showItem(parent) or goHome(); result.updated -> refresh(); dismissal -> nothing |

<details><summary>Declared absences — controls this class must NOT offer</summary>

| Action | Why it is absent |
| --- | --- |
| `btnPlay` | playbackGates(item).canPlay is false for item.Type "Person" |
| `btnReplay` | no stored resume position, or the item is not playable |
| `btnInstantMix` | item.Type "Person" is not in INSTANT_MIX_TYPES, or the item is not playable |
| `btnShuffle` | the item is neither a folder nor a shuffleable music type |
| `btnPlayTrailer` | the item declares no local or remote trailer |
| `btnCancelTimer` | item.Type is "Person", not "Recording" |
| `btnCancelSeriesTimer` | item.Type is "Person", not "SeriesTimer" |
| `btnDownload` | item.Type "Person" is not a downloadable Book |
| `btnPlaystate` | itemHelper.canMarkPlayed is false for item.Type "Person" |
| `btnSplitVersions` | the acting user is not an administrator |

</details>

### `book`

| Action | Trigger | State | Preconditions | Service | Member | Payload | Target | × | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --: | --- |
| `btnDownload` | activate the download control | visible, enabled | `item.Type === "Book" && item.CanDownload && appHost.supports(FileDownload)` | `@jellyfin/sdk library-api getDownloadUrl, then scripts/fileDownloader download` | `getDownloadUrl + download` | `{"getDownloadUrl":{"itemId":"$itemId"},"download":[{"url":"@opaque:the getDownloadUrl result","itemId":"$itemId","serverId":"$serverId","title":"A Book","filename":"a-book.epub"}]}` | the item | 1 | none |
| `btnPlaystate` | activate the played control | visible, enabled | `itemHelper.canMarkPlayed(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useTogglePlayedMutation` | `markPlayedItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id — never a media-source id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnUserRating` | activate the favourite control | visible, enabled | `itemHelper.canRate(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useToggleFavoriteMutation` | `markFavoriteItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnMoreCommands` | activate the more-commands control | visible when components/itemContextMenu getCommands returns at least one command | `getCommands(contextMenuOptions(item, user)).length > 0` | `components/itemContextMenu` | `show` | `{"item":"$itemId","user":"$userId","open":false,"play":false,"playAllFromHere":false,"queueAllFromHere":false,"cancelTimer":false,"record":false,"deleteItem":false,"shuffle":false,"instantMix":false,"share":true,"positionTo":"<the action bar element>"}` | the ITEM — never the selected media-source id (SUSPECT #4, delta D4) | 1 | result.deleted -> appRouter.showItem(parent) or goHome(); result.updated -> refresh(); dismissal -> nothing |

<details><summary>Declared absences — controls this class must NOT offer</summary>

| Action | Why it is absent |
| --- | --- |
| `btnPlay` | playbackGates(item).canPlay is false for item.Type "Book" |
| `btnReplay` | no stored resume position, or the item is not playable |
| `btnInstantMix` | item.Type "Book" is not in INSTANT_MIX_TYPES, or the item is not playable |
| `btnShuffle` | the item is neither a folder nor a shuffleable music type |
| `btnPlayTrailer` | the item declares no local or remote trailer |
| `btnCancelTimer` | item.Type is "Book", not "Recording" |
| `btnCancelSeriesTimer` | item.Type is "Book", not "SeriesTimer" |
| `btnSplitVersions` | the acting user is not an administrator |

</details>

### `photo`

| Action | Trigger | State | Preconditions | Service | Member | Payload | Target | × | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --: | --- |
| `btnUserRating` | activate the favourite control | visible, enabled | `itemHelper.canRate(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useToggleFavoriteMutation` | `markFavoriteItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnMoreCommands` | activate the more-commands control | visible when components/itemContextMenu getCommands returns at least one command | `getCommands(contextMenuOptions(item, user)).length > 0` | `components/itemContextMenu` | `show` | `{"item":"$itemId","user":"$userId","open":false,"play":false,"playAllFromHere":false,"queueAllFromHere":false,"cancelTimer":false,"record":false,"deleteItem":false,"shuffle":false,"instantMix":false,"share":true,"positionTo":"<the action bar element>"}` | the ITEM — never the selected media-source id (SUSPECT #4, delta D4) | 1 | result.deleted -> appRouter.showItem(parent) or goHome(); result.updated -> refresh(); dismissal -> nothing |

<details><summary>Declared absences — controls this class must NOT offer</summary>

| Action | Why it is absent |
| --- | --- |
| `btnPlay` | playbackGates(item).canPlay is false for item.Type "Photo" |
| `btnReplay` | no stored resume position, or the item is not playable |
| `btnInstantMix` | item.Type "Photo" is not in INSTANT_MIX_TYPES, or the item is not playable |
| `btnShuffle` | the item is neither a folder nor a shuffleable music type |
| `btnPlayTrailer` | the item declares no local or remote trailer |
| `btnCancelTimer` | item.Type is "Photo", not "Recording" |
| `btnCancelSeriesTimer` | item.Type is "Photo", not "SeriesTimer" |
| `btnDownload` | item.Type "Photo" is not a downloadable Book |
| `btnPlaystate` | itemHelper.canMarkPlayed is false for item.Type "Photo" |
| `btnSplitVersions` | the acting user is not an administrator |

</details>

### `program`

No action is offered.

<details><summary>Declared absences — controls this class must NOT offer</summary>

| Action | Why it is absent |
| --- | --- |
| `btnPlay` | the programme is outside its airing window, so no action bar renders at all |
| `btnReplay` | no stored resume position, or the item is not playable |
| `btnInstantMix` | item.Type "Program" is not in INSTANT_MIX_TYPES, or the item is not playable |
| `btnShuffle` | the item is neither a folder nor a shuffleable music type |
| `btnPlayTrailer` | the item declares no local or remote trailer |
| `btnCancelTimer` | item.Type is "Program", not "Recording" |
| `btnCancelSeriesTimer` | item.Type is "Program", not "SeriesTimer" |
| `btnDownload` | item.Type "Program" is not a downloadable Book |
| `btnPlaystate` | itemHelper.canMarkPlayed is false for item.Type "Program" |
| `btnUserRating` | itemHelper.canRate is false for item.Type "Program" |
| `btnSplitVersions` | the item has no media source of Type "Grouping" |
| `btnMoreCommands` | the programme is outside its airing window, so no action bar renders at all |

</details>

### `recording`

| Action | Trigger | State | Preconditions | Service | Member | Payload | Target | × | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --: | --- |
| `btnPlay` | activate the play control (pointer or keyboard) | visible, enabled | `playbackGates(item).canPlay` | `components/playback/playbackmanager` | `play` | `{"items":["$itemId"],"startPositionTicks":0,"mediaSourceId":"$itemId","audioStreamIndex":null,"subtitleStreamIndex":"-1"}` | the item, at the selection current AT CLICK TIME | 1 | none — playback is owned by the player |
| `btnCancelTimer` | activate the stop-recording control | visible, enabled | `item.Type === "Recording" && user.Policy.EnableLiveTvManagement && item.TimerId && item.Status === "InProgress"` | `components/recordingcreator/recordinghelper (dynamically imported at click time)` | `cancelTimer` | `["<the api client for item.ServerId>","$timerId"]` | the TIMER, not the item | 1 | refresh() — invalidates every ["itemDetails", …] query |
| `btnPlaystate` | activate the played control | visible, enabled | `itemHelper.canMarkPlayed(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useTogglePlayedMutation` | `markPlayedItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id — never a media-source id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnUserRating` | activate the favourite control | visible, enabled | `itemHelper.canRate(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useToggleFavoriteMutation` | `markFavoriteItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnMoreCommands` | activate the more-commands control | visible when components/itemContextMenu getCommands returns at least one command | `getCommands(contextMenuOptions(item, user)).length > 0` | `components/itemContextMenu` | `show` | `{"item":"$itemId","user":"$userId","open":false,"play":false,"playAllFromHere":false,"queueAllFromHere":false,"cancelTimer":false,"record":false,"deleteItem":false,"shuffle":false,"instantMix":false,"share":true,"positionTo":"<the action bar element>"}` | the ITEM — never the selected media-source id (SUSPECT #4, delta D4) | 1 | result.deleted -> appRouter.showItem(parent) or goHome(); result.updated -> refresh(); dismissal -> nothing |

<details><summary>Declared absences — controls this class must NOT offer</summary>

| Action | Why it is absent |
| --- | --- |
| `btnReplay` | no stored resume position, or the item is not playable |
| `btnInstantMix` | item.Type "Recording" is not in INSTANT_MIX_TYPES, or the item is not playable |
| `btnShuffle` | the item is neither a folder nor a shuffleable music type |
| `btnPlayTrailer` | the item declares no local or remote trailer |
| `btnCancelSeriesTimer` | item.Type is "Recording", not "SeriesTimer" |
| `btnDownload` | item.Type "Recording" is not a downloadable Book |
| `btnSplitVersions` | the item has no media source of Type "Grouping" |

</details>

### `recording-no-livetv`

| Action | Trigger | State | Preconditions | Service | Member | Payload | Target | × | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --: | --- |
| `btnPlay` | activate the play control (pointer or keyboard) | visible, enabled | `playbackGates(item).canPlay` | `components/playback/playbackmanager` | `play` | `{"items":["$itemId"],"startPositionTicks":0,"mediaSourceId":"$itemId","audioStreamIndex":null,"subtitleStreamIndex":"-1"}` | the item, at the selection current AT CLICK TIME | 1 | none — playback is owned by the player |
| `btnPlaystate` | activate the played control | visible, enabled | `itemHelper.canMarkPlayed(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useTogglePlayedMutation` | `markPlayedItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id — never a media-source id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnUserRating` | activate the favourite control | visible, enabled | `itemHelper.canRate(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useToggleFavoriteMutation` | `markFavoriteItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnMoreCommands` | activate the more-commands control | visible when components/itemContextMenu getCommands returns at least one command | `getCommands(contextMenuOptions(item, user)).length > 0` | `components/itemContextMenu` | `show` | `{"item":"$itemId","user":"$userId","open":false,"play":false,"playAllFromHere":false,"queueAllFromHere":false,"cancelTimer":false,"record":false,"deleteItem":false,"shuffle":false,"instantMix":false,"share":true,"positionTo":"<the action bar element>"}` | the ITEM — never the selected media-source id (SUSPECT #4, delta D4) | 1 | result.deleted -> appRouter.showItem(parent) or goHome(); result.updated -> refresh(); dismissal -> nothing |

<details><summary>Declared absences — controls this class must NOT offer</summary>

| Action | Why it is absent |
| --- | --- |
| `btnReplay` | no stored resume position, or the item is not playable |
| `btnInstantMix` | item.Type "Recording" is not in INSTANT_MIX_TYPES, or the item is not playable |
| `btnShuffle` | the item is neither a folder nor a shuffleable music type |
| `btnPlayTrailer` | the item declares no local or remote trailer |
| `btnCancelTimer` | the user has no live-TV management permission, or the recording is not in progress |
| `btnCancelSeriesTimer` | item.Type is "Recording", not "SeriesTimer" |
| `btnDownload` | item.Type "Recording" is not a downloadable Book |
| `btnSplitVersions` | the acting user is not an administrator |

</details>

### `series-timer`

| Action | Trigger | State | Preconditions | Service | Member | Payload | Target | × | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --: | --- |
| `btnCancelSeriesTimer` | activate the cancel-series control | visible, enabled | `item.Type === "SeriesTimer" && user.Policy.EnableLiveTvManagement` | `components/recordingcreator/recordinghelper (dynamically imported at click time)` | `cancelSeriesTimerWithConfirmation` | `["$itemId","$serverId"]` | the series timer | 1 | utils/dashboard navigate("livetv") |
| `btnMoreCommands` | activate the more-commands control | visible when components/itemContextMenu getCommands returns at least one command | `getCommands(contextMenuOptions(item, user)).length > 0` | `components/itemContextMenu` | `show` | `{"item":"$itemId","user":"$userId","open":false,"play":false,"playAllFromHere":false,"queueAllFromHere":false,"cancelTimer":false,"record":false,"deleteItem":false,"shuffle":false,"instantMix":false,"share":true,"positionTo":"<the action bar element>"}` | the ITEM — never the selected media-source id (SUSPECT #4, delta D4) | 1 | result.deleted -> appRouter.showItem(parent) or goHome(); result.updated -> refresh(); dismissal -> nothing |

<details><summary>Declared absences — controls this class must NOT offer</summary>

| Action | Why it is absent |
| --- | --- |
| `btnPlay` | playbackGates(item).canPlay is false for item.Type "SeriesTimer" |
| `btnReplay` | no stored resume position, or the item is not playable |
| `btnInstantMix` | item.Type "SeriesTimer" is not in INSTANT_MIX_TYPES, or the item is not playable |
| `btnShuffle` | the item is neither a folder nor a shuffleable music type |
| `btnPlayTrailer` | the item declares no local or remote trailer |
| `btnCancelTimer` | item.Type is "SeriesTimer", not "Recording" |
| `btnDownload` | item.Type "SeriesTimer" is not a downloadable Book |
| `btnPlaystate` | itemHelper.canMarkPlayed is false for item.Type "SeriesTimer" |
| `btnUserRating` | itemHelper.canRate is false for item.Type "SeriesTimer" |
| `btnSplitVersions` | the item has no media source of Type "Grouping" |

</details>

### `series-timer-no-livetv`

| Action | Trigger | State | Preconditions | Service | Member | Payload | Target | × | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --: | --- |
| `btnMoreCommands` | activate the more-commands control | visible when components/itemContextMenu getCommands returns at least one command | `getCommands(contextMenuOptions(item, user)).length > 0` | `components/itemContextMenu` | `show` | `{"item":"$itemId","user":"$userId","open":false,"play":false,"playAllFromHere":false,"queueAllFromHere":false,"cancelTimer":false,"record":false,"deleteItem":false,"shuffle":false,"instantMix":false,"share":true,"positionTo":"<the action bar element>"}` | the ITEM — never the selected media-source id (SUSPECT #4, delta D4) | 1 | result.deleted -> appRouter.showItem(parent) or goHome(); result.updated -> refresh(); dismissal -> nothing |

<details><summary>Declared absences — controls this class must NOT offer</summary>

| Action | Why it is absent |
| --- | --- |
| `btnPlay` | playbackGates(item).canPlay is false for item.Type "SeriesTimer" |
| `btnReplay` | no stored resume position, or the item is not playable |
| `btnInstantMix` | item.Type "SeriesTimer" is not in INSTANT_MIX_TYPES, or the item is not playable |
| `btnShuffle` | the item is neither a folder nor a shuffleable music type |
| `btnPlayTrailer` | the item declares no local or remote trailer |
| `btnCancelTimer` | item.Type is "SeriesTimer", not "Recording" |
| `btnCancelSeriesTimer` | the user has no live-TV management permission |
| `btnDownload` | item.Type "SeriesTimer" is not a downloadable Book |
| `btnPlaystate` | itemHelper.canMarkPlayed is false for item.Type "SeriesTimer" |
| `btnUserRating` | itemHelper.canRate is false for item.Type "SeriesTimer" |
| `btnSplitVersions` | the acting user is not an administrator |

</details>

### `tv-channel`

| Action | Trigger | State | Preconditions | Service | Member | Payload | Target | × | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --: | --- |
| `btnPlay` | activate the play control (pointer or keyboard) | visible, enabled | `playbackGates(item).canPlay` | `components/playback/playbackmanager` | `play` | `{"items":["$itemId"],"startPositionTicks":0,"mediaSourceId":"$itemId","audioStreamIndex":null,"subtitleStreamIndex":"-1"}` | the item, at the selection current AT CLICK TIME | 1 | none — playback is owned by the player |
| `btnUserRating` | activate the favourite control | visible, enabled | `itemHelper.canRate(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useToggleFavoriteMutation` | `markFavoriteItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnMoreCommands` | activate the more-commands control | visible when components/itemContextMenu getCommands returns at least one command | `getCommands(contextMenuOptions(item, user)).length > 0` | `components/itemContextMenu` | `show` | `{"item":"$itemId","user":"$userId","open":false,"play":false,"playAllFromHere":false,"queueAllFromHere":false,"cancelTimer":false,"record":false,"deleteItem":false,"shuffle":false,"instantMix":false,"share":true,"positionTo":"<the action bar element>"}` | the ITEM — never the selected media-source id (SUSPECT #4, delta D4) | 1 | result.deleted -> appRouter.showItem(parent) or goHome(); result.updated -> refresh(); dismissal -> nothing |

<details><summary>Declared absences — controls this class must NOT offer</summary>

| Action | Why it is absent |
| --- | --- |
| `btnReplay` | no stored resume position, or the item is not playable |
| `btnInstantMix` | item.Type "TvChannel" is not in INSTANT_MIX_TYPES, or the item is not playable |
| `btnShuffle` | the item is neither a folder nor a shuffleable music type |
| `btnPlayTrailer` | the item declares no local or remote trailer |
| `btnCancelTimer` | item.Type is "TvChannel", not "Recording" |
| `btnCancelSeriesTimer` | item.Type is "TvChannel", not "SeriesTimer" |
| `btnDownload` | item.Type "TvChannel" is not a downloadable Book |
| `btnPlaystate` | itemHelper.canMarkPlayed is false for item.Type "TvChannel" |
| `btnSplitVersions` | the acting user is not an administrator |

</details>

### `genre`

| Action | Trigger | State | Preconditions | Service | Member | Payload | Target | × | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --: | --- |
| `btnPlay` | activate the play control (pointer or keyboard) | visible, enabled | `playbackGates(item).canPlay` | `components/playback/playbackmanager` | `play` | `{"items":["$itemId"],"startPositionTicks":0,"mediaSourceId":"","audioStreamIndex":null,"subtitleStreamIndex":"-1"}` | the item, at the selection current AT CLICK TIME | 1 | none — playback is owned by the player |
| `btnShuffle` | activate the shuffle control | visible, enabled | `item.IsFolder \|\| item.Type is in SHUFFLE_TYPES` | `components/playback/playbackmanager` | `shuffle` | `["$itemId"]` | the item | 1 | none |
| `btnUserRating` | activate the favourite control | visible, enabled | `itemHelper.canRate(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useToggleFavoriteMutation` | `markFavoriteItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnMoreCommands` | activate the more-commands control | visible when components/itemContextMenu getCommands returns at least one command | `getCommands(contextMenuOptions(item, user)).length > 0` | `components/itemContextMenu` | `show` | `{"item":"$itemId","user":"$userId","open":false,"play":false,"playAllFromHere":false,"queueAllFromHere":false,"cancelTimer":false,"record":false,"deleteItem":false,"shuffle":false,"instantMix":false,"share":true,"positionTo":"<the action bar element>"}` | the ITEM — never the selected media-source id (SUSPECT #4, delta D4) | 1 | result.deleted -> appRouter.showItem(parent) or goHome(); result.updated -> refresh(); dismissal -> nothing |

<details><summary>Declared absences — controls this class must NOT offer</summary>

| Action | Why it is absent |
| --- | --- |
| `btnReplay` | no stored resume position, or the item is not playable |
| `btnInstantMix` | item.Type "Genre" is not in INSTANT_MIX_TYPES, or the item is not playable |
| `btnPlayTrailer` | the item declares no local or remote trailer |
| `btnCancelTimer` | item.Type is "Genre", not "Recording" |
| `btnCancelSeriesTimer` | item.Type is "Genre", not "SeriesTimer" |
| `btnDownload` | item.Type "Genre" is not a downloadable Book |
| `btnPlaystate` | itemHelper.canMarkPlayed is false for item.Type "Genre" |
| `btnSplitVersions` | the acting user is not an administrator |

</details>

### `music-genre`

| Action | Trigger | State | Preconditions | Service | Member | Payload | Target | × | Follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --: | --- |
| `btnPlay` | activate the play control (pointer or keyboard) | visible, enabled | `playbackGates(item).canPlay` | `components/playback/playbackmanager` | `play` | `{"items":["$itemId"],"startPositionTicks":0,"mediaSourceId":"","audioStreamIndex":null,"subtitleStreamIndex":"-1"}` | the item, at the selection current AT CLICK TIME | 1 | none — playback is owned by the player |
| `btnInstantMix` | activate the instant-mix control | visible, enabled | `item.Type "MusicGenre" is in INSTANT_MIX_TYPES` | `components/playback/playbackmanager` | `instantMix` | `["$itemId"]` | the item | 1 | none |
| `btnShuffle` | activate the shuffle control | visible, enabled | `item.IsFolder \|\| item.Type is in SHUFFLE_TYPES` | `components/playback/playbackmanager` | `shuffle` | `["$itemId"]` | the item | 1 | none |
| `btnUserRating` | activate the favourite control | visible, enabled | `itemHelper.canRate(item)` | `@jellyfin/sdk user-data-api, through hooks/useFetchItems useToggleFavoriteMutation` | `markFavoriteItem` | `{"userId":"$userId","itemId":"$itemId"}` | the ITEM id, with the acting user id | 1 | invalidateQueries({queryKey: undefined, type: "all", refetchType: "active"}) — the WHOLE active read set re-issues |
| `btnMoreCommands` | activate the more-commands control | visible when components/itemContextMenu getCommands returns at least one command | `getCommands(contextMenuOptions(item, user)).length > 0` | `components/itemContextMenu` | `show` | `{"item":"$itemId","user":"$userId","open":false,"play":false,"playAllFromHere":false,"queueAllFromHere":false,"cancelTimer":false,"record":false,"deleteItem":false,"shuffle":false,"instantMix":false,"share":true,"positionTo":"<the action bar element>"}` | the ITEM — never the selected media-source id (SUSPECT #4, delta D4) | 1 | result.deleted -> appRouter.showItem(parent) or goHome(); result.updated -> refresh(); dismissal -> nothing |

<details><summary>Declared absences — controls this class must NOT offer</summary>

| Action | Why it is absent |
| --- | --- |
| `btnReplay` | no stored resume position, or the item is not playable |
| `btnPlayTrailer` | the item declares no local or remote trailer |
| `btnCancelTimer` | item.Type is "MusicGenre", not "Recording" |
| `btnCancelSeriesTimer` | item.Type is "MusicGenre", not "SeriesTimer" |
| `btnDownload` | item.Type "MusicGenre" is not a downloadable Book |
| `btnPlaystate` | itemHelper.canMarkPlayed is false for item.Type "MusicGenre" |
| `btnSplitVersions` | the acting user is not an administrator |

</details>

## 9. Local-state variants

A variant is the same class with a declared local-state change applied before the action. Variants
exist because several identity guarantees are unobservable at the default selection.

### `movie` / `alternate-source-selected`

the second media source is selected before the action is taken

Setup: `selectSource` := `$mediaSourceId.1`.

| Action | Member | Expectation | What it proves |
| --- | --- | --- | --- |
| `btnPlay` | `play` | `{"items":["$itemId"],"startPositionTicks":0,"mediaSourceId":"$mediaSourceId.1","audioStreamIndex":"1","subtitleStreamIndex":"3"}` | play follows the selection made AFTER render |
| `btnMoreCommands` | `show` | target = `$itemId` | the context menu targets the ITEM even when an alternate media source is selected (SUSPECT #4, delta D4) |

### `movie` / `tracks-changed`

the audio and subtitle selections are changed before play

Setup: `selectAudio` := `2`, `selectSubtitles` := `-1`.

| Action | Member | Expectation | What it proves |
| --- | --- | --- | --- |
| `btnPlay` | `play` | `{"items":["$itemId"],"startPositionTicks":0,"mediaSourceId":"$itemId","audioStreamIndex":"2","subtitleStreamIndex":"-1"}` | the play options are read at CLICK time, not captured at render time |

### `movie-resumable` / `alternate-source-selected`

the second media source is selected before the action is taken

Setup: `selectSource` := `$mediaSourceId.1`.

| Action | Member | Expectation | What it proves |
| --- | --- | --- | --- |
| `btnPlay` | `play` | `{"items":["$itemId"],"startPositionTicks":6000000000,"mediaSourceId":"$mediaSourceId.1","audioStreamIndex":"1","subtitleStreamIndex":"3"}` | play follows the selection made AFTER render |
| `btnMoreCommands` | `show` | target = `$itemId` | the context menu targets the ITEM even when an alternate media source is selected (SUSPECT #4, delta D4) |

### `movie-resumable` / `tracks-changed`

the audio and subtitle selections are changed before play

Setup: `selectAudio` := `2`, `selectSubtitles` := `-1`.

| Action | Member | Expectation | What it proves |
| --- | --- | --- | --- |
| `btnPlay` | `play` | `{"items":["$itemId"],"startPositionTicks":6000000000,"mediaSourceId":"$itemId","audioStreamIndex":"2","subtitleStreamIndex":"-1"}` | the play options are read at CLICK time, not captured at render time |

### `movie-grouped-admin` / `alternate-source-selected`

the second media source is selected before the action is taken

Setup: `selectSource` := `$mediaSourceId.1`.

| Action | Member | Expectation | What it proves |
| --- | --- | --- | --- |
| `btnPlay` | `play` | `{"items":["$itemId"],"startPositionTicks":0,"mediaSourceId":"$mediaSourceId.1","audioStreamIndex":"1","subtitleStreamIndex":"3"}` | play follows the selection made AFTER render |
| `btnMoreCommands` | `show` | target = `$itemId` | the context menu targets the ITEM even when an alternate media source is selected (SUSPECT #4, delta D4) |

### `movie-grouped-admin` / `tracks-changed`

the audio and subtitle selections are changed before play

Setup: `selectAudio` := `2`, `selectSubtitles` := `-1`.

| Action | Member | Expectation | What it proves |
| --- | --- | --- | --- |
| `btnPlay` | `play` | `{"items":["$itemId"],"startPositionTicks":0,"mediaSourceId":"$itemId","audioStreamIndex":"2","subtitleStreamIndex":"-1"}` | the play options are read at CLICK time, not captured at render time |

### `movie-grouped-regular` / `alternate-source-selected`

the second media source is selected before the action is taken

Setup: `selectSource` := `$mediaSourceId.1`.

| Action | Member | Expectation | What it proves |
| --- | --- | --- | --- |
| `btnPlay` | `play` | `{"items":["$itemId"],"startPositionTicks":0,"mediaSourceId":"$mediaSourceId.1","audioStreamIndex":"1","subtitleStreamIndex":"3"}` | play follows the selection made AFTER render |
| `btnMoreCommands` | `show` | target = `$itemId` | the context menu targets the ITEM even when an alternate media source is selected (SUSPECT #4, delta D4) |

### `movie-grouped-regular` / `tracks-changed`

the audio and subtitle selections are changed before play

Setup: `selectAudio` := `2`, `selectSubtitles` := `-1`.

| Action | Member | Expectation | What it proves |
| --- | --- | --- | --- |
| `btnPlay` | `play` | `{"items":["$itemId"],"startPositionTicks":0,"mediaSourceId":"$itemId","audioStreamIndex":"2","subtitleStreamIndex":"-1"}` | the play options are read at CLICK time, not captured at render time |

### `program` / `inside-airing-window`

the programme is inside its airing window. The window is expressed relatively, never as a literal timestamp, so the ledger carries no environment-specific data.

Item override: `StartDate` = `$now-60s`, `EndDate` = `$now+60s`.

| Action | Member | Expectation | What it proves |
| --- | --- | --- | --- |
| `btnPlay` | `play` | target = `$channelId` | a Program plays its CHANNEL, never itself |

## 10. Controls that reach nothing outward

A control that is intentionally local is recorded, not omitted. `itemDetails.ledger.test.tsx`
activates every one of them and asserts that **no** request and **no** service call follows.

| Class | Control | Classification | Reason |
| --- | --- | --- | --- |
| `movie` | `overviewToggle` | `LOCAL_ONLY` | expands or collapses the clamped overview through React state only. No request, no navigation, no service call. |
| `movie` | `selectSource` | `LOCAL_ONLY` | changes the media source the NEXT play action targets, and resets the audio/subtitle choices to that source's declared defaults. Issues no request itself. |
| `movie` | `selectAudio` | `LOCAL_ONLY` | changes the audio stream index the NEXT play action sends. Issues no request itself. |
| `movie` | `selectSubtitles` | `LOCAL_ONLY` | changes the subtitle stream index the NEXT play action sends. Issues no request itself. |
| `movie` | `selectVideo` | `DISABLED` | rendered and permanently disabled. SUSPECT #3 records that the legacy route never read it; removing a recorded control is an owner decision, not a migration one. |
| `movie-resumable` | `overviewToggle` | `LOCAL_ONLY` | expands or collapses the clamped overview through React state only. No request, no navigation, no service call. |
| `movie-resumable` | `selectSource` | `LOCAL_ONLY` | changes the media source the NEXT play action targets, and resets the audio/subtitle choices to that source's declared defaults. Issues no request itself. |
| `movie-resumable` | `selectAudio` | `LOCAL_ONLY` | changes the audio stream index the NEXT play action sends. Issues no request itself. |
| `movie-resumable` | `selectSubtitles` | `LOCAL_ONLY` | changes the subtitle stream index the NEXT play action sends. Issues no request itself. |
| `movie-resumable` | `selectVideo` | `DISABLED` | rendered and permanently disabled. SUSPECT #3 records that the legacy route never read it; removing a recorded control is an owner decision, not a migration one. |
| `movie-grouped-admin` | `overviewToggle` | `LOCAL_ONLY` | expands or collapses the clamped overview through React state only. No request, no navigation, no service call. |
| `movie-grouped-admin` | `selectSource` | `LOCAL_ONLY` | changes the media source the NEXT play action targets, and resets the audio/subtitle choices to that source's declared defaults. Issues no request itself. |
| `movie-grouped-admin` | `selectAudio` | `LOCAL_ONLY` | changes the audio stream index the NEXT play action sends. Issues no request itself. |
| `movie-grouped-admin` | `selectSubtitles` | `LOCAL_ONLY` | changes the subtitle stream index the NEXT play action sends. Issues no request itself. |
| `movie-grouped-admin` | `selectVideo` | `DISABLED` | rendered and permanently disabled. SUSPECT #3 records that the legacy route never read it; removing a recorded control is an owner decision, not a migration one. |
| `movie-grouped-regular` | `overviewToggle` | `LOCAL_ONLY` | expands or collapses the clamped overview through React state only. No request, no navigation, no service call. |
| `movie-grouped-regular` | `selectSource` | `LOCAL_ONLY` | changes the media source the NEXT play action targets, and resets the audio/subtitle choices to that source's declared defaults. Issues no request itself. |
| `movie-grouped-regular` | `selectAudio` | `LOCAL_ONLY` | changes the audio stream index the NEXT play action sends. Issues no request itself. |
| `movie-grouped-regular` | `selectSubtitles` | `LOCAL_ONLY` | changes the subtitle stream index the NEXT play action sends. Issues no request itself. |
| `movie-grouped-regular` | `selectVideo` | `DISABLED` | rendered and permanently disabled. SUSPECT #3 records that the legacy route never read it; removing a recorded control is an owner decision, not a migration one. |
| `minimal-video` | `selectSource` | `LOCAL_ONLY` | changes the media source the NEXT play action targets, and resets the audio/subtitle choices to that source's declared defaults. Issues no request itself. |
| `minimal-video` | `selectAudio` | `LOCAL_ONLY` | changes the audio stream index the NEXT play action sends. Issues no request itself. |
| `minimal-video` | `selectSubtitles` | `LOCAL_ONLY` | changes the subtitle stream index the NEXT play action sends. Issues no request itself. |
| `minimal-video` | `selectVideo` | `DISABLED` | rendered and permanently disabled. SUSPECT #3 records that the legacy route never read it; removing a recorded control is an owner decision, not a migration one. |
| `series` | `overviewToggle` | `LOCAL_ONLY` | expands or collapses the clamped overview through React state only. No request, no navigation, no service call. |
| `episode` | `selectSource` | `LOCAL_ONLY` | changes the media source the NEXT play action targets, and resets the audio/subtitle choices to that source's declared defaults. Issues no request itself. |
| `episode` | `selectAudio` | `LOCAL_ONLY` | changes the audio stream index the NEXT play action sends. Issues no request itself. |
| `episode` | `selectSubtitles` | `LOCAL_ONLY` | changes the subtitle stream index the NEXT play action sends. Issues no request itself. |
| `episode` | `selectVideo` | `DISABLED` | rendered and permanently disabled. SUSPECT #3 records that the legacy route never read it; removing a recorded control is an owner decision, not a migration one. |
| `person` | `overviewToggle` | `LOCAL_ONLY` | expands or collapses the clamped overview through React state only. No request, no navigation, no service call. |
| `program` | `recordingFields.controls` | `DELEGATED` | the one imperative adapter in the migrated slice. Its controls belong to the legacy recording widget, not to this route; the route owns only the widget lifecycle. |
| `recording` | `selectSource` | `LOCAL_ONLY` | changes the media source the NEXT play action targets, and resets the audio/subtitle choices to that source's declared defaults. Issues no request itself. |
| `recording` | `selectAudio` | `LOCAL_ONLY` | changes the audio stream index the NEXT play action sends. Issues no request itself. |
| `recording` | `selectSubtitles` | `LOCAL_ONLY` | changes the subtitle stream index the NEXT play action sends. Issues no request itself. |
| `recording` | `selectVideo` | `DISABLED` | rendered and permanently disabled. SUSPECT #3 records that the legacy route never read it; removing a recorded control is an owner decision, not a migration one. |
| `recording-no-livetv` | `selectSource` | `LOCAL_ONLY` | changes the media source the NEXT play action targets, and resets the audio/subtitle choices to that source's declared defaults. Issues no request itself. |
| `recording-no-livetv` | `selectAudio` | `LOCAL_ONLY` | changes the audio stream index the NEXT play action sends. Issues no request itself. |
| `recording-no-livetv` | `selectSubtitles` | `LOCAL_ONLY` | changes the subtitle stream index the NEXT play action sends. Issues no request itself. |
| `recording-no-livetv` | `selectVideo` | `DISABLED` | rendered and permanently disabled. SUSPECT #3 records that the legacy route never read it; removing a recorded control is an owner decision, not a migration one. |

## 11. Navigation affordances

Clicking a card or a link is browser navigation, not a route-owned outward call, so what is frozen
is the **target identity**: which id fills the URL. Confusing a child id for this route's item id
would be a navigation defect and is what these rows exist to pin.

| Class | Affordance | Section | URL shape | Target | Note |
| --- | --- | --- | --- | --- | --- |
| `movie` | `itemDetailsGroup.metadataLinks` | `itemDetailsGroup` | `appRouter.getRouteUrl(person \| studio \| genre stub)` | the metadata entry id | six lists, in the frozen order; a list with no entries renders nothing |
| `movie` | `itemExternalLinks.links` | `itemExternalLinks` | `the item-declared absolute URL, target="_blank" rel="noreferrer"` | none — server-declared external URL | suppressed on TV layouts and when appHost does not support ExternalLinks |
| `movie` | `cards.itemLinks` | `every card-bearing section` | `#/details?id=<id>&serverId=<serverId>` | the CHILD item id — never this route's item id | rendered by ui MediaCard; clicking is browser navigation, not a route-owned outward call |
| `movie-resumable` | `itemDetailsGroup.metadataLinks` | `itemDetailsGroup` | `appRouter.getRouteUrl(person \| studio \| genre stub)` | the metadata entry id | six lists, in the frozen order; a list with no entries renders nothing |
| `movie-resumable` | `itemExternalLinks.links` | `itemExternalLinks` | `the item-declared absolute URL, target="_blank" rel="noreferrer"` | none — server-declared external URL | suppressed on TV layouts and when appHost does not support ExternalLinks |
| `movie-resumable` | `cards.itemLinks` | `every card-bearing section` | `#/details?id=<id>&serverId=<serverId>` | the CHILD item id — never this route's item id | rendered by ui MediaCard; clicking is browser navigation, not a route-owned outward call |
| `movie-grouped-admin` | `itemDetailsGroup.metadataLinks` | `itemDetailsGroup` | `appRouter.getRouteUrl(person \| studio \| genre stub)` | the metadata entry id | six lists, in the frozen order; a list with no entries renders nothing |
| `movie-grouped-admin` | `itemExternalLinks.links` | `itemExternalLinks` | `the item-declared absolute URL, target="_blank" rel="noreferrer"` | none — server-declared external URL | suppressed on TV layouts and when appHost does not support ExternalLinks |
| `movie-grouped-admin` | `cards.itemLinks` | `every card-bearing section` | `#/details?id=<id>&serverId=<serverId>` | the CHILD item id — never this route's item id | rendered by ui MediaCard; clicking is browser navigation, not a route-owned outward call |
| `movie-grouped-regular` | `itemDetailsGroup.metadataLinks` | `itemDetailsGroup` | `appRouter.getRouteUrl(person \| studio \| genre stub)` | the metadata entry id | six lists, in the frozen order; a list with no entries renders nothing |
| `movie-grouped-regular` | `itemExternalLinks.links` | `itemExternalLinks` | `the item-declared absolute URL, target="_blank" rel="noreferrer"` | none — server-declared external URL | suppressed on TV layouts and when appHost does not support ExternalLinks |
| `movie-grouped-regular` | `cards.itemLinks` | `every card-bearing section` | `#/details?id=<id>&serverId=<serverId>` | the CHILD item id — never this route's item id | rendered by ui MediaCard; clicking is browser navigation, not a route-owned outward call |
| `minimal-video` | `itemDetailsGroup.metadataLinks` | `itemDetailsGroup` | `appRouter.getRouteUrl(person \| studio \| genre stub)` | the metadata entry id | six lists, in the frozen order; a list with no entries renders nothing |
| `minimal-video` | `cards.itemLinks` | `every card-bearing section` | `#/details?id=<id>&serverId=<serverId>` | the CHILD item id — never this route's item id | rendered by ui MediaCard; clicking is browser navigation, not a route-owned outward call |
| `series` | `itemDetailsGroup.metadataLinks` | `itemDetailsGroup` | `appRouter.getRouteUrl(person \| studio \| genre stub)` | the metadata entry id | six lists, in the frozen order; a list with no entries renders nothing |
| `series` | `cards.itemLinks` | `every card-bearing section` | `#/details?id=<id>&serverId=<serverId>` | the CHILD item id — never this route's item id | rendered by ui MediaCard; clicking is browser navigation, not a route-owned outward call |
| `season` | `nameContainer.parentLinks` | `nameContainer` | `appRouter.getRouteUrl(parent)` | seriesId \| seasonId \| albumId \| albumArtistId | MUST PRESERVE #8 — an episode links to its series AND its season |
| `season` | `itemDetailsGroup.metadataLinks` | `itemDetailsGroup` | `appRouter.getRouteUrl(person \| studio \| genre stub)` | the metadata entry id | six lists, in the frozen order; a list with no entries renders nothing |
| `season` | `cards.itemLinks` | `every card-bearing section` | `#/details?id=<id>&serverId=<serverId>` | the CHILD item id — never this route's item id | rendered by ui MediaCard; clicking is browser navigation, not a route-owned outward call |
| `episode` | `nameContainer.parentLinks` | `nameContainer` | `appRouter.getRouteUrl(parent)` | seriesId \| seasonId \| albumId \| albumArtistId | MUST PRESERVE #8 — an episode links to its series AND its season |
| `episode` | `itemDetailsGroup.metadataLinks` | `itemDetailsGroup` | `appRouter.getRouteUrl(person \| studio \| genre stub)` | the metadata entry id | six lists, in the frozen order; a list with no entries renders nothing |
| `episode` | `cards.itemLinks` | `every card-bearing section` | `#/details?id=<id>&serverId=<serverId>` | the CHILD item id — never this route's item id | rendered by ui MediaCard; clicking is browser navigation, not a route-owned outward call |
| `music-album` | `nameContainer.parentLinks` | `nameContainer` | `appRouter.getRouteUrl(parent)` | seriesId \| seasonId \| albumId \| albumArtistId | MUST PRESERVE #8 — an episode links to its series AND its season |
| `music-album` | `itemDetailsGroup.metadataLinks` | `itemDetailsGroup` | `appRouter.getRouteUrl(person \| studio \| genre stub)` | the metadata entry id | six lists, in the frozen order; a list with no entries renders nothing |
| `music-album` | `cards.itemLinks` | `every card-bearing section` | `#/details?id=<id>&serverId=<serverId>` | the CHILD item id — never this route's item id | rendered by ui MediaCard; clicking is browser navigation, not a route-owned outward call |
| `audio` | `nameContainer.parentLinks` | `nameContainer` | `appRouter.getRouteUrl(parent)` | seriesId \| seasonId \| albumId \| albumArtistId | MUST PRESERVE #8 — an episode links to its series AND its season |
| `audio` | `itemDetailsGroup.metadataLinks` | `itemDetailsGroup` | `appRouter.getRouteUrl(person \| studio \| genre stub)` | the metadata entry id | six lists, in the frozen order; a list with no entries renders nothing |
| `audio` | `cards.itemLinks` | `every card-bearing section` | `#/details?id=<id>&serverId=<serverId>` | the CHILD item id — never this route's item id | rendered by ui MediaCard; clicking is browser navigation, not a route-owned outward call |
| `music-artist` | `itemDetailsGroup.metadataLinks` | `itemDetailsGroup` | `appRouter.getRouteUrl(person \| studio \| genre stub)` | the metadata entry id | six lists, in the frozen order; a list with no entries renders nothing |
| `music-artist` | `cards.itemLinks` | `every card-bearing section` | `#/details?id=<id>&serverId=<serverId>` | the CHILD item id — never this route's item id | rendered by ui MediaCard; clicking is browser navigation, not a route-owned outward call |
| `playlist` | `itemDetailsGroup.metadataLinks` | `itemDetailsGroup` | `appRouter.getRouteUrl(person \| studio \| genre stub)` | the metadata entry id | six lists, in the frozen order; a list with no entries renders nothing |
| `playlist` | `cards.itemLinks` | `every card-bearing section` | `#/details?id=<id>&serverId=<serverId>` | the CHILD item id — never this route's item id | rendered by ui MediaCard; clicking is browser navigation, not a route-owned outward call |
| `box-set` | `itemDetailsGroup.metadataLinks` | `itemDetailsGroup` | `appRouter.getRouteUrl(person \| studio \| genre stub)` | the metadata entry id | six lists, in the frozen order; a list with no entries renders nothing |
| `box-set` | `cards.itemLinks` | `every card-bearing section` | `#/details?id=<id>&serverId=<serverId>` | the CHILD item id — never this route's item id | rendered by ui MediaCard; clicking is browser navigation, not a route-owned outward call |
| `person` | `itemDetailsGroup.metadataLinks` | `itemDetailsGroup` | `appRouter.getRouteUrl(person \| studio \| genre stub)` | the metadata entry id | six lists, in the frozen order; a list with no entries renders nothing |
| `person` | `cards.itemLinks` | `every card-bearing section` | `#/details?id=<id>&serverId=<serverId>` | the CHILD item id — never this route's item id | rendered by ui MediaCard; clicking is browser navigation, not a route-owned outward call |
| `book` | `itemDetailsGroup.metadataLinks` | `itemDetailsGroup` | `appRouter.getRouteUrl(person \| studio \| genre stub)` | the metadata entry id | six lists, in the frozen order; a list with no entries renders nothing |
| `book` | `cards.itemLinks` | `every card-bearing section` | `#/details?id=<id>&serverId=<serverId>` | the CHILD item id — never this route's item id | rendered by ui MediaCard; clicking is browser navigation, not a route-owned outward call |
| `photo` | `itemDetailsGroup.metadataLinks` | `itemDetailsGroup` | `appRouter.getRouteUrl(person \| studio \| genre stub)` | the metadata entry id | six lists, in the frozen order; a list with no entries renders nothing |
| `photo` | `cards.itemLinks` | `every card-bearing section` | `#/details?id=<id>&serverId=<serverId>` | the CHILD item id — never this route's item id | rendered by ui MediaCard; clicking is browser navigation, not a route-owned outward call |
| `program` | `itemDetailsGroup.metadataLinks` | `itemDetailsGroup` | `appRouter.getRouteUrl(person \| studio \| genre stub)` | the metadata entry id | six lists, in the frozen order; a list with no entries renders nothing |
| `program` | `cards.itemLinks` | `every card-bearing section` | `#/details?id=<id>&serverId=<serverId>` | the CHILD item id — never this route's item id | rendered by ui MediaCard; clicking is browser navigation, not a route-owned outward call |
| `recording` | `itemDetailsGroup.metadataLinks` | `itemDetailsGroup` | `appRouter.getRouteUrl(person \| studio \| genre stub)` | the metadata entry id | six lists, in the frozen order; a list with no entries renders nothing |
| `recording` | `cards.itemLinks` | `every card-bearing section` | `#/details?id=<id>&serverId=<serverId>` | the CHILD item id — never this route's item id | rendered by ui MediaCard; clicking is browser navigation, not a route-owned outward call |
| `recording-no-livetv` | `itemDetailsGroup.metadataLinks` | `itemDetailsGroup` | `appRouter.getRouteUrl(person \| studio \| genre stub)` | the metadata entry id | six lists, in the frozen order; a list with no entries renders nothing |
| `recording-no-livetv` | `cards.itemLinks` | `every card-bearing section` | `#/details?id=<id>&serverId=<serverId>` | the CHILD item id — never this route's item id | rendered by ui MediaCard; clicking is browser navigation, not a route-owned outward call |
| `series-timer` | `itemDetailsGroup.metadataLinks` | `itemDetailsGroup` | `appRouter.getRouteUrl(person \| studio \| genre stub)` | the metadata entry id | six lists, in the frozen order; a list with no entries renders nothing |
| `series-timer` | `cards.itemLinks` | `every card-bearing section` | `#/details?id=<id>&serverId=<serverId>` | the CHILD item id — never this route's item id | rendered by ui MediaCard; clicking is browser navigation, not a route-owned outward call |
| `series-timer-no-livetv` | `itemDetailsGroup.metadataLinks` | `itemDetailsGroup` | `appRouter.getRouteUrl(person \| studio \| genre stub)` | the metadata entry id | six lists, in the frozen order; a list with no entries renders nothing |
| `series-timer-no-livetv` | `cards.itemLinks` | `every card-bearing section` | `#/details?id=<id>&serverId=<serverId>` | the CHILD item id — never this route's item id | rendered by ui MediaCard; clicking is browser navigation, not a route-owned outward call |
| `tv-channel` | `itemDetailsGroup.metadataLinks` | `itemDetailsGroup` | `appRouter.getRouteUrl(person \| studio \| genre stub)` | the metadata entry id | six lists, in the frozen order; a list with no entries renders nothing |
| `tv-channel` | `cards.itemLinks` | `every card-bearing section` | `#/details?id=<id>&serverId=<serverId>` | the CHILD item id — never this route's item id | rendered by ui MediaCard; clicking is browser navigation, not a route-owned outward call |
| `genre` | `itemDetailsGroup.metadataLinks` | `itemDetailsGroup` | `appRouter.getRouteUrl(person \| studio \| genre stub)` | the metadata entry id | six lists, in the frozen order; a list with no entries renders nothing |
| `genre` | `cards.itemLinks` | `every card-bearing section` | `#/details?id=<id>&serverId=<serverId>` | the CHILD item id — never this route's item id | rendered by ui MediaCard; clicking is browser navigation, not a route-owned outward call |
| `music-genre` | `itemDetailsGroup.metadataLinks` | `itemDetailsGroup` | `appRouter.getRouteUrl(person \| studio \| genre stub)` | the metadata entry id | six lists, in the frozen order; a list with no entries renders nothing |
| `music-genre` | `cards.itemLinks` | `every card-bearing section` | `#/details?id=<id>&serverId=<serverId>` | the CHILD item id — never this route's item id | rendered by ui MediaCard; clicking is browser navigation, not a route-owned outward call |

## 12. Effect frontier

Every module the slice imports, classified. `ledger.effectFrontier.test.ts` reads the imports from
source and fails in both directions: an unclassified dependency, or a classification for a module
nothing imports any more.

| Module | Classification | Surface | Note |
| --- | --- | --- | --- |
| `lib/jellyfin-apiclient` | `OUTWARD_API` | `legacy` | ServerConnections — the legacy apiClient and the SDK Api for this route |
| `@jellyfin/sdk/lib/utils/api/library-api` | `OUTWARD_API` | `sdk` | getItemCollections and getDownloadUrl |
| `@jellyfin/sdk/lib/websocket` | `OUTWARD_API` | `legacy` | names the UserDataChanged subscription |
| `components/playback/playbackmanager` | `OUTWARD_SERVICE` | `service.playbackManager` | play, replay, instantMix, shuffle, playTrailers; also the canPlay/getSupportedCommands capability gates |
| `components/itemContextMenu` | `OUTWARD_SERVICE` | `service.itemContextMenu` | getCommands (render) and show (action) |
| `components/confirm/confirm` | `OUTWARD_SERVICE` | `service.confirm` | the split-versions confirmation |
| `components/recordingcreator/recordinghelper` | `OUTWARD_SERVICE` | `service.recordingHelper` | dynamically imported at click time by cancelTimer and cancelSeriesTimer |
| `components/recordingcreator/recordingfields` | `DELEGATED_WIDGET` | `service.recordingFields` | the one imperative adapter; owns its own reads and controls |
| `components/router/appRouter` | `OUTWARD_NAVIGATION` | `service.appRouter` | showItem/goHome after a context-menu deletion, and getRouteUrl for link building |
| `utils/dashboard` | `OUTWARD_NAVIGATION` | `service.dashboard` | navigate("livetv") after a series timer is cancelled |
| `utils/events` | `OUTWARD_SERVICE` | `service.events` | Events.trigger(document, REFRESH_NEEDED) after split versions |
| `scripts/fileDownloader` | `OUTWARD_SERVICE` | `service.fileDownloader` | the Book download action |
| `scripts/libraryMenu` | `OUTWARD_SERVICE` | `service.libraryMenu` | dynamically imported by the route module to clear the chrome title |
| `elements/emby-playstatebutton/PlayedButton` | `OUTWARD_MUTATION` | `sdk.userData` | markPlayedItem / markUnplayedItem through hooks/useFetchItems |
| `elements/emby-ratingbutton/FavoriteButton` | `OUTWARD_MUTATION` | `sdk.userData` | markFavoriteItem / unmarkFavoriteItem through hooks/useFetchItems |
| `components/itemDetails/ItemDetailsMetadataList` | `OUTWARD_NAVIGATION` | `service.appRouter` | renders the six metadata link lists |
| `@tanstack/react-query` | `CACHE` | — | query keys and invalidation; issues nothing itself |
| `components/apphost` | `CAPABILITY` | — | AppFeature gates for downloads and external links |
| `components/layoutManager` | `CAPABILITY` | — | the TV-layout gate on external links |
| `components/itemHelper` | `PURE` | — | canMarkPlayed, canRate, sortTracks, getDisplayName, supportsMediaSourceSelection |
| `components/mediainfo/PrimaryMediaInfo` | `PURE` | — | renders item fields; issues nothing |
| `components/mediainfo/SecondaryMediaInfo` | `PURE` | — | renders item fields; issues nothing |
| `components/mediainfo/usePrimaryMediaInfo` | `PURE` | — | derives display strings from the item |
| `components/mediainfo/useSecondaryMediaInfo` | `PURE` | — | derives display strings from the item |
| `components/Page` | `UI` | — | the page shell |
| `ui` | `UI` | — | the published design system: MediaCard, MediaGrid, EmptyState, ErrorState, LoadingState |
| `lib/globalize` | `PURE` | — | translation |
| `scripts/datetime` | `PURE` | — | date formatting |
| `dompurify` | `PURE` | — | overview sanitisation |
| `markdown-it` | `PURE` | — | overview rendering |
| `react` | `PURE` | — |  |
| `react-router-dom` | `OUTWARD_NAVIGATION` | `service.router` | Link and useSearchParams |
| `constants/appFeature` | `PURE` | — |  |
| `constants/eventType` | `PURE` | — |  |
| `@jellyfin/sdk/lib/generated-client/models/base-item-kind` | `PURE` | — | type constants only |
| `@jellyfin/sdk/lib/generated-client/models/item-fields` | `PURE` | — | type constants only |
| `@jellyfin/sdk/lib/generated-client/models/person-kind` | `PURE` | — | type constants only |

## 13. What Step 2 must preserve

Step 2 binds `presentation.page.itemDetails`. A recipe **orders and selects**; it must not change
any of the following, and `compareLedgerRuns` in `tests/itemDetails/support/ledger.ts` is written
to be re-run against the bound route to prove it:

1. all 172 request rows, with their exact arguments, identities and cardinalities;
2. all 93 action rows, with their exact payloads and targets;
3. all 30 `LOCAL_ONLY` classifications — a themed control must not acquire an outward effect;
4. all 367 declared read absences and 195 declared action absences;
5. the rule that a section hidden by a recipe **still fetches** — the query is gated on the class
   branch condition, the section on the result, never the other way round.

The open decision surface Step 2 inherits is recorded in
`docs/tesserafin/item-details-legacy-contract.md` §13 and
`docs/tesserafin/item-details-migration.md`: the platform default
(`hero: backdrop`, sections `overview, cast, episodes, related, mediaInfo`) names five
surfaces, while the migrated composition renders up to 33 named sections in a fixed order. No class
reproduces the declared default, so binding it as written is a visible change and needs an owner
ruling before Step 2 lands.

## 14. Known limits of this record

1. **Fixture-shaped.** Cardinalities and payloads are frozen against the 24 fixture items in
   `tests/fixtures/item-details/items.ts`. A server DTO with a shape no fixture carries could
   reach a branch this ledger does not describe. The effect-frontier gate bounds that risk: a new
   branch cannot introduce a new outward surface without failing.
2. **Role collisions.** Where an item id and its first media-source id are the same string (§5), a
   substitution between them is unobservable at the default selection. The declared variants cover
   it where an alternate source exists; three classes have exactly one media source and no variant.
3. **The delegated widget.** `components/recordingcreator/recordingfields` owns its own reads,
   subscriptions and controls. They are recorded as `delegated`, not decomposed: reimplementing the
   recording editor is a different piece of work, and the route owns only the widget lifecycle.
4. **Time.** One variant needs a programme inside its airing window. It is expressed relatively
   (`$now-60s` / `$now+60s`) and resolved at assertion time, so the fixture carries no timestamp.
5. **Not a rendering record.** Section order, headings, artwork and accessibility are frozen by the
   P6 suites (`itemDetails.characterization.test.tsx`, `itemDetails.browser.spec.ts`). This ledger
   deliberately says nothing about them.
