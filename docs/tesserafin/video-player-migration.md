# Video player: migration off the legacy controller

The player page is `/video`. Its route (`apps/modern/routes/video`) is one lazy modern route in
**both** route families since DEBT-WEB-2, by the rule `/details` follows: a slice migrated to React
lives in that route's tree, so a family that kept the bare view-manager page would lose it. The TV
layout (the remote) is the legacy family. The route renders the legacy view
(`apps/legacy/controllers/playback/video`) and, around it, what has been migrated so far.

## Migrated

| Slice | Where | Since |
|---|---|---|
| Top bar (modern layout only; legacy layouts keep the app header) | `routes/video/index.tsx` | before Tesserafin |
| Audio and subtitle menus, their two buttons, secondary subtitles | `apps/modern/features/playerTracks` | DEBT-WEB-2 |
| Settings menu, its button and submenus (aspect ratio, speed, quality, repeat), and the commands that open the stats and subtitle-offset overlays | `apps/modern/features/playerTracks` | DEBT-WEB-3 |
| Playback data and subtitle offset panels, the `G`/`H` keys' effect, the `togglestats` command's target | `apps/modern/features/playerPanels` | DEBT-WEB-4 |

### Audio and subtitle menus (DEBT-WEB-2)

- **Adapter** `playerTracks.ts`: `readTracks()` (tracks, selections, whether secondary subtitles are
  offered), `subscribeTracks()` (player change, `playbackstart`, `playbackstop`,
  `mediastreamschange`; the returned function removes every listener), and three commands.
  A command carries the playback it was chosen for — the engine's `player.playback`, replaced by
  every play request and kept across a stream change — and is dropped when that is no longer the
  current player's. A menu left open on film A therefore cannot change film B, including film A
  played again.
- **Host contract** `TrackMenuHost`: the controller lends the slot `.osdTrackMenus` in its button
  row and `onMenuOpenChange`, which suspends its shortcuts, input commands, wheel volume and OSD auto-hide
  while a menu is open. Set on `viewshow`, cleared on `viewbeforehide` (which closes an open menu).
- **Menus** `TrackMenus.tsx`: `role="menu"` with `menuitemradio` rows. Escape, a remote's Back or the
  `back` command close the menu and **return the focus to the button that opened it**; so does a
  choice. Arrow keys, Home and End move within the menu and reach nothing behind it. The menu closes
  by itself when its playback stops or is replaced. Outside the TV layout it is anchored above its
  button; on TV it takes the screen with the list centred.
- **Guard** `tests/boundary/playerTrackMenus.guard.test.ts`: the controller may not regain an action
  sheet, a track command, the old menu functions or the old buttons, and the React menus may not
  use an action sheet, `dialogHelper` or a second React root.

### Settings menu (DEBT-WEB-3)

- **Adapter** `playerSettings.ts`: `readSettings()` returns a snapshot taken for one playback —
  aspect ratio, playback speed, quality and repeat mode, each `null` where the old menu hid it
  (the player's supported commands; quality also needs a transcodable source and the user's
  `EnableVideoPlaybackTranscoding`; repeat needs a runtime), and whether the subtitle offset is
  offered (the player can shift subtitles and the track on is external). It waits on
  `getCurrentUser()` for the permission and returns `null` if the playback changed meanwhile.
  Five commands (`setAspectRatio`, `setPlaybackRate`, `setMaxBitrate` — 0 is Auto —,
  `setRepeatMode`) carry the playback the way the track commands do (the offset's own command
  moved to `playerPanels` in DEBT-WEB-4).
- **Host contract** grows: `settingsSlot` (`.osdSettingsMenu`, where the old button stood).
- **Menus**: the same component and the same open-menu state as the track menus, so the shortcut and
  auto-hide suspension, the close on stop or replacement and the close on view hide are shared.
  A submenu row has `aria-haspopup="menu"`; Escape, Back or the `back` command in a submenu return
  to its parent menu with the focus on the row that opened it, and a second Escape closes the menu
  onto its button. The secondary-subtitles submenu now behaves the same way. A choice closes
  everything. A snapshot that arrives after another menu was opened is not shown.
- **Engine**: `playbackManager.setMaxStreamingBitrate` looks up the endpoint (and, for Auto, measures
  the bitrate) before it restarts the stream. It now drops the change if the playback it was asked
  for has been replaced or stopped by then — the only engine edit in this slice, tested in
  `softwareRecoveryAttempt.test.ts`.
- `components/playback/playersettingsmenu.js` is deleted; the video controller was its only user.
  The guard also rejects the old button, the old functions and the settings commands in the
  controller.

### Playback data and subtitle offset panels (DEBT-WEB-4)

Characterized on the rig against main `e8bb6bf14b` before the move, and kept:

- **Playback data**: categories *Playback info* (player name and play method), the player's own
  `getStats()` rows (stream type, player and video sizes, dropped frames; unnamed, so no heading),
  *Transcoding / Remuxing / Direct streaming info* when the session has `TranscodingInfo` (target
  codecs, progress and speed, reasons), *Original media info* (container, video codec and
  attributes, bit depth, colours, audio codec and attributes, from the media source and the audio
  track in use) and *SyncPlay* (time-sync device and offset, playback difference, method) while a
  group is active. Sources: the player, `GET /Sessions?deviceId=` (this device's session — what
  the server shows a non-admin user is the server's to decide), the engine's media source and
  tracks, the SyncPlay manager. It refreshes on the player's `timeupdate`, at most every 700 ms,
  and asks the server at most every 10 s. Top left; on TV smaller and without a close button
  (closed from the settings menu, as before). It survives a film change and follows the new film.
- **Subtitle offset**: seconds, slider −30…+30 in steps of 0.1, a field that takes the first number
  typed on Enter (clamped and rounded to the slider; anything else leaves the offset as it was),
  `G`/`H` one step down/up. Offered only when the player can shift subtitles and the track on is
  external. Shown while the controls are, while it has the focus, or after a `G`/`H` press; the
  engine resets it to 0 on a new play request or a subtitle switch.

What changed:

- **Adapters** `playerStats.ts` (a reader per playback, its own 10 s session cache, `null` once the
  playback is gone — so a late answer for film A is never drawn over film B) and
  `subtitleOffset.ts` (state naming the playback; every command checks it; the offset shown is the
  one set, not read back from the player, which applies it 100 ms late — three quick `H` presses
  moved it by one step on main).
- **Panels** `PlayerPanels.tsx`, rendered by the video route beside the menus, portalled to the
  body, only while the player view lends its host. Each listens to the player and the page only
  while open. Escape (and a remote's `back`) closes a panel onto the settings button; the offset
  panel takes the focus on opening, so the arrows adjust it at once; the field keeps every key from
  the player's shortcuts. A subtitle switch keeps the offset panel at 0 on a track it can shift and
  closes it otherwise; a replaced film closes it. Values are text: the transcode reasons were HTML
  joined with `<br/>`.
- Deleted: `components/playerstats`, `components/subtitlesync` (template and styles included), and
  in the controller `toggleStats`, `destroyStats`, `toggleSubtitleSync`, `destroySubtitleSync` and
  the host callbacks `onSubtitlesChanged`, `onToggleStats`, `onShowSubtitleOffset`. The controller
  forwards `G`/`H` (`nudgeSubtitleOffset`) and `togglestats` (`toggleStats`). The guard rejects the
  old modules and names, and offset commands, in the controller; the `video-player` delivery
  boundary covers `features/playerPanels`.

Not changed by DEBT-WEB-2: the engine. `playbackManager.setAudioStreamIndex` on a direct-played
item still resolves a device profile asynchronously before acting; a replacement landing inside
that window is the engine's to guard, not the menu's.

## Still in `playback/video/index.js` (inventory for the next slices)

| Area | Functions | Notes |
|---|---|---|
| OSD visibility and idle | `showOsd`, `hideOsd`, `toggleOsd`, `startOsdHideTimer`, `resetIdle`, `slideDownToShow`/`slideUpToHide`, `showMainOsdControls`/`hideMainOsdControls`, `setSubtitleClearance`, pointer/touch handlers | `SHOW_VIDEO_OSD` drives the modern top bar |
| Title and media info | `getDisplayItem`, `updateDisplayItem`, `setTitle`, `updateNowPlayingInfo` | Live TV program refresh (`refreshProgramInfoIfNeeded`) |
| Position, time, trickplay, chapters | `updateTimeDisplay`, `updateTimeText`, `nowPlayingDurationTextClick`, slider `getBubbleHtml`/`updateBubbleHtml`/`getMarkerInfo`, `updateTrickplayBubbleHtml`, `getChapterBubbleHtml` | Trickplay URLs carry a capability (#153-A1) |
| Transport | play/pause, rewind/fast-forward, previous/next chapter and track, `updatePlaylist`, `updatePlayPauseState` | |
| Volume | `updatePlayerVolumeState`, mute, slider, `onWheel` | |
| Window | fullscreen, PiP, AirPlay buttons, `onFullscreenChanged` | |
| Up next | `showComingUpNextIfNeeded`, `showComingUpNext`, `onPromptSkip`, `resetUpNextDialog` | |
| Recording and rating buttons | `updateRecordingButton`, `btnUserRating` | Legacy custom elements |
| Keyboard and remote | `onKeyDown`, `onInputCommand`, `onClickCapture` | Suspended while a menu is open |
| Player binding and lifecycle | `bindToPlayer`, `releaseCurrentPlayer`, `onStateChanged`, `onPlaybackStart`/`Stopped`, `enableStopOnBack`, `onViewHideStopPlayback`, `updatePlaybackRate` | |
| SyncPlay | `showIcon` and the SyncPlay manager listeners | |
