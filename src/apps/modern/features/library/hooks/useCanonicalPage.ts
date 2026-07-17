import { useEffect } from 'react';

import { clampPage } from '../utils/pagination';

/**
 * Corrects an out-of-range `page` (e.g. `?page=999` on a library with fewer pages, or a page that
 * outlived a shrinking result set) once the real `totalPages` is known - `isReady` should reflect
 * that (`itemsQuery.isSuccess`), not just "some data exists", since `keepPreviousData` can otherwise
 * make a stale `totalPages` look ready before the current params' response has landed.
 *
 * `onCanonicalize` fires with the clamped page exactly once per out-of-range value, not on every
 * render: it's a no-op once the caller's `page` prop reflects the clamped value (e.g. after a
 * `replace` navigation lands and this hook re-runs with matching `page`/`totalPages`), so wiring it
 * to a URL update (`setSearchParams(..., { replace: true })`) can't loop.
 */
export const useCanonicalPage = (
    page: number,
    totalPages: number,
    isReady: boolean,
    onCanonicalize: (page: number) => void
): void => {
    useEffect(() => {
        if (!isReady) return;

        const clamped = clampPage(page, totalPages);
        if (clamped !== page) {
            onCanonicalize(clamped);
        }
    }, [page, totalPages, isReady, onCanonicalize]);
};
