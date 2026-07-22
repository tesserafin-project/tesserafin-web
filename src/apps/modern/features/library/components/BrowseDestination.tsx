import {
    BaseItemKind,
    CollectionType,
    ItemSortBy,
    SortOrder
} from 'lib/tesserafin-sdk';
import React, { type FC, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLocalStorage } from 'usehooks-ts';

import { useUserSettings } from 'hooks/useUserSettings';
import globalize from 'lib/globalize';
import { SortSelect, type SortSelectOption } from 'ui';

import { useLibraryFilters } from '../api/useLibraryFilters';
import { useLibraryStudios } from '../api/useLibraryDestinations';
import {
    type LibraryItemsParams,
    useLibraryItems
} from '../api/useLibraryItems';
import {
    getViewModeStorageKey,
    type LibraryGranularity,
    type LibraryViewMode,
    resolveGranularity,
    resolveViewMode,
    selectLetter,
    toggleViewMode,
    VIEW_MODE_QUERY_PARAM
} from '../constants/librarySections';
import { useCanonicalPage } from '../hooks/useCanonicalPage';
import type { LibraryDensity } from '../utils/density';
import type { ImageApiClient } from '../utils/mediaCardProps';
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

import LibraryAlphaPicker from './LibraryAlphaPicker';
import LibraryItemsGrid from './LibraryItemsGrid';

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

export interface BrowseDestinationProps {
    libraryId: string;
    libraryName: string;
    collectionType: CollectionType | string | null | undefined;
    /** The library's *primary* item kind — `Movie` or `Series`. Episodes swaps it at query time. */
    primaryItemType: BaseItemKind;
    density: LibraryDensity;
    apiClient: ImageApiClient | undefined;
}

/**
 * Browse — the canonical destination, rendered by `/library/:libraryId` itself (design §5: the
 * short URL is canonical, there is no redirect to `/browse`).
 *
 * This is where design §3.2's arbitration is *visible*: Studios, Favorites and Episodes are not
 * tabs, they are controls in this bar. Each one is a parameter of the single `getItems` call
 * `useLibraryItems` already makes — `studioIds`, `isFavorite`, `includeItemTypes` — which is
 * precisely the §3.1 criterion-2 test they failed as destinations. Promoting them would have
 * charged a navigation level for what a control expresses in one click.
 */
export const BrowseDestination: FC<BrowseDestinationProps> = ({
    libraryId,
    libraryName,
    collectionType,
    primaryItemType,
    density,
    apiClient
}) => {
    const [searchParams, setSearchParams] = useSearchParams();
    const { libraryPageSize: pageSize } = useUserSettings();

    const queryState = useMemo(
        () => parseLibraryQueryState(searchParams),
        [searchParams]
    );

    const isTvshows = collectionType === CollectionType.Tvshows;
    const granularity: LibraryGranularity = resolveGranularity(
        queryState.granularity,
        isTvshows
    );

    const [storedViewMode, setStoredViewMode] =
        useLocalStorage<LibraryViewMode>(
            getViewModeStorageKey(libraryId || 'unknown'),
            'grid'
        );
    const viewMode = resolveViewMode(
        searchParams.get(VIEW_MODE_QUERY_PARAM),
        storedViewMode
    );

    // The Series/Episodes granularity toggle is a *depth* change on the same query (design §3.2):
    // same parent, same endpoint, `[Episode]` instead of `[Series]`.
    const includeItemTypes = useMemo(
        () => [
            granularity === 'episodes' ? BaseItemKind.Episode : primaryItemType
        ],
        [granularity, primaryItemType]
    );

    const itemsParams: LibraryItemsParams | undefined = useMemo(() => {
        if (!libraryId) return undefined;

        return {
            parentId: libraryId,
            includeItemTypes,
            sortBy: queryState.sortBy,
            sortOrder: queryState.sortOrder,
            startIndex: pageToStartIndex(queryState.page, pageSize),
            limit: pageSize,
            genre: queryState.genre,
            year: queryState.year,
            studioIds: queryState.studioIds,
            isFavorite: queryState.favorite,
            letter: queryState.letter
        };
    }, [libraryId, includeItemTypes, queryState, pageSize]);

    const itemsQuery = useLibraryItems(itemsParams);
    // The genre/year facets follow the *primary* kind, not the granularity: switching to Episodes
    // must not silently repopulate the genre list from episode metadata mid-session.
    const filtersQuery = useLibraryFilters(libraryId || undefined, [
        primaryItemType
    ]);
    const studiosQuery = useLibraryStudios(
        libraryId
            ? { parentId: libraryId, includeItemTypes: [primaryItemType] }
            : undefined
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
    const onStudioChange = useCallback(
        (value: string) =>
            updateQueryState({
                studioIds: value === FILTER_ALL_VALUE ? undefined : [value],
                page: FIRST_PAGE
            }),
        [updateQueryState]
    );
    const onFavoriteToggle = useCallback(
        () =>
            updateQueryState({
                favorite: queryState.favorite ? undefined : true,
                page: FIRST_PAGE
            }),
        [updateQueryState, queryState.favorite]
    );
    const onGranularityChange = useCallback(
        (value: string) =>
            updateQueryState({
                granularity: value as LibraryGranularity,
                // A depth change invalidates the current page the same way a filter does, and it
                // also invalidates the letter: the AlphaPicker is inert at Episodes granularity.
                letter: undefined,
                page: FIRST_PAGE
            }),
        [updateQueryState]
    );
    // `selectLetter` returns the `{ letter, page }` pair together, so a caller cannot apply the
    // letter and forget to reset the page (design §4.1).
    const onLetterSelect = useCallback(
        (letter: string) =>
            updateQueryState(selectLetter(queryState.letter, letter)),
        [updateQueryState, queryState.letter]
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
    // filter shrinking the result set) once `TotalRecordCount` is known.
    useCanonicalPage(
        queryState.page,
        totalPages,
        itemsQuery.isSuccess,
        onPageChange
    );

    const onToggleViewMode = useCallback(() => {
        const next = toggleViewMode(viewMode);
        setStoredViewMode(next);
        const nextParams = new URLSearchParams(searchParams);
        nextParams.set(VIEW_MODE_QUERY_PARAM, next);
        setSearchParams(nextParams, { replace: true });
    }, [viewMode, searchParams, setStoredViewMode, setSearchParams]);

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

    const studioOptions: SortSelectOption[] = useMemo(
        () => [
            { value: FILTER_ALL_VALUE, label: globalize.translate('All') },
            ...(studiosQuery.data?.Items ?? [])
                .filter((studio) => !!studio.Id)
                .map((studio) => ({
                    value: String(studio.Id),
                    label: studio.Name ?? String(studio.Id)
                }))
        ],
        [studiosQuery.data?.Items]
    );

    const granularityOptions: SortSelectOption[] = useMemo(
        () => [
            { value: 'primary', label: globalize.translate('Series') },
            { value: 'episodes', label: globalize.translate('Episodes') }
        ],
        []
    );

    return (
        <>
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
                {/* Studios: a filter, not a destination (design §3.2). */}
                <SortSelect
                    label={globalize.translate('LabelStudio')}
                    options={studioOptions}
                    value={queryState.studioIds?.[0] ?? FILTER_ALL_VALUE}
                    onChange={onStudioChange}
                    disabled={studiosQuery.isPending}
                />
                {/*
                 * Granularity exists only for tvshows: a movies library has no depth below `Movie`,
                 * so the control is *absent* there rather than disabled (`resolveGranularity`).
                 */}
                {isTvshows && (
                    <SortSelect
                        label={globalize.translate('LabelGranularity')}
                        options={granularityOptions}
                        value={granularity}
                        onChange={onGranularityChange}
                    />
                )}
                {/* Favorites: a pure predicate (`isFavorite: true`), so a toggle, not a tab. */}
                <button
                    type='button'
                    className='rf-library-view__density-toggle'
                    aria-pressed={!!queryState.favorite}
                    onClick={onFavoriteToggle}
                >
                    {globalize.translate('Favorites')}
                </button>
                <button
                    type='button'
                    className='rf-library-view__density-toggle'
                    aria-pressed={viewMode === 'list'}
                    aria-label={globalize.translate('LabelViewMode')}
                    onClick={onToggleViewMode}
                >
                    {viewMode === 'list'
                        ? globalize.translate('List')
                        : globalize.translate('Grid')}
                </button>
            </div>

            <LibraryAlphaPicker
                value={queryState.letter}
                sortBy={queryState.sortBy}
                granularity={granularity}
                onSelect={onLetterSelect}
            />

            <LibraryItemsGrid
                itemsQuery={itemsQuery}
                density={density}
                viewMode={viewMode}
                apiClient={apiClient}
                label={libraryName}
                page={queryState.page}
                totalPages={totalPages}
                onPreviousPage={onPreviousPage}
                onNextPage={onNextPage}
            />
        </>
    );
};

export default BrowseDestination;
