import React, { type FC, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useUserSettings } from 'hooks/useUserSettings';
import globalize from 'lib/globalize';

import { useLibraryCollections } from '../api/useLibraryDestinations';
import { useCanonicalPage } from '../hooks/useCanonicalPage';
import type { LibraryDensity } from '../utils/density';
import type { ResolvedLibraryRecipe } from '../utils/libraryRecipe';
import type { ImageApiClient } from '../utils/mediaCardProps';
import {
    clampPage,
    getTotalPages,
    pageToStartIndex
} from '../utils/pagination';
import {
    parseLibraryQueryState,
    withLibraryQueryState
} from '../utils/queryParams';

import LibraryItemsGrid from './LibraryItemsGrid';

export interface CollectionsDestinationProps {
    libraryId: string;
    density: LibraryDensity;
    apiClient: ImageApiClient | undefined;
    /**
     * The resolved `presentation.page.library` recipe. Collections composes an item list through
     * the same `LibraryItemsGrid`, so it honours `layout` and `cardAspect` exactly as Browse does —
     * one page, one recipe.
     */
    recipe: ResolvedLibraryRecipe;
}

/**
 * Collections — a destination because `BoxSet` is an item of another **nature** than
 * `Movie`/`Series` (design §3.1 criterion 1). It is the case that shows criterion 1 doing real work
 * on its own: the endpoint is the very same `getItems` Browse calls, so criterion 2 alone would
 * have demoted it to a filter. What makes it a destination is that the *objects listed are not the
 * same kind of thing*.
 *
 * It reuses `LibraryItemsGrid` — same four states, same pagination, same cards — because a
 * collection grid genuinely is a grid of items. Only the query differs.
 */
export const CollectionsDestination: FC<CollectionsDestinationProps> = ({
    libraryId,
    density,
    apiClient,
    recipe
}) => {
    const [searchParams, setSearchParams] = useSearchParams();
    const { libraryPageSize: pageSize } = useUserSettings();

    const page = useMemo(
        () => parseLibraryQueryState(searchParams).page,
        [searchParams]
    );

    const collectionsQuery = useLibraryCollections(
        libraryId
            ? {
                  parentId: libraryId,
                  startIndex: pageToStartIndex(page, pageSize),
                  limit: pageSize
              }
            : undefined
    );

    const onPageChange = useCallback(
        (nextPage: number) =>
            setSearchParams(
                withLibraryQueryState(searchParams, { page: nextPage }),
                { replace: true }
            ),
        [searchParams, setSearchParams]
    );

    const totalPages = getTotalPages(
        collectionsQuery.data?.TotalRecordCount ?? 0,
        pageSize
    );

    const onPreviousPage = useCallback(
        () => onPageChange(clampPage(page - 1, totalPages)),
        [onPageChange, page, totalPages]
    );
    const onNextPage = useCallback(
        () => onPageChange(clampPage(page + 1, totalPages)),
        [onPageChange, page, totalPages]
    );

    useCanonicalPage(
        page,
        totalPages,
        collectionsQuery.isSuccess,
        onPageChange
    );

    return (
        <LibraryItemsGrid
            itemsQuery={collectionsQuery}
            density={density}
            layout={recipe.layout}
            cardAspect={recipe.cardAspect}
            apiClient={apiClient}
            label={globalize.translate('Collections')}
            page={page}
            totalPages={totalPages}
            onPreviousPage={onPreviousPage}
            onNextPage={onNextPage}
            emptyMessage={globalize.translate('MessageNoCollectionsAvailable')}
        />
    );
};

export default CollectionsDestination;
