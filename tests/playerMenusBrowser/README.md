# Player-menu focus regression

Run `npm run test:player-menu-browser` after `npm ci` and
`npx playwright install chromium`. Hosted quality CI runs the same command.
`PLAYER_MENU_CHROMIUM` optionally selects a locally installed Chromium executable.

The browser rig renders the real `TrackMenus`, track/settings adapters,
`focusManager`, keyboard navigation, events and menu styles. Classic and Frosted
use their generated token CSS and surface variants. The engine, API answer,
layout setting, translation and input-command dispatch are fixtures. There is no
media playback, server connection, physical remote or screen-reader proof here.
The separate webpack config never adds an entry to the production graph.

Before the fix, the ordinary audio/subtitle/settings and submenu Escape paths
already passed. The reproduced residual is a stream update while a menu is open:

- With one remaining audio track, the audio trigger disappears. Escape closes
  the menu but focus falls to the document instead of a control.
- With no remaining subtitle tracks, the focused subtitle row and its trigger
  disappear. Focus falls to the document while the menu remains open, so Escape
  no longer reaches its handler.

The fix recovers a lost row focus before another key can be pressed, preserves
any still-focused row, and uses the current settings button if the original
trigger disappeared. Playback teardown still closes without moving focus.

The 32 browser cases cover both themes in desktop and TV layout: three ordinary
menus, settings submenu/back navigation, disappearing-trigger cases (including zero remaining audio tracks), and
teardown while another destination holds focus. Unit tests also cover an update
that retains the focused row.

Local characterization: on the unmodified production component, Classic desktop
passed five browser cases and failed the two disappearing-trigger cases. After
the fix all 32 passed using Chromium 153.0.0 (a local executable override because
the Playwright browser archive could not be downloaded in this workspace).
The new unit regressions likewise failed before the fix. This extends #198/#199's
focus follow-up under tesserafin-project/tesserafin#306; it does not reopen their
accepted deliveries or change legacy `dialogHelper` behavior.
