# Library browsing (LIBRARY-BROWSE-R1)

Parent: tesserafin-project/tesserafin#306, "incremental library browsing without page controls".

## What is continuous, and what is not

Browse on `/library/:libraryId` is continuous when **all** of these hold (`BrowseDestination.tsx`):

| Condition | Otherwise |
| --- | --- |
| Library's primary kind is `Movie` | TV libraries, Series and Episodes: paged, unchanged |
| Recipe `layout` is `grid` | `shelf`: paged, unchanged |
| View mode is `grid` | List view: paged, unchanged |
| Sort is not `Random` | Random: paged, with a visible note |

Collections, Genres and Suggestions do not use this grid and are unchanged. The other Browse
presentations are expected to work the same way, but have not been demonstrated, so they stay paged.

A theme's recipe still cannot change the catalogue request: the first request is the same under
`grid` and `shelf` (`LibraryView.recipe.test.tsx`).

## How it stays bounded

The grid's height stands for the whole result set (`TotalRecordCount`). An item's place is
arithmetic on its server index, so nothing before a position has to be fetched to reach it.

- Mounted: the viewport's rows plus 2 rows each side, plus the focused row if scrolled away.
- Requested: the pages touching the viewport's rows plus 4 rows each side, 24 to 100 items each
  (`libraryPageSize` is clamped, and its "no limit" value 0 becomes 100).
- A page leaving that range has its request aborted. It leaves the cache 5 minutes after, against
  24 hours for other queries, which also bounds what is persisted to IndexedDB.

Each page is its own query, keyed by every filter. Identical requests therefore share one fetch, and
a late response can only land on the filters it was requested for.

## Order

The server's `ApplyOrder` has no unique final key, and `Random` is unseeded and redrawn per request
(`Tesserafin.Server.Implementations/Item/`). So:

- Browse sends `SortName`, `ProductionYear` and `DateCreated` as tie-breakers after the chosen sort.
  They narrow ties. They cannot remove them, because the API offers no sort by id.
- Duplicates across a page boundary are dropped client-side; the slot stays empty so later items keep
  their place. An item skipped by a tie that moved between two requests would not be detected.
- `Random` is never continuous.

Measured on a real server (`scripts/library-browse-real-server.py`, static library of 230 films on
SQLite, 200 tied on year and 30 on title too). Reading every page at limits 24, 37 and 100, for
`ProductionYear`, `CommunityRating`, `DateCreated` and `SortName`, with and without tie-breakers:
no duplicate and no missing item. Tied items did not keep the order of one unpaged query, so an order
holds only for a given page size. Two `Random` pages of 100 shared 43 items, and the same page drawn
twice differed.

## Return from a film

Clicking a card remembers its index, href and viewport offset under the server, user, library,
filters, sort and history entry. Back to that entry requests only the pages at that depth, scrolls,
then focuses the card. If the viewer acts first (pointer, key, wheel, touch), restoration is dropped.

Positions are in memory, at most 20, and any other account clears them all. Query data is keyed by
user. Reloading the page loses the position, as on Home.

## Old `?page=N` links

They open at that page's first item, computed with the viewer's `libraryPageSize`, and past the end
at the last item. `page` is then removed from the URL with a `replace`. Switching list view to the grid from a later
page follows the same rule. Paged presentations keep `?page=` as before.

## Keyboard

Cards keep their natural tab order. Tab crosses page boundaries because neighbours are mounted before
they are reached. After scrolling away, the focused row stays mounted, and the next key brings it back
before acting, as a fully rendered list would. An unanswered page shows a "Load more" button in its
first slot, reachable by Tab, whose focus passes to the first card it brings in.

## Known limits

- No screen reader, touch, physical remote, TV layout, Firefox or Safari pass. A screen reader is not
  told the position in the set (`MediaGrid` is a plain `role=group`).
- Evidence at 12,000 items is a fixture honouring `StartIndex`/`Limit`. The real server was exercised
  with 230 films, on SQLite, with a library that did not change during the reads.
- Browser scroll position is lost on reload.
- Items added or removed while browsing can shift later items by a few places.
