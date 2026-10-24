# Web journey acceptance matrix

Scope: connect → browse → details → play → resume, for the Web tracker
[tesserafin#306](https://github.com/tesserafin-project/tesserafin/issues/306). It follows
[dialog-focus-return.md](dialog-focus-return.md), whose last table listed the remaining
browser/theme/screen-reader/responsive gaps.

## How it was run

Real `Tesserafin.Server` (master `4099f4e68d`) booted by the server repo's `ci/serve-e2e.sh`,
serving this branch's `npm run build:production`. Playwright 1.61.1, Chromium 149.0.7827.55,
Linux, one worker. Nothing is mocked in these specs: routing, input, playback and the API are real.

```sh
npm run build:production
# from the server repo
./ci/serve-e2e.sh --webdir <web>/dist --exec 'cd <web> && npx playwright test \
  tests/e2e/b2-axe.spec.ts tests/e2e/b2-keyboard-a11y.spec.ts tests/e2e/b2-responsive.spec.ts \
  tests/e2e/b2-player-surfaces.spec.ts tests/e2e/b2-theme-persistence.spec.ts \
  tests/e2e/b2-resume-journey.spec.ts tests/e2e/home-composition.spec.ts tests/e2e/search.spec.ts'
```

Result on the final tree: 35/35 pass.

## Matrix

Themes: Classic and Frosted Glass in every row. Form factors: desktop 1440×900, mobile 390×844,
TV layout 1920×1080 (the product's `layout=tv` setting, asserted live).

| Journey step | Keyboard / focus | Pointer | TV layout (CSS + arrow keys) | Responsive (3 form factors) | Automated a11y (axe 4.12.1) |
| --- | --- | --- | --- | --- | --- |
| Connect / sign-in | `b2-keyboard-a11y` shell tab order, roles and names | sign-in helper | — | — | onboarding: server-free `m3.axe` (not re-run here) |
| Browse (home, library) | tab order, visible focus; Home composition keyboard/remote + reduced motion | library nav | arrows move focus, Enter activates | no overflow, no unreachable control, no clipped dialog | 0 critical, 0 serious |
| Search | card opened by focus + Enter | — | — | — | 0 critical, 0 serious |
| Details | Item Details More menu focus return (web#223) | — | web#223 TV-layout cases | `b2-responsive` | 0 critical; 1 moderate `region` (see below) |
| Play | Tab focus on a player control is recorded, not asserted; modern track/settings menus: `TrackMenus` suite | play control | `b2-player-surfaces` TV | controls inside the viewport, terminal error dialog fits | 0 critical, 0 serious; 1 moderate `region` |
| Resume | **new** `b2-resume-journey`: Resume focused with visible focus, Enter starts at the stored position | — | Enter under TV layout | all three | covered by detail/player scans |

## Fixed in this slice

- **Pinch-zoom was disabled on every page** (`meta-viewport`, WCAG 1.4.4). `index.html` shipped
  `maximum-scale=1, user-scalable=no`; it now keeps `viewport-fit=cover` and allows zoom. The
  slideshow's `appHost.setUserScalable` toggle, which re-locked zoom after closing a photo, is
  removed with it.
- **Empty `<h3 class="osdTitle">` in the video OSD** (`empty-heading`). It was never written; the
  title goes to the app header through `LibraryMenu.setTitle`. Removed with its style, and with the
  null-item reset that also dereferenced a `.osdMediaInfo` element the template does not have.
- `b2-axe` now fails by rule id if either returns.

## Resume evidence and its limits

`b2-resume-journey` seeds a stored position through the server API, opens the item by keyboard,
focuses Resume, presses Enter, and reads the media element's `currentTime` at its first `playing`
event. It must be ≥ the stored 0.5 s. Control: pointing the same spec at "Play from beginning"
fails with `Received: 0`, so the measurement distinguishes resume from restart.

Not claimed: a position written at stop. The rig's fixtures are 2 s, and the server marks items
under `MinResumeDurationSeconds` (300 s) as played on stop.

## Remaining, not done here

- `region` (moderate): the details route's MUI tooltip portal (`#:r…:`) and the player's
  `.videoPlayerContainer` sit outside landmarks. Changing the player's DOM placement is broader than
  this slice.
- One glass/detail scan out of eleven reported one serious violation; it did not recur in ten
  further scans and its rule id was not captured. Treat as intermittent until seen again.
- Screen readers (NVDA, VoiceOver, TalkBack), touch input, physical TV remotes and real devices:
  none exercised. Accessible names and roles are checked by axe and `b2-keyboard-a11y` only.
- Mobile Safari: zoom now allowed means iOS may zoom into inputs whose font is under 16 px. Not
  observed here (Chromium only).
- Hosted CI does not run these specs; they need `ci/serve-e2e.sh`.
