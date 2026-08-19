# Live TV `PlaybackInfo` source selection (#153-LTV-P0)

All line references are against `origin/main` @ `75b38dd24807e3d42f61989d1a9f60c2615d0f2e`
(web) and `~/tesserafin-a1-server` @ `c0f39e07aa7b394558fa34b5dcdfa4896f004a3e` (server).

## 1. The single choke point

Every web `PlaybackInfo` request is built by
`src/components/playback/playbackmanager.js:561 getPlaybackInfo(player, apiClient, item, deviceProfile, mediaSourceId, liveStreamId, options)`,
which sets the field at `:638-640`

```js
if (mediaSourceId) {
    query.MediaSourceId = mediaSourceId;
}
```

and posts it at `:678` via `getMediaInfoApi(api).getPostedPlaybackInfo({ itemId, playbackInfoDto: query })`.

## 2. Reachers, and the `mediaSourceId` each supplies

| # | Call site | Origin of the value | Live TV channel outcome |
|---|-----------|---------------------|--------------------------|
| 1 | `:4025 getPlaybackMediaSource` ← `:3580` main play path | `playOptions.mediaSourceId`, or **`item.Id`** via `:3577 mediaSourceId ||= item.Id` | **defect site** |
| 2 | `:4025 getPlaybackMediaSource` ← `:3765` (`self.getPlaybackInfo`-style path) | `options.mediaSourceId` | caller-supplied |
| 3 | `:2131` direct, from `changeStream` | `currentMediaSource.Id` — the **resolved tuner source id** after a successful play | must be preserved |
| 4 | `:3817` direct, from `self.getPlaybackMediaSources` | literal `null` | field never sent |
| 5 | `:593` short-circuit on `item.PresetMediaSource` | n/a — no request is made; only `setStreamUrls` (`:550`) sets it, on the remote `sendPlaybackListToPlayer` path | n/a |

## 3. Where the placeholder is manufactured

`:3577 mediaSourceId ||= item.Id` is the only place in the web codebase that assigns an item id to a
media source id. It is guarded by `isIdFallbackNeeded` (`:3556-3577`), set when `autoSetNextTracks`
produced a default audio or subtitle index.

For a Live TV channel `:3502` forces `getMediaStreams = Promise.resolve([])`, so the scoring loop over
`mediaStreams` can never match. But `rankStreamType` (`:3234`) has an early branch that runs **before**
the `mediaStreams` guard at `:3254`:

```js
if (prevIndex == -1) {
    if (streamType == 'Subtitle') {
        if (isSecondarySubtitle) { trackOptions.DefaultSecondarySubtitleStreamIndex = -1; }
        else { trackOptions.DefaultSubtitleStreamIndex = -1; }
    }
    return;
}
```

So a previous source whose subtitle index is `-1` (subtitles off) sets
`trackOptions.DefaultSubtitleStreamIndex = -1` even with zero media streams,
`isIdFallbackNeeded` becomes `true`, and the channel item id is sent as `MediaSourceId`.

`prevSource` is supplied only by `getPreviousSource(player)` (`:4252`), which reads
`getPlayerData(player).subtitleStreamIndex` — assigned at `:4456` from
`mediaSource.DefaultSubtitleStreamIndex`, and at `:1920` by `setSubtitleStreamIndex`.
`getPreviousSource` is called only from `self.nextTrack` (`:4287`) and `self.previousTrack` (`:4314`),
which are exactly `self.channelUp` (`:4242`) and `self.channelDown` (`:4247`).

**Trigger:** the *second* `PlaybackInfo` — a queue advance onto a Live TV channel
(channel-up / channel-down, or `nextTrack` from any previous item), not the first play.

## 4. Deviation from the task premise

The task states the browser sends the channel item id as `MediaSourceId`, implying the first request.
That is **false for the first request** on clean main:

- `itemHelper.supportsMediaSourceSelection` returns `false` for `TvChannel`
  (`src/components/itemHelper.js:404`), so the modern details page never passes one.
- Legacy `itemDetails` clears `.selectSource` to `''` for channels
  (`src/apps/legacy/controllers/itemDetails/index.js`, `renderTrackSelections`), and `''` is falsy at `:638`.
- `self.getPlaybackMediaSources` passes `null` (reacher #4).

The *mechanism* the task describes is real; the *trigger* is the second request. Phase 0.6, the
Phase 3 defect fixture and hostile control #1 therefore describe the queue-advance request.

## 5. Why the server returns zero sources

- `Tesserafin.Api/Helpers/MediaInfoHelper.cs:169-176` — a non-empty `mediaSourceId` filters the list
  `Where(i => string.Equals(i.Id, mediaSourceId, StringComparison.OrdinalIgnoreCase))`.
- `Tesserafin.Api/Controllers/MediaInfoController.cs:250` — the same filter selects the source.
- Live TV channel sources are produced by `src/Tesserafin.LiveTv/LiveTvMediaSourceProvider.cs:53`
  and carry the **tuner** source id.
- The item-id-shaped id is the *static* source shape,
  `Tesserafin.Controller/Entities/BaseItem.cs:1252  Id = item.Id.ToString("N", …)`.

Placeholder in → zero sources → `NoCompatibleStream`
(`playbackmanager.js:842 validatePlaybackInfoResult`).

## 6. Frozen behavioural contract

| Case | Required request |
|------|------------------|
| non-Live-TV item with a selected media source | preserve `MediaSourceId` exactly |
| Live TV channel with `MediaSourceId === item.Id` | omit `MediaSourceId` |
| Live TV channel with no source id | omit it |
| Live TV channel with a resolved tuner source id `!== item.Id` | preserve it |
| recording, ordinary video, audio | unchanged |

Predicate: `isLiveTvChannelItem(item) && mediaSourceId === item.Id` → omit.

The type guard is load-bearing: reacher #1 can legitimately pass `item.Id` for an ordinary video
whose only media source id equals its item id (`BaseItem.cs:1252`), and that must keep working.

Live TV item kinds are the existing set at `:3498-3501`: `TvChannel`, `LiveTvChannel`.

The comparison is a plain `===`. The placeholder arrives from `mediaSourceId ||= item.Id`, so it is
the *same string by construction* — no case folding or dash stripping is correct here, because a
normalising compare would start dropping genuinely distinct ids.

## 7. Deliberately out of scope

`triggerShadowPlaybackSession({ …, mediaSourceId })` at `:688` passes the raw parameter rather than
`query.MediaSourceId`. It is flag-gated (default off), fire-and-forget, and is not a `PlaybackInfo`
field, so it is left unchanged by this minimal repair.

## 8. Isolation

The repair is confined to `src/components/playback/**` plus tests. No server, OpenAPI, generated SDK,
credential-runtime or #153-A1 change is required.

## 9. Open-PR collision inventory

- **PR #160** (`a1/playback-credential-transport`) modifies
  `src/components/playback/playbackmanager.js` (+151/-37). Its nearest hunk to the fix seam is
  `@@ -575,7 +617,7 @@`, inside `getPlaybackInfo`; the seam here is `:638-640`. Adjacent-hunk
  textual proximity only, no semantic overlap.
- No other open PR touches `src/components/playback/**`; the remaining open PRs are Dependabot
  bumps limited to `package.json` / `package-lock.json`.
