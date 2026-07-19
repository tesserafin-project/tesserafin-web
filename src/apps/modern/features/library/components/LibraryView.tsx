import {
    BaseItemKind,
    CollectionType,
    ItemSortBy,
    SortOrder
} from 'lib/reefin-sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import React, { type FC, useCallback, useMemo } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useLocalStorage } from 'usehooks-ts';

import Page from 'components/Page';
import { useApi } from 'hooks/useApi';
import { useUserSettings } from 'hooks/useUserSettings';
import globalize from 'lib/globalize';
import type { ItemDtoQueryResult } from 'types/base/models/item-dto-query-result';
import {
    EmptyState,
    ErrorState,
    LoadingState,
    MediaCard,
    MediaGrid,
    Pagination,
    SortSelect,
    type SortSelectOption
} from 'ui';

import { useLibraryFilters } from '../api/useLibraryFilters';
import { useLibraryInfo } from '../api/useLibraryInfo';
import {
    type LibraryItemsParams,
    useLibraryItems
} from '../api/useLibraryItems';
import { useCanonicalPage } from '../hooks/useCanonicalPage';
import {
    DEFAULT_DENSITY,
    DENSITY_QUERY_PARAM,
    getDensityStorageKey,
    resolveLibraryDensity,
    toggleLibraryDensity,
    type LibraryDensity
} from '../utils/density';
import {
    getLibraryRedirectPath,
    isSupportedLibraryCollectionType
} from '../utils/libraryRedirect';
import {
    type ImageApiClient,
    toMediaCardPropsArray
} from '../utils/mediaCardProps';
import {
    clampPage,
    FIRST_PAGE,
    getTotalPages,
    pageToStartIndex
} from '../utils/pagination';
import {
    FILTER_ALL_VALUE,
    type LibraryQueryState,
    parseLibraryQueryState,
    withLibraryQueryState
} from '../utils/queryParams';

import './LibraryView.scss';

const SORT_OPTIONS: SortSelectOption[] = [
    { value: ItemSortBy.SortName, label: globalize.translate('Name') },
    {
        value: ItemSortBy.DateCreated,
        label: globalize.translate('OptionDateAdded')
    },
    {
        value: ItemSortBy.CommunityRating,
        label: globalize.translate('OptionCommunityRating')
    },
    {
        value: ItemSortBy.ProductionYear,
        label: globalize.translate('OptionReleaseDate')
    },
    { value: ItemSortBy.Random, label: globalize.translate('OptionRandom') }
];

const ORDER_OPTIONS: SortSelectOption[] = [
    { value: SortOrder.Ascending, label: globalize.translate('Ascending') },
    { value: SortOrder.Descending, label: globalize.translate('Descending') }
];

/** `Movie`/`Series` per v1's two supported collection types (mission scope). */
const getIncludeItemTypes = (
    collectionType: CollectionType | string | null | undefined
): BaseItemKind[] =>
    collectionType === CollectionType.Tvshows
        ? [BaseItemKind.Series]
        : [BaseItemKind.Movie];

interface LibraryItemsGridProps {
    itemsQuery: UseQueryResult<ItemDtoQueryResult | undefined, Error>;
    density: LibraryDensity;
    apiClient: ImageApiClient | undefined;
    libraryName: string;
    page: number;
    totalPages: number;
    onPreviousPage: () => void;
    onNextPage: () => void;
}

/**
 * The grid's own loading/error/empty/success states, split out of `LibraryView` so each is an early
 * return instead of a nested ternary (RFC-0005 §3.3 - every section decides these four states
 * explicitly, same contract `apps/modern/features/home/components/HomeSection.tsx` follows).
 */
const LibraryItemsGrid: FC<LibraryItemsGridProps> = ({
    itemsQuery,
    density,
    apiClient,
    libraryName,
    page,
    totalPages,
    onPreviousPage,
    onNextPage
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
        return (
            <ErrorState
                message={globalize.translate('ErrorDefault')}
                retryLabel={globalize.translate('Retry')}
                onRetry={onRetry}
            />
        );
    }

    // Bridges the two windows an out-of-range `page` (e.g. `?page=999`) opens up around the
    // `useCanonicalPage` correction (in `LibraryView`): (1) `page > totalPages` right after
    // `TotalRecordCount` lands but before the `replace` navigation to the clamped page has fired, and
    // (2) once that navigation lands, `page` is back in range but `keepPreviousData` is still showing
    // the previous, empty, out-of-range response (`isPlaceholderData` with 0 items) while the
    // corrected page's fetch is in flight. Without both, this window renders a misleading "no items"
    // for a library that isn't actually empty.
    const isCorrectingOutOfRangePage =
        page > totalPages ||
        (itemsQuery.isPlaceholderData && !itemsQuery.data?.Items?.length);
    if (isCorrectingOutOfRangePage) {
        return <LoadingState variant='grid' />;
    }

    if (!itemsQuery.data?.Items?.length) {
        return (
            <EmptyState
                title={globalize.translate('MessageNoItemsAvailable')}
            />
        );
    }

    return (
        <>
            <MediaGrid density={density} aria-label={libraryName}>
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

/**
 * `/library/:libraryId` (RFC-0005 §11 WP-C) - the additive, `src/ui`-only movies/tvshows library
 * route. Existing per-type pages (`#/movies?topParentId=...`, `#/tv?topParentId=...`, etc., built by
 * `components/router/appRouter.js`'s `getRouteUrl()`) are untouched: this route lives alongside them
 * and isn't linked to from anywhere yet (`appRouter.getRouteUrl()` is not modified by this work) -
 * see the parity note below for why activation stays deferred.
 *
 * v1 scope (mission): grid + sort (name/date added/community rating/release year/random, asc/desc)
 * + single genre/year filter + pagination + comfortable/compact density, movies and tvshows only.
 * Everything else (AlphaPicker, list view, Suggestions/Genres/other tabs, multi-select filters)
 * redirects to or is deferred to the existing per-type page - see `utils/libraryRedirect.ts` and the
 * per-file JSDoc under `utils/` for the specifics of what's covered vs documented debt.
 *
 * ## AlphaPicker / list view / tabs: porting deferred, because activation is deferred (issue #15)
 *
 * Measured against the pages this route would replace, rather than assumed:
 *
 * - `constants/views/movies.ts`'s tab 0 (`moviesTabContent`) and `constants/views/tvshows.ts`'s
 *   tab 0 (`seriesTabContent`) override neither `isAlphabetPickerEnabled` nor
 *   `isBtnGridListEnabled`, so `utils/viewContent.ts`'s `{...defaultViewContent, ...viewContent}`
 *   merge resolves both to `constants/views/defaults.ts`'s `true`. **AlphaPicker and list view are
 *   live on exactly the two tabs this route would take over.**
 * - Those pages carry 7 (movies) and 8 (tvshows) tabs; this route is a single grid.
 *
 * `appRouter.getRouteUrl()` is the one URL builder behind home cards, `MainDrawerContent`, and
 * `UserViewNav`/`UserViewsMenu` alike, so repointing its `CollectionType.Movies`/`Tvshows` branches
 * (currently `#/movies?topParentId=...`/`#/tv?topParentId=...`) would move every entry point onto a
 * route that lacks AlphaPicker, list view, and 6-7 tabs. Adding the old-URL redirects on top would
 * make the tabbed pages unreachable outright. Either step is a functional regression on the default
 * path, so **activation is not performed** and porting is deferred with it - there is no user-facing
 * gap to close while nothing routes here by default. The route stays additive and reachable by
 * direct URL; nothing is removed from the current default path, which is what keeps this deferral
 * (unlike activation) regression-free.
 *
 * The `main.jellyfin.bundle.js` budget (`webpack.performance-budget.json`, 460800 bytes) is *not*
 * what defers this: measured on this branch, it currently has ample headroom. The blocker is the
 * tab/AlphaPicker/list-view gap above, which is a functional-regression argument and stands on
 * its own.
 *
 * TODO(RFC-0005 §11 WP-C follow-up): this route needs parity with the legacy per-type pages
 * (Suggestions/Genres/Studios/Collections/Playlists tabs, AlphaPicker, list view, multi-select
 * filters) *before* `appRouter.getRouteUrl()` may point here and before the old library URLs may
 * redirect here. Until then, prefer an opt-in affordance over a `getRouteUrl` repoint - the repoint
 * has no non-regressive form while the tab gap stands. Retiring this comment also retires the
 * `LIBRARY_ROUTE_BY_COLLECTION_TYPE` duplication this route (and `/home`'s card adapter) routes
 * around.
 */
const LibraryView: FC = () => {
    const { libraryId = '' } = useParams<{ libraryId: string }>();
    const [searchParams, setSearchParams] = useSearchParams();
    const { __legacyApiClient__ } = useApi();
    const { libraryPageSize: pageSize } = useUserSettings();

    const infoQuery = useLibraryInfo(libraryId);
    const collectionType = infoQuery.data?.CollectionType;
    const libraryName = infoQuery.data?.Name ?? '';

    const includeItemTypes = useMemo(
        () => getIncludeItemTypes(collectionType),
        [collectionType]
    );

    const queryState = useMemo(
        () => parseLibraryQueryState(searchParams),
        [searchParams]
    );

    const [storedDensity, setStoredDensity] = useLocalStorage<LibraryDensity>(
        getDensityStorageKey(libraryId || 'unknown'),
        DEFAULT_DENSITY
    );
    const density = resolveLibraryDensity(
        searchParams.get(DENSITY_QUERY_PARAM),
        storedDensity
    );

    const isSupported = isSupportedLibraryCollectionType(collectionType);

    const itemsParams: LibraryItemsParams | undefined = useMemo(() => {
        if (!libraryId || !isSupported) return undefined;

        return {
            parentId: libraryId,
            includeItemTypes,
            sortBy: queryState.sortBy,
            sortOrder: queryState.sortOrder,
            startIndex: pageToStartIndex(queryState.page, pageSize),
            limit: pageSize,
            genre: queryState.genre,
            year: queryState.year
        };
    }, [libraryId, isSupported, includeItemTypes, queryState, pageSize]);

    const itemsQuery = useLibraryItems(itemsParams);
    const filtersQuery = useLibraryFilters(
        isSupported ? libraryId : undefined,
        includeItemTypes
    );

    const updateQueryState = useCallback(
        (partial: Partial<LibraryQueryState>) => {
            setSearchParams(withLibraryQueryState(searchParams, partial), {
                replace: true
            });
        },
        [searchParams, setSearchParams]
    );

    const onSortByChange = useCallback(
        (value: string) =>
            updateQueryState({ sortBy: value as ItemSortBy, page: FIRST_PAGE }),
        [updateQueryState]
    );
    const onSortOrderChange = useCallback(
        (value: string) =>
            updateQueryState({
                sortOrder: value as SortOrder,
                page: FIRST_PAGE
            }),
        [updateQueryState]
    );
    const onGenreChange = useCallback(
        (value: string) =>
            updateQueryState({
                genre: value === FILTER_ALL_VALUE ? undefined : value,
                page: FIRST_PAGE
            }),
        [updateQueryState]
    );
    const onYearChange = useCallback(
        (value: string) =>
            updateQueryState({
                year: value === FILTER_ALL_VALUE ? undefined : Number(value),
                page: FIRST_PAGE
            }),
        [updateQueryState]
    );
    const onPageChange = useCallback(
        (page: number) => updateQueryState({ page }),
        [updateQueryState]
    );
    const totalPages = getTotalPages(
        itemsQuery.data?.TotalRecordCount ?? 0,
        pageSize
    );
    const onPreviousPage = useCallback(
        () => onPageChange(clampPage(queryState.page - 1, totalPages)),
        [onPageChange, queryState.page, totalPages]
    );
    const onNextPage = useCallback(
        () => onPageChange(clampPage(queryState.page + 1, totalPages)),
        [onPageChange, queryState.page, totalPages]
    );

    // Corrects an out-of-range `page` (e.g. a shared `?page=999` link, or a page that outlived a
    // filter/deletion shrinking the result set) once `TotalRecordCount` is known: clamps down to
    // `totalPages` and canonicalizes the URL via the same `replace` navigation `updateQueryState`
    // already uses elsewhere, so the correction doesn't add a history entry.
    useCanonicalPage(
        queryState.page,
        totalPages,
        itemsQuery.isSuccess,
        onPageChange
    );

    const onInfoRetry = useCallback(
        () => void infoQuery.refetch(),
        [infoQuery]
    );

    const onToggleDensity = useCallback(() => {
        const next = toggleLibraryDensity(density);
        setStoredDensity(next);
        const nextParams = new URLSearchParams(searchParams);
        nextParams.set(DENSITY_QUERY_PARAM, next);
        setSearchParams(nextParams, { replace: true });
    }, [density, searchParams, setStoredDensity, setSearchParams]);

    const genreOptions: SortSelectOption[] = useMemo(
        () => [
            { value: FILTER_ALL_VALUE, label: globalize.translate('All') },
            ...(filtersQuery.data?.Genres ?? []).map((genre) => ({
                value: genre,
                label: genre
            }))
        ],
        [filtersQuery.data?.Genres]
    );

    const yearOptions: SortSelectOption[] = useMemo(
        () => [
            { value: FILTER_ALL_VALUE, label: globalize.translate('All') },
            ...[...(filtersQuery.data?.Years ?? [])]
                .sort((a, b) => b - a)
                .map((year) => ({ value: String(year), label: String(year) }))
        ],
        [filtersQuery.data?.Years]
    );

    // Gate the "unsupported type -> redirect" branch on `infoQuery` having actually resolved:
    // `collectionType` is `undefined` while it's pending, and `undefined` is not a v1-supported
    // type, so deciding this before `infoQuery` settles would redirect every library away during
    // its first render.
    if (infoQuery.isPending) {
        return (
            <Page id='libraryPage' className='mainAnimatedPage libraryPage'>
                <div className='rf-library-view'>
                    <LoadingState variant='block' />
                </div>
            </Page>
        );
    }

    if (infoQuery.isError) {
        return (
            <Page id='libraryPage' className='mainAnimatedPage libraryPage'>
                <div className='rf-library-view'>
                    <ErrorState
                        message={globalize.translate('ErrorDefault')}
                        retryLabel={globalize.translate('Retry')}
                        onRetry={onInfoRetry}
                    />
                </div>
            </Page>
        );
    }

    if (!isSupported) {
        return (
            <Navigate
                replace
                to={getLibraryRedirectPath(libraryId, collectionType)}
            />
        );
    }

    return (
        <Page
            id='libraryPage'
            className='mainAnimatedPage libraryPage'
            title={libraryName}
            backDropType={includeItemTypes}
        >
            <div className='rf-library-view'>
                <h1 className='rf-library-view__title'>{libraryName}</h1>

                <div className='rf-library-view__controls'>
                    <SortSelect
                        label={globalize.translate('Sort')}
                        options={SORT_OPTIONS}
                        value={queryState.sortBy}
                        onChange={onSortByChange}
                    />
                    <SortSelect
                        label={globalize.translate('LabelSortOrder')}
                        options={ORDER_OPTIONS}
                        value={queryState.sortOrder}
                        onChange={onSortOrderChange}
                        disabled={queryState.sortBy === ItemSortBy.Random}
                    />
                    <SortSelect
                        label={globalize.translate('Genre')}
                        options={genreOptions}
                        value={queryState.genre ?? FILTER_ALL_VALUE}
                        onChange={onGenreChange}
                        disabled={filtersQuery.isPending}
                    />
                    <SortSelect
                        label={globalize.translate('LabelYear')}
                        options={yearOptions}
                        value={
                            queryState.year
                                ? String(queryState.year)
                                : FILTER_ALL_VALUE
                        }
                        onChange={onYearChange}
                        disabled={filtersQuery.isPending}
                    />
                    <button
                        type='button'
                        className='rf-library-view__density-toggle'
                        aria-pressed={density === 'compact'}
                        aria-label={globalize.translate('Density')}
                        onClick={onToggleDensity}
                    >
                        {density === 'compact'
                            ? globalize.translate('Compact')
                            : globalize.translate('Comfortable')}
                    </button>
                </div>

                <LibraryItemsGrid
                    itemsQuery={itemsQuery}
                    density={density}
                    apiClient={__legacyApiClient__}
                    libraryName={libraryName}
                    page={queryState.page}
                    totalPages={totalPages}
                    onPreviousPage={onPreviousPage}
                    onNextPage={onNextPage}
                />
            </div>
        </Page>
    );
};

export default LibraryView;
