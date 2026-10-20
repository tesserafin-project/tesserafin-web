# Visible and reversible library filters

Modern Library Browse already stores its filters in the URL, but a closed filter drawer hid them
and a successful empty response used the same generic message with or without active predicates.

The summary now sits outside the inline/drawer controls. It represents the existing effective
predicates: genre, nonzero year, initial (including the `#` bucket), Favorites and each distinct
studio id. Sort/order, page, density, grid/list and Series/Episodes depth are not counted as filters.
Studio names reuse the existing facet response; an unavailable name has a removable numbered
"Selected studio" label instead of an opaque identifier. Summary rendering issues no API request.

Removing a predicate preserves all others; a studio action removes only that id (including duplicate
occurrences). Reset filters clears those five predicate fields. Both actions return to page 1 while
preserving sort/order, display preferences, depth and unrelated query params. They use the route's
existing replace-navigation semantics. Focus moves to the next surviving filter, the last remaining
filter, or the visible filter-controls entry when none remains, so keyboard users are not dropped
onto the document after a button disappears.

A genuinely successful filtered empty response says that no items match these filters and offers
Reset filters. An unfiltered empty response keeps the existing generic empty state: no extra fetch
is made to claim whether the whole library is empty. Pending, out-of-range/placeholder loading,
access-denied and transport-error states keep their existing behavior. Collections and other
library destinations do not receive Browse's filtered-empty action.

## Verification

- `npm test -- src/apps/modern/features/library`: URL contract tests, real Browse/summary/grid
  components with stubbed hooks, both shipped presentation recipes, focus recovery, multiple or
  unavailable studios, URL preservation and error/loading boundaries. A deliberately hidden summary
  fails the visible-filter regressions. Geometry is not qualified by jsdom.
- `npm run build:production && npx playwright test --config playwright.itemDetails.config.ts library.filters.browser.spec.ts`:
  actual production route in Chromium, Classic/Frosted × desktop/mobile; keyboard removal, focus,
  both reset entry points, exact outgoing params, closed/reopened drawer, shared URL/reload and
  viewport overflow. The same-origin transport supplies authored result sets, not the server's
  filtering/authorization engine. WebSocket tickets receive an explicit fixture-only 503; live
  socket behavior is outside this suite.
- The relevant-path read-only Actions workflow also checks unchanged delivery/bundle budgets.
  Its path-filtered context is advisory, not a globally required merge context.

English/French copy is included. Other locales use the existing translation fallback. This concerns
the modern desktop/mobile library route; the legacy TV library and physical remote/screen-reader
qualification are separate. No library ranking, access rule, dependency or repository setting changes.
The implementation PR records hosted results and any remaining blocker.

Related: tesserafin-project/tesserafin#306. Independent of Web #218 (Home return) and #213 (player menus).
