import type { UseQueryResult } from '@tanstack/react-query';
import React, { type FC, useCallback } from 'react';

import globalize from 'lib/globalize';
import type { ItemDtoQueryResult } from 'types/base/models/item-dto-query-result';
import {
    EmptyState,
    ErrorState,
    LoadingState,
    MediaCard,
    MediaGrid,
    Pagination
} from 'ui';

import type { LibraryViewMode } from '../constants/librarySections';
import type { LibraryDensity } from '../utils/density';
import { classifyLibraryFailure } from '../utils/libraryAccess';
import {
    type ImageApiClient,
    toMediaCardPropsArray
} from '../utils/mediaCardProps';

/**
 * The item grid shared by the Browse and Collections destinations — its own loading/error/empty/
 * success states, each an early return instead of a nested ternary (RFC-0005 §3.3, the same
 * contract `apps/modern/features/home/components/HomeSection.tsx` follows).
 *
 * Extracted from `LibraryView.tsx` by L15b: once Collections became a mounted destination rendering
 * the same `MediaCard`s from the same `getItems` shape, keeping this inline in Browse's file would
 * have meant a second copy of the four-state contract, including the subtle out-of-range-page
 * window documented below.
 */
export interface LibraryItemsGridProps {
    itemsQuery: UseQueryResult<ItemDtoQueryResult | undefined, Error>;
    density: LibraryDensity;
    /**
     * Grid or list (design §4.2). Orthogonal to `density`, which keeps meaning "how tight" inside
     * whichever mode is active — that orthogonality is what yields four combinations rather than
     * three ad-hoc modes.
     */
    viewMode?: LibraryViewMode;
    apiClient: ImageApiClient | undefined;
    /** Accessible name for the grid region. */
    label: string;
    page: number;
    totalPages: number;
    onPreviousPage: () => void;
    onNextPage: () => void;
    emptyMessage?: string;
}

export const LibraryItemsGrid: FC<LibraryItemsGridProps> = ({
    itemsQuery,
    density,
    viewMode = 'grid',
    apiClient,
    label,
    page,
    totalPages,
    onPreviousPage,
    onNextPage,
    emptyMessage
}) => {
    const onRetry = useCallback(() => void itemsQuery.refetch(), [itemsQuery]);
    const pageLabel = useCallback(
        (currentPage: number, pageCount: number) =>
            globalize.translate('PaginationPageLabel', currentPage, pageCount),
        []
    );

    if (itemsQuery.isPending) {
        return <LoadingState variant='grid' />;
    }

    if (itemsQuery.isError) {
        // `GET /Items` is the request that actually distinguishes a forbidden library: Reefin's
        // `ItemsController` answers 401 for `!item.IsVisible(user)`, while the item lookup behind
        // the page shell answers 404 for both "gone" and "forbidden" (see `utils/libraryAccess.ts`).
        // Classifying here is therefore what makes the access-denied state reachable at all — and it
        // suppresses a retry button that could not have helped.
        if (classifyLibraryFailure(itemsQuery.error) === 'access-denied') {
            return (
                <EmptyState
                    title={globalize.translate('HeaderLibraryAccessDenied')}
                    description={globalize.translate(
                        'MessageLibraryAccessDenied'
                    )}
                />
            );
        }

        return (
            <ErrorState
                message={globalize.translate('ErrorDefault')}
                retryLabel={globalize.translate('Retry')}
                onRetry={onRetry}
            />
        );
    }

    // Bridges the two windows an out-of-range `page` (e.g. `?page=999`) opens up around the
    // `useCanonicalPage` correction: (1) `page > totalPages` right after `TotalRecordCount` lands
    // but before the `replace` navigation to the clamped page has fired, and (2) once that
    // navigation lands, `page` is back in range but `keepPreviousData` is still showing the
    // previous, empty, out-of-range response (`isPlaceholderData` with 0 items) while the corrected
    // page's fetch is in flight. Without both, this window renders a misleading "no items" for a
    // library that isn't actually empty.
    const isCorrectingOutOfRangePage =
        page > totalPages ||
        (itemsQuery.isPlaceholderData && !itemsQuery.data?.Items?.length);
    if (isCorrectingOutOfRangePage) {
        return <LoadingState variant='grid' />;
    }

    if (!itemsQuery.data?.Items?.length) {
        return (
            <EmptyState
                title={
                    emptyMessage ??
                    globalize.translate('MessageNoItemsAvailable')
                }
            />
        );
    }

    return (
        <>
            <MediaGrid
                density={density}
                aria-label={label}
                className={
                    viewMode === 'list'
                        ? 'rf-library-view__grid--list'
                        : undefined
                }
                // In list mode one item per row is the point, so the grid's auto-fill minimum is
                // widened past any realistic container width rather than the layout being swapped
                // for a different component: same cards, same DOM, one column.
                minItemWidth={viewMode === 'list' ? '100%' : undefined}
            >
                {toMediaCardPropsArray(itemsQuery.data.Items, apiClient).map(
                    (cardProps) => (
                        <MediaCard key={cardProps.href} {...cardProps} />
                    )
                )}
            </MediaGrid>

            {totalPages > 1 && (
                <Pagination
                    className='rf-library-view__pagination'
                    page={page}
                    totalPages={totalPages}
                    previousLabel={globalize.translate('Previous')}
                    nextLabel={globalize.translate('Next')}
                    pageLabel={pageLabel}
                    aria-label={globalize.translate('Pagination')}
                    onPreviousPage={onPreviousPage}
                    onNextPage={onNextPage}
                />
            )}
        </>
    );
};

export default LibraryItemsGrid;
