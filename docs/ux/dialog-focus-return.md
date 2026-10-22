# Dialog focus return and journey residuals

Scope: legacy `dialogHelper` dismissal. This follows the Web journey tracker
[tesserafin#306](https://github.com/tesserafin-project/tesserafin/issues/306).

## Reconciliation against the current Web source

- Search page **and per-row horizontal** return positions are already implemented
  by merged Web #199; they are not an outstanding implementation request.
- Modern player track/settings menus already return focus on Escape, including
  nested submenus (`TrackMenus.test.tsx`). This change does not replace them.
- Legacy dialogs, still used for grouped search actions and other item menus,
  saved their opener but returned focus only in the TV layout. Desktop keyboard
  dismissal could therefore remove the focused element and leave focus on body.

## Selected behavior

After the close animation and focus-scope pop, return focus to the saved opener
on every layout if it remains connected and focus is still inside the closing
dialog or on body. Preserve an intentional focus destination outside the closing
dialog (for example, an action opening a new dialog). Let the browser's native
focus rules reject disabled, hidden or inert controls. Do not choose a substitute
control when the opener has been removed.

## Evidence and remaining acceptance

The DOM regression suite exercises desktop/TV Back dismissal, nested dialogs,
a removed opener, a disabled opener, a deliberately focused external destination,
and animation completion. These are jsdom behavioral checks; the browser layers below exercise real input,
DOM focus and animations separately. No physical remote or screen-reader acceptance
is claimed.

| Surface / input | Evidence for this slice | Still to verify |
| --- | --- | --- |
| Legacy dialog, desktop/mobile/TV layout | Unmodified production Item Details More menu: keyboard Escape and browser Back, Classic and Frosted Glass | Physical remotes, touch, assistive technology |
| Nested legacy dialogs | Real-module browser fixture: child returns to parent control, then page after real animation | Additional application-specific nested journeys |
| Removed/disabled/inert/hidden opener | Real-module browser fixture: dismissal leaves body focused, then Tab reaches next available control | Screen-reader navigation |
| Action moving focus elsewhere | Real-module closing action deliberately moves focus; destination remains focused | Other application navigation transitions |
| Modern player menu | Existing `TrackMenus` regression suite | Existing browser matrix remains separate |
| Search horizontal return | Existing #199 implementation/acceptance | No new acceptance claimed by this slice |

Responsive layout, screen readers, touch and physical TV input retain their own
acceptance needs. This bounded fix does not close the wider #306 tracker.

## Reproduce the browser layers

```sh
npm run build:production
npm run verify:bundle-budget
npm run verify:delivery-budget
npx webpack --config webpack.dialogFocus.js
npx playwright install chromium
npx playwright test --config playwright.dialogFocus.config.ts
```

The full-application layer has six cases (two official themes × desktop, mobile
and TV layouts), each exercising Escape and browser Back against the production
Item Details More menu. Only the same-origin server API is a declared fixture;
routing, input, history and the production bundle are real.

The separate production-mode component bundle has 36 cases over the same
theme/layout matrix. It retains the real dialog helper, browser detection, focus
manager, scroll manager, keyboard dispatcher and input manager. Application router,
playback/platform and settings adapters are substituted; these cases are component
evidence, not an end-to-end claim about a household server. Test hooks exist only
in the separate fixture and never enter the shipped application graph.

Local execution used Chromium Headless Shell 134.0.6998.35 on Linux with an explicit
`DIALOG_FOCUS_CHROMIUM` executable override, because the repository-pinned browser
CDN returned invalid archives. The dedicated CI workflow uses the repository-pinned
Playwright browser and reports its own result. A TV CSS layout in a browser is not
a physical TV/DPAD test, and this fixture does not certify screen-reader semantics
or the whole responsive/theme acceptance matrix.
