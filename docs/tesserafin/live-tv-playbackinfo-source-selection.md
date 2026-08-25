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
`getPlayerData(player).subtitleStreamIndex` - assigned at `:4456` from
`mediaSource.DefaultSubtitleStreamIndex`, and at `:1920` by `setSubtitleStreamIndex`.
`getPreviousSource` is called only from `self.nextTrack` (`:4287`) and `self.previousTrack` (`:4314`).

**Pure channel switching does not trigger it.** Measured against the software-tuner rig, an opened
Live TV source carries `DefaultAudioStreamIndex = -1` and `DefaultSubtitleStreamIndex = null`. The
audio branch does run (`-1` is a number) but `rankStreamType`'s early return only writes
`trackOptions` for `Subtitle`, and the subtitle branch never runs because `null` is not a number. So
after a channel plays, `channelUp`/`channelDown` (`:4242`/`:4247`, both `nextTrack`/`previousTrack`)
leave `isIdFallbackNeeded` false. `toggleSubtitles` cannot change that either: with no subtitle
streams, `setSubtitleStreamIndex` returns early at `!currentStream && !newStream` (`:1849`) before
it would set player data to `-1`.

**The reachable trigger is a mixed queue.** An ordinary video whose subtitle selection is remembered
as "off" leaves `getPlayerData(player).subtitleStreamIndex === -1` (server side:
`MediaSourceManager.cs:516-518` writes `DefaultSubtitleStreamIndex = -1` from
`userData.SubtitleStreamIndex`). A Live TV channel can be added to the play queue while that video
is playing - `playbackManager.canQueue(channel)` is `canQueueMediaType('Video')`, which is true with
a video player active, so `itemContextMenu.js:91` offers "AddToPlayQueue" on a channel card. When
the queue advances onto the channel, `prevIndex == -1` fires the subtitle early return,
`isIdFallbackNeeded` becomes true, and the channel item id is sent as `MediaSourceId`.

This is reproduced at the request boundary in
`src/components/playback/livetvPlaybackInfoRequest.test.ts`, which drives the real manager through
`play()` then `nextTrack()`.

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

## 10. The rig's positive oracle (#153-WEB-R2)

`#153-WEB-R1` finding **F4-1**: `scripts/livetv-rig/acceptance.mjs` graded source selection with
`returnedSourceIds[0] !== CHANNEL_ID`. That is a negative property — a server answering with a
*wrong but different* id passed it — so the rig could not tell "the tuner source was selected" from
"something other than the channel item was selected".

### Where the expected id comes from

`scripts/livetv-rig/expected-source-id.py` derives it from the rig's own fixture:

| Step | Anchor |
|------|--------|
| the channel's `Path` is the trimmed non-`#` playlist line | `src/Tesserafin.LiveTv/TunerHosts/M3uParser.cs:106` |
| the media source id is that path's MD5, GUID-formatted `N` | `src/Tesserafin.LiveTv/TunerHosts/M3UTunerHost.cs:195` |
| `GetMD5` hashes the **UTF-16LE** bytes and re-reads them through .NET's little-endian `Guid` field layout | `Tesserafin.Common/Extensions/BaseExtensions.cs:30` |

For this rig's fixture that is `http://127.0.0.1:18099/channel1.ts` →
`f00baff0a649bca042e0aca880a6eaad`, and the value is **computed, never hardcoded**: changing
`TESSERAFIN_TUNER_PORT` moves it and the gate follows.

### When it becomes available

`run-acceptance.sh` derives it immediately after `make-fixture.sh` — **before** the tuner process
starts, before `POST /LiveTv/TunerHosts`, before the channel indexes, and before the browser exists.
It is handed to the harness as `LTV_EXPECTED_SOURCE_ID`.

### Why the response cannot influence it

The *input* to the hash is a line this rig wrote itself; only the *hash contract* is replicated from
the server, and a pure function of a value we own is not a value derived from the system under test.
The oracle is also kept out of record selection: the channel `PlaybackInfo` record is still chosen by
`itemId === CHANNEL_ID`, so a false oracle fails the equality instead of timing out on selection.
A missing or non-32-hex oracle **fails** the gate rather than skipping the assertion.

### What the gate now asserts

1. exactly one media source is returned (`sourceCount !== 1` fails — the raw body carries one);
2. that source's id equals the independently derived tuner source id, printing both named values;
3. that id is not the channel item id (the original defect shape, kept as a second property);
4. the browser did not send the channel item id as `MediaSourceId`, and no `ErrorCode` came back.

`scripts/livetv-rig/hostile-controls.mjs` is the permanent proof that all of it is load-bearing: it
mutates the returned id, the oracle, and the returned id to `CHANNEL_ID`, each in an isolated
copy under `scripts/livetv-rig/controls/`, and requires the gate to fail **naming that property**.
