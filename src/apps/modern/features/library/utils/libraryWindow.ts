/**
 * Pure geometry for the continuous Browse grid. An item's place is arithmetic on its server index,
 * so any depth can be reached by requesting only the pages it touches, never the ones before it.
 */

export interface LibraryGeometry {
    columns: number;
    /** Height of one card row. On a shelf, where each card is a row, its width. */
    rowHeight: number;
    /** Vertical gap between two rows. */
    rowGap: number;
}

/** Inclusive. */
export interface RowRange {
    first: number;
    last: number;
}

/** Rows mounted beyond the viewport on each side, so Tab always has a neighbour to land on. */
export const OVERSCAN_ROWS = 2;
/** Rows whose page is requested beyond the viewport on each side. */
export const PRELOAD_ROWS = 4;
/** A shelf shows fewer cards at once than a grid's rows hold, and each one is a "row" here. */
export const SHELF_OVERSCAN_CARDS = 4;
export const SHELF_PRELOAD_CARDS = 12;
/** Before the grid can be measured nothing beyond this is mounted. */
export const UNMEASURED_CARDS = 24;

const MIN_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 100;

/** The display setting can be 0 ("no limit") or arbitrarily large; neither may reach the request. */
export const continuousPageSize = (pageSize: number): number =>
    pageSize > 0
        ? Math.min(Math.max(pageSize, MIN_PAGE_SIZE), MAX_PAGE_SIZE)
        : MAX_PAGE_SIZE;

export const rowPitch = (geometry: LibraryGeometry): number =>
    geometry.rowHeight + geometry.rowGap;

export const rowCount = (total: number, columns: number): number =>
    Math.ceil(total / columns);

/** The rows touched by a viewport `offset` pixels below the top of the grid. */
export const rowsInView = (
    offset: number,
    viewport: number,
    geometry: LibraryGeometry,
    total: number
): RowRange => {
    const pitch = rowPitch(geometry);
    const lastRow = Math.max(0, rowCount(total, geometry.columns) - 1);
    const first = Math.min(lastRow, Math.floor(Math.max(0, offset) / pitch));
    const last = Math.min(
        lastRow,
        Math.floor(Math.max(0, offset + viewport) / pitch)
    );
    return { first, last };
};

export const expandRows = (
    range: RowRange,
    by: number,
    total: number,
    columns: number
): RowRange => ({
    first: Math.max(0, range.first - by),
    last: Math.min(Math.max(0, rowCount(total, columns) - 1), range.last + by)
});

/** Start indexes of the pages touching `[firstIndex, lastIndex]`, within the result set. */
export const pageStarts = (
    firstIndex: number,
    lastIndex: number,
    pageSize: number
): number[] => {
    const starts: number[] = [];
    const first = Math.floor(Math.max(0, firstIndex) / pageSize) * pageSize;
    for (let start = first; start <= lastIndex; start += pageSize) {
        starts.push(start);
    }
    return starts;
};

/**
 * The row ranges to mount, in document order: the window, plus the focused row when the viewer has
 * scrolled away from it — unmounting a focused element would drop focus to `<body>`.
 */
export const mountedSegments = (
    window: RowRange,
    pinnedRow: number | undefined
): RowRange[] => {
    if (
        pinnedRow === undefined ||
        (pinnedRow >= window.first - 1 && pinnedRow <= window.last + 1)
    ) {
        return [
            {
                first: Math.min(window.first, pinnedRow ?? window.first),
                last: Math.max(window.last, pinnedRow ?? window.last)
            }
        ];
    }
    const pinned = { first: pinnedRow, last: pinnedRow };
    return pinnedRow < window.first ? [pinned, window] : [window, pinned];
};
