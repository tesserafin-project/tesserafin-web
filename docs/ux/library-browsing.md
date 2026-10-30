# Library browsing (LIBRARY-BROWSE-R1, R2, R3)

Parent: tesserafin-project/tesserafin#306, "incremental library browsing without page controls".

## What is continuous, and what is not

Browse on `/library/:libraryId` is continuous when **all** of these hold (`BrowseDestination.tsx`):

| Condition | Otherwise |
| --- | --- |
| Films in a grid, a list or a shelf; Series or Episodes in a grid or a shelf | Series or Episodes in a list: paged, unchanged |
| Sort is not `Random` | Random: paged, with a visible note, under either layout |

Collections, Genres and Suggestions do not use this component and are unchanged, and neither are the
shelves of Home: `MediaShelf` only gained an optional role and an item class. The TV shell is the next
slice: it still routes through the legacy pages. Series and Episodes lists are not demonstrated, so they
stay paged.

A theme's recipe still cannot change the catalogue request: the first request is the same under
`grid` and `shelf` (`LibraryView.recipe.test.tsx`).

## How it stays bounded

The grid's height stands for the whole result set (`TotalRecordCount`). An item's place is
arithmetic on its server index, so nothing before a position has to be fetched to reach it.

- Mounted: the viewport's rows plus 2 rows each side, plus the focused row if scrolled away. On a shelf,
  the visible cards plus 4 each side, plus the focused card.
- Requested: the pages touching the viewport's rows plus 4 rows each side (a shelf: 12 cards each side),
  24 to 100 items each (`libraryPageSize` is clamped, and its "no limit" value 0 becomes 100).
- A page leaving that range has its request aborted.
- Cache: a page nobody observes leaves after 5 minutes (against 24 hours for other queries), and at
  most 12 such pages are kept across all result sets (`libraryPageRetention.ts`). A time alone is not a
  bound: a fast scroll would otherwise hold every page it passed. Both apply to the IndexedDB copy too.
  At most, that is 12 idle pages of 100 items plus the pages in view. Thirty jumps across 12,000 films
  peaked at 14 pages in the query cache, including the observed ones.

Each page is its own query, keyed by every filter. Identical requests therefore share one fetch, and
a late response can only land on the filters it was requested for.

## The shelf

A `layout: 'shelf'` recipe composes the same component on its side (`ContinuousLibraryGrid`, `layout`
prop): every card is a "row" of one, and the scroller stands in for the window. So the shelf has the
page-keeping, the cache bounds, the returns and the refusals of the grid, not a second copy of them.

- The width stands for the whole result set: spacers before and after the mounted cards, so
  `scrollWidth` is exactly `total x (card + gap) - gap`. At 12,000 cards of 276 px that is 3.3 million
  px. Browsers cap an element's size at some tens of millions of px, so a much larger library would hit
  that cap; none has been tested near it.
- Scroll snapping is off on this shelf, and so is scroll anchoring: snapping re-snaps each time cards
  mount and would undo a restored offset. The shelves of Home keep their snap.
- A change of density re-measures, and the same card stays at the same place. A resize too.
- Right to left, `scrollLeft` runs negative; position and offset are read from the start edge.
- A filter or a new sort remounts it at its beginning, and the page's vertical position stays.

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

Clicking a card remembers its index, href, viewport offset and row height (a shelf: its offset from the
scroller's start edge and its top in the viewport) under the server, user, library, layout, filters, sort
and history entry. Back to that entry requests only the pages at that depth,
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
is keyed by user, and signing out clears the query cache. Reloading the page loses the position, as on
Home.

## Changing account

`tests/itemDetailsBrowser/library.account.browser.spec.ts` (grid and shelf, **fixture**, token-keyed): A
goes deep, opens a fiche and returns; a page of A is held on the wire; A signs out through the toolbar's
menu; B signs in through the login form, with different rights and at the same URL; A's held answer is
then delivered. B sees only B: no card, total, position, focus or `no longer here`; going Back onto A's
history entry shows nothing of A; a library only A may see shows no card; the persisted IndexedDB cache
holds B's data and none of A's. Control: with both the `queryClient.clear()` and the user in the query
key removed, both tests go red on A's first card.

`tests/e2e/library-continuous.spec.ts`, "two accounts in one library" (grid and shelf, **real server**, the
rig's admin then its restricted user): one film in seven is tagged through the real item API and withheld
through the server's `BlockedTags` policy, so 57 of 402 films in a library both accounts share belong to
the admin alone. The admin opens one of them at depth and returns, and a real page of theirs is delayed
through the sign-out. The second account then walks the whole result set: its 345 cards equal, in order,
what the server grants it, and none is withheld. No position or focus returns; history and the persisted
cache hold no withheld item, and the API refuses that item by id. The older "real sign-out, real sign-in"
test stays: it covers a whole library withheld, not films inside a shared one.

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
first slot, reachable by Tab, whose focus passes to the card that takes its slot. A failed page scrolled
to its middle shows it in its first mounted slot as well.

Arrow keys are not handled here, on either presentation: they remain the browser's. On a shelf, a focused
card's arrow scrolls the scroller and focus stays on the card (tested). Nothing
listens to keys globally to move focus, and nothing traps Tab: Shift+Tab from the first card leaves the
list. Tested at the boundary of a page, both ways, and after scrolling away.

## Semantics

The results are `role=list`, and each answered or actionable slot is a `role=listitem` carrying
`aria-posinset` and `aria-setsize` (the known `TotalRecordCount`). Those attributes are not allowed on a
link or a `group`, which is why the card sits inside an item; the surface does not become a `grid`, because
it has no two-dimensional keyboard model. Spacers, the row gap and empty slots are `aria-hidden`.

Announcements: one `role=status` line for the whole result set. A failed page writes one message there
however many pages failed, and the per-page `role=alert` is gone. The return's message goes through it too.
Nothing announces loading or each page arriving.

Checked by automation only (Chromium's accessibility tree, axe `AXE_VERSION` on the list scope, no serious
or critical violation). This shows that the structure is valid. It does not show how a screen reader reads
a set of 12,000 with few items present: **no human has run one**, on the shelf or anywhere else in this
work, and none is claimed.

## Known limits

- Accessibility is checked by automation only: roles, positions, focus order, the status message, Tab
  across boundaries. **No human has tested this with a screen reader**, and none is claimed.
- No touch on a real device, physical remote, TV layout, Firefox or Safari pass. Touch is emulated in
  Chromium, from raw touch points.
- Evidence at 12,000 items uses simulated transport. The real server ran with 402 films, 150 series and
  450 episodes, on SQLite, on a library that did not change during the reads.
- No scroll snapping on the Browse shelf, kept on purpose: emulated swipes and a fling move it, bring in the
  next pages and stop where the finger left it, which can be mid-card (132 px past a card's edge in the
  measured run). Whether that feels right needs a real device.
- `SeriesDatePlayed` on the server ignores any other requested criterion and its own priority, as it
  always has. Browse does not offer this sort.
- Sorting by `DatePlayed` is slow without any relation to this work: about 35 s per page at 10,000 rows.
  Browse does not offer it either.
- Browser scroll position is lost on reload.

## R3 evidence

Executable code tested: web `f20cc452ba` (stacked on #244 `2345a56c42`, on #243 `122c9f4645`), against a server
built from #375 `75bd7e7f88`. The commit after it adds only this text.

```bash
npm run build:production
npx playwright test --config playwright.itemDetails.config.ts   # 159 passed, one worker, fixture
npx vitest run                                                  # 3754 passed, 1 skipped
node scripts/verify-delivery-budget.mjs; node scripts/verify-bundle-budget.mjs   # PASS, no ceiling raised
# real server, 402 films, 150 series, 450 episodes: 11 passed, script 48 cases, 0 failures
ci/serve-e2e.sh --webdir <dist> --exec "python3 <web>/scripts/library-browse-real-server.py 400 150 && \
  cd <web> && npx playwright test tests/e2e/library-continuous.spec.ts --workers=1"
```

Shelf on 12,000 simulated items (`test-results/library-browse/shelf.json`), the table showing Films. Requests
are cumulative over the walk; cached pages are the count at that moment; pages hold 100. Series and Episodes,
at the same total, stay within the same maxima (15 cards, 6 requests, 6 pages). These four depths evict
nothing; thirty jumps along the shelf peaked at 14 cached pages.

| Depth | Desktop, Classic: cards / requests / pages | Desktop, Frosted | Mobile, Classic | Mobile, Frosted |
| --- | --- | --- | --- | --- |
| 0 | 10 / 1 / 1 | 10 / 1 / 1 | 6 / 1 / 1 | 6 / 1 / 1 |
| 2,000 | 14 / 3 / 3 | 14 / 3 / 3 | 10 / 3 / 3 | 10 / 3 / 3 |
| 5,207 | 15 / 5 / 5 | 14 / 5 / 5 | 10 / 5 / 5 | 10 / 5 / 5 |
| 11,999 | 10 / 6 / 6 | 10 / 6 / 6 | 6 / 6 / 6 | 6 / 6 / 6 |

Real server, shelf: every item in the server's order, once each, read by moving the scroller across every
page boundary (Films and Episodes 5 pages, Series 2), at most 14 cards mounted, no repeated row or short
page, then a fiche at 60% and Back to the same card, offset and focus.

Controls, each on a deliberately broken build, each red for its own reason:

| Broken | Red |
| --- | --- |
| Query key without the user, and no `queryClient.clear()` | Both account tests: A's card shown to B |
| Overscan 30 cards | Shelf: 36 cards mounted |
| Saved offset always 0 | Shelf: Back lands 37 px away |
| No retry in a failed page's first mounted slot | Failed-page test: no action reachable |
| Fixture without the ticket request | 6 Item Details tests on `ledger.undeclared` |
| No vertical restore | Shelf: Back lands 40 px away |
| Real server, `BlockedTags` off | Two accounts: the server grants a withheld film |
| Real server, user out of the query key, no `queryClient.clear()` | Two accounts: the second sees the first's total |

That last control gave 6 red, not the 7 reported earlier. A seventh, "selecting an alternate version issues
no request", failed in one full run on the declared ticket request, which the client retries on its own
timer. It now leaves out that one request, and still fails on any other.

The server's nuance stands: the explicit Id guarantees the order; on the grouped queries tested, no movement
without that key has been reproduced. `DatePlayed` and `SeriesDatePlayed` remain separate server follow-ups.

Not shown: a human screen-reader pass; touch on a real device or a physical remote; Firefox or Safari; a TV
layout; 12,000 items on a real server; a library changing during a shelf walk on a real server.

Hosted: server #375 out of draft, all gates green on `75bd7e7f88`. Web: a temporary PR to `main`, #246, ran the
full set on `ca8c197f0d`, 33 success, 3 skipped, no failure, and was closed. This text came after that run.
