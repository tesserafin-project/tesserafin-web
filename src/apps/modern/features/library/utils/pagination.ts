/**
 * `StartIndex`/page-number conversions for the `/library/:libraryId` route (RFC-0005 §11 WP-C).
 * `@jellyfin/sdk`'s `getItems` is `StartIndex`/`Limit`-based (0-indexed offset); `ui`'s `Pagination`
 * is 1-indexed page-based (RFC-0005 §6). Kept as pure functions so the offset math is unit-testable
 * without mounting the view.
 */

/** The first page a user can be on. */
export const FIRST_PAGE = 1;

/** Converts a 1-indexed page number to the `StartIndex` offset `getItems` expects. */
export const pageToStartIndex = (page: number, pageSize: number): number => {
    const safePage =
        Number.isFinite(page) && page > FIRST_PAGE ? page : FIRST_PAGE;
    const safePageSize =
        Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 0;

    return (safePage - FIRST_PAGE) * safePageSize;
};

/** Converts a `StartIndex` offset back to a 1-indexed page number, e.g. to seed the URL from a reload. */
export const startIndexToPage = (
    startIndex: number,
    pageSize: number
): number => {
    if (!Number.isFinite(startIndex) || startIndex <= 0) return FIRST_PAGE;
    if (!Number.isFinite(pageSize) || pageSize <= 0) return FIRST_PAGE;

    return Math.floor(startIndex / pageSize) + FIRST_PAGE;
};

/** Total page count for a given record count and page size; always at least one page. */
export const getTotalPages = (
    totalRecordCount: number,
    pageSize: number
): number => {
    if (!Number.isFinite(totalRecordCount) || totalRecordCount <= 0) {
        return FIRST_PAGE;
    }
    if (!Number.isFinite(pageSize) || pageSize <= 0) {
        return FIRST_PAGE;
    }

    return Math.max(FIRST_PAGE, Math.ceil(totalRecordCount / pageSize));
};

/** Clamps a page number to `[1, totalPages]`, e.g. after a filter shrinks the result set. */
export const clampPage = (page: number, totalPages: number): number => {
    const safeTotalPages =
        Number.isFinite(totalPages) && totalPages > 0 ? totalPages : FIRST_PAGE;
    if (!Number.isFinite(page)) return FIRST_PAGE;

    return Math.min(Math.max(page, FIRST_PAGE), safeTotalPages);
};
