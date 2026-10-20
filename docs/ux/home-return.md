# Returning to modern Home

The modern Home route used to remount its shelves at their first card. `Page` / `libraryMenu`
resets the vertical page position on mount, and neither Home nor MediaShelf recorded a return
anchor. Search already has its own position restoration; this change leaves that path alone.

A foreground activation of a Home/Favorites shelf card now records the page offset, every rendered
row's signed horizontal offset, the section id, href and card index before navigation. These card
links use the router, giving the destination a proper history key instead of a native hash entry
that can look like a POP. Modified, download and new-tab activations keep their native behavior.

Recovery applies only on POP to the same history entry, server, user and tab. It waits for Home
queries to settle and the mount-time page reset to finish, restores scroll with no animation, and
focuses the original href in its original section with `preventScroll`. A missing item falls back
at the old index (clamped to the surviving list); a missing section uses the nearby surviving
section. With no cards left, the selected tab receives focus. A replacement outside the viewport
is revealed with nearest scrolling. Stable section ids do not depend on translations or recipe
order.

Each return is consumed once. A later server refresh must not replay old scroll/focus. Pointer,
keyboard, wheel or touch activity while waiting cancels recovery. A visible focused control
outside Home also keeps ownership. The bounded memory holds at most 20 entries in this running
page; it is not persisted to storage and a reload starts fresh. No new API request, theme rule,
content ranking or dependency is introduced.

## Verification

- `npm test -- src/apps/modern/features/home src/ui/components/MediaShelf`
  includes the real Home route with stubbed API responses and browser geometry: both axes,
  duplicate cards across rows, data arriving after Back, missing item, user cancellation,
  fresh navigation, server/user isolation, and refetch ownership. Utility controls cover
  section removal/reordering, empty fallback, cache bound, tab/history identity and signed RTL.
- `npm run build:production && npx playwright test --config playwright.itemDetails.config.ts home.return.browser.spec.ts`
  runs the actual bundle and Item Details route with a deterministic same-origin API. It covers
  Classic/Frosted at desktop and phone sizes, keyboard activation, real touch activation, and
  removal followed by the actual query client's stale refetch. It asserts real geometry and focus;
  jsdom's scroll stubs are not browser evidence. The dedicated read-only Actions workflow runs it
  for relevant source changes, preserving existing bundle/delivery budgets. Its path-filtered
  context is advisory, not a proposed globally required check.

## Scope and remaining evidence

This fixes modern Home (desktop/mobile) and its Favorites tab. The `tv`, `desktop-legacy` and
`mobile-legacy` preferences select a different legacy Home controller; its lifecycle is unchanged
and this suite must not be presented as validating that TV route or a physical remote. Reload
persistence, Search, library pages, player menus and screen-reader/device qualification remain
separate work. The implementation PR records the hosted browser results and any outstanding limits.

Related: tesserafin-project/tesserafin#306; player menu focus is Web #213.
