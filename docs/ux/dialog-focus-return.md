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
and animation completion. These are jsdom behavioral checks, not physical remote,
screen-reader or theme-browser acceptance.

| Surface / input | Evidence for this slice | Still to verify |
| --- | --- | --- |
| Legacy dialog, desktop keyboard | Back callback and opener focus in jsdom | Browser Escape with the real keyboard dispatcher; Classic/Frosted |
| Nested legacy dialogs | Child returns to parent control, parent to page | Browser animation and stacked-dialog journey |
| Removed/disabled opener | No detached focus attempt; disabled control stays unfocused | Browser inert/hidden control behavior |
| Action moving focus elsewhere | Existing destination remains focused | Real action opening a new dialog/navigation |
| Modern player menu | Existing `TrackMenus` regression suite | Existing browser matrix remains separate |
| Search horizontal return | Existing #199 implementation/acceptance | No new acceptance claimed by this slice |

Responsive layout, screen readers, touch and physical TV input retain their own
acceptance needs. This bounded fix does not close the wider #306 tracker.
