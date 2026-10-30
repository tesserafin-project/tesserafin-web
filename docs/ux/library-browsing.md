# Library browsing (LIBRARY-BROWSE-R1, R2)

Parent: tesserafin-project/tesserafin#306, "incremental library browsing without page controls".

## What is continuous, and what is not

Browse on `/library/:libraryId` is continuous when **all** of these hold (`BrowseDestination.tsx`):

| Condition | Otherwise |
| --- | --- |
| Recipe `layout` is `grid` | `shelf`: paged, unchanged |
| Films in a grid or a list; Series or Episodes in a grid | Series or Episodes in a list: paged, unchanged |
| Sort is not `Random` | Random: paged, with a visible note |

Collections, Genres and Suggestions do not use this grid and are unchanged. Shelf and the TV shell are
the next slice. Series and Episodes lists are not demonstrated, so they stay paged.

A theme's recipe still cannot change the catalogue request: the first request is the same under
`grid` and `shelf` (`LibraryView.recipe.test.tsx`).

## How it stays bounded

The grid's height stands for the whole result set (`TotalRecordCount`). An item's place is
arithmetic on its server index, so nothing before a position has to be fetched to reach it.

- Mounted: the viewport's rows plus 2 rows each side, plus the focused row if scrolled away.
- Requested: the pages touching the viewport's rows plus 4 rows each side, 24 to 100 items each
  (`libraryPageSize` is clamped, and its "no limit" value 0 becomes 100).
- A page leaving that range has its request aborted.
- Cache: a page nobody observes leaves after 5 minutes (against 24 hours for other queries), and at
  most 12 such pages are kept across all result sets (`libraryPageRetention.ts`). A time alone is not a
  bound: a fast scroll would otherwise hold every page it passed. Both apply to the IndexedDB copy too.
  At most, that is 12 idle pages of 100 items plus the pages in view. Thirty jumps across 12,000 films
  peaked at 14 pages in the query cache, including the observed ones.

Each page is its own query, keyed by every filter. Identical requests therefore share one fetch, and
a late response can only land on the filters it was requested for.

## Order

The server ends every deterministic order on the item's Id, ascending whatever the direction of the
requested sort (tesserafin `fix/library-pagination-total-order`, `ApplyOrder`). So on a library that
does not change, one sequence exists and any page size reads it. `Random` is deliberately left out: it is
redrawn per request, and is never continuous here.

- Browse still sends `SortName`, `ProductionYear` and `DateCreated` as tie-breakers, for servers without
  the final key.
- A repeated row keeps its server index: the card shows at its first place, the later slot stays empty,
  and every later item keeps its place. The grid exposes `data-rf-repeated-rows` and
  `data-rf-short-pages`, and the proofs assert both are 0, so client de-duplication cannot hide an
  omission.

### Additions and removals while browsing

A total order is not a snapshot. Each page is a separate request on the library as it is then. A row
added or removed before a position shifts everything after it, so between two requests a row can be seen
twice or not at all. That is not a server defect and needs a snapshot or a cursor to remove, which neither
side offers. The client detects a repeat (above); it cannot detect a row it never received.

### What was measured

Three levels, which prove different things:

| Level | Data | Proves | Does not prove |
| --- | --- | --- | --- |
| SQLite relational tests (server repo) | 230 to 2,000 rows, heavily tied, NULLs | The sequence against Ids computed from the rows; the `ORDER BY` itself ends on Id | The HTTP or browser path |
| Browser, simulated transport (`tests/itemDetailsBrowser`) | 3,000 to 12,000 synthetic items | Windowing, focus, errors, returns, cache | Anything about the server's order |
| Browser, real server (`tests/e2e/library-continuous.spec.ts`, `scripts/library-browse-real-server.py`) | 402 films, 150 series, 450 episodes, on SQLite | The real sequence through the production bundle | Scale, or other databases |

On current master, SQLite happens to return tied rows of grouped queries (Films, Series, Episodes) in Id
order: rows are reached through `Id IN (...)`, and the sorter keeps that order. The R1 finding that tied
rows changed order between page sizes did **not** reproduce: without the key, the R1 script and the new
expected-sequence script both found no moved row. So for these queries the key turns an accident of the
query plan into a guarantee. It changes visible results on ungrouped queries, which scan: only those fail
the relational sequence test without the key, and `PRAGMA reverse_unordered_selects` is what exposes it.

Reproduce (from the server worktree, with this repository's production build in `dist/`):

```bash
ci/serve-e2e.sh --webdir ../tesserafin-web/dist --exec \
  "python3 ../tesserafin-web/scripts/library-browse-real-server.py 400 150 && \
   cd ../tesserafin-web && npx playwright test tests/e2e/library-continuous.spec.ts --workers=1"
```

## Return from an item

Clicking a card remembers its index, href, viewport offset and row height under the server, user,
library, filters, sort and history entry. Back to that entry requests only the pages at that depth,
scrolls, then focuses the card. If the viewer acts first (pointer, key, wheel, touch), restoration is
dropped.

If the item is gone, the outcome does not depend on what was cached:

- Removed or moved out of reach: the item now at that index, or the last item if the library shrank,
  takes the focus, and a status message says so. This also covers a card vanishing when a cached page
  refreshes after the return.
- Library refused: the refusal replaces the results, including anything cached, and the return ends.
- Nothing left: the empty state, and the return ends.

None of these retries by itself or keeps waiting for the target.

Positions are in memory, at most 20, and any other account clears them all, including a return in
progress: the grid is keyed by user, so it remounts and reads nothing of the previous one. Query data
is keyed by user. Reloading the page loses the position, as on Home.

## Old `?page=N` links

They open at that page's first item, computed with the viewer's `libraryPageSize`, and past the end
at the last item, including when the grid is already mounted: the view moves first, then `page` is
removed from the URL with a `replace`. Switching list view to the grid from a later
page follows the same rule. Paged presentations keep `?page=` as before.

## Moving at depth

A resize, or a list and grid switch, keeps the same item in view. The item is read before the new
geometry commits, because a shorter document clamps the scroll position as it lays out. A page size set
in the settings changes the requests only; positions are server indexes, so a return still lands.

A list is the same cards in one column, with the poster at the side: at full width it stood taller than
the viewport. The paged list gets this too.

## Keyboard

Cards keep their natural tab order. Tab crosses page boundaries because neighbours are mounted before
they are reached. After scrolling away, the focused row stays mounted, and the next key brings it back
before acting, as a fully rendered list would. An unanswered page shows a "Load more" button in its
first slot, reachable by Tab, whose focus passes to the first card it brings in.

## Known limits

- Accessibility is checked by automation only: roles, focus order, the status message, Tab across
  boundaries. **No human has tested this with a screen reader**, and none is claimed. A screen reader is
  not told the position in the set (`MediaGrid` is a plain `role=group`).
- No touch, physical remote, TV layout, Firefox or Safari pass.
- The account change is tested at the store and the grid's key, not through a real sign-out in a browser.
- Evidence at 12,000 items uses simulated transport. The real server ran with 402 films, on SQLite, on a
  library that did not change during the reads.
- `SeriesDatePlayed` on the server ignores any other requested criterion and its own priority, as it
  always has. Browse does not offer this sort.
- Sorting by `DatePlayed` is slow without any relation to this work: about 35 s per page at 10,000 rows.
  Browse does not offer it either.
- Browser scroll position is lost on reload.
