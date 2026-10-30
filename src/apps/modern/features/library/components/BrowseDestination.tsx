import {
    BaseItemKind,
    CollectionType,
    ItemSortBy,
    SortOrder
} from 'lib/tesserafin-sdk';
import React, {
    type FC,
    lazy,
    Suspense,
    useCallback,
    useMemo,
    useEffect,
    useState,
    useRef,
    useLayoutEffect
} from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLocalStorage } from 'usehooks-ts';

import { useApi } from 'hooks/useApi';
import { useUserSettings } from 'hooks/useUserSettings';
import globalize from 'lib/globalize';
import {
    FilterDrawer,
    LoadingState,
    SortSelect,
    type SortSelectOption
} from 'ui';

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
import type { ResolvedLibraryRecipe } from '../utils/libraryRecipe';
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

import {
    clearedLibraryFilters,
    getActiveLibraryFilters,
    withoutLibraryFilter,
    type ActiveLibraryFilter
} from '../utils/activeFilters';
import { ActiveLibraryFilters } from './ActiveLibraryFilters';
import LibraryAlphaPicker from './LibraryAlphaPicker';
import LibraryItemsGrid, {
    type LibraryItemsGridProps
} from './LibraryItemsGrid';

// Lazy: only this route's Films grid needs it, and it would otherwise land in the initial bundle.
const ContinuousLibraryGrid = lazy(() => import('./ContinuousLibraryGrid'));

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
    /**
     * The resolved `presentation.page.library` recipe, handed down from `LibraryView`. Semantic
     * values only — this component has no idea which theme produced them, and no way to find out.
     */
    recipe: ResolvedLibraryRecipe;
}

interface PagedBrowseResultsProps
    extends Pick<
        LibraryItemsGridProps,
        | 'density'
        | 'viewMode'
        | 'layout'
        | 'cardAspect'
        | 'apiClient'
        | 'label'
        | 'onResetFilters'
    > {
    params: Omit<LibraryItemsParams, 'startIndex' | 'limit'>;
    page: number;
    pageSize: number;
    isRandom: boolean;
    onPageChange: (page: number) => void;
}

/** Every Browse presentation the continuous grid does not cover yet, and Random, which it never can. */
const PagedBrowseResults: FC<PagedBrowseResultsProps> = ({
    params,
    page,
    pageSize,
    isRandom,
    onPageChange,
    ...gridProps
}) => {
    const itemsQuery = useLibraryItems({
        ...params,
        stableOrder: true,
        startIndex: pageToStartIndex(page, pageSize),
        limit: pageSize
    });
    const totalPages = getTotalPages(
        itemsQuery.data?.TotalRecordCount ?? 0,
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

    // Corrects an out-of-range `page` (e.g. a shared `?page=999` link, or a page that outlived a
    // filter shrinking the result set) once `TotalRecordCount` is known.
    useCanonicalPage(page, totalPages, itemsQuery.isSuccess, onPageChange);

    return (
        <>
            {isRandom && (
                <p className='rf-library-view__order-note'>
                    {globalize.translate('MessageRandomOrderIsPaged')}
                </p>
            )}
            <LibraryItemsGrid
                {...gridProps}
                itemsQuery={itemsQuery}
                page={page}
                totalPages={totalPages}
                onPreviousPage={onPreviousPage}
                onNextPage={onNextPage}
            />
        </>
    );
};

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
    apiClient,
    recipe
}) => {
    const [searchParams, setSearchParams] = useSearchParams();
    const { user } = useApi();
    const { libraryPageSize: pageSize } = useUserSettings();
    const [isFilterDrawerOpen, setFilterDrawerOpen] = useState(false);

    const queryState = useMemo(
        () => parseLibraryQueryState(searchParams),
        [searchParams]
    );

    const activeFilters = useMemo(
        () => getActiveLibraryFilters(queryState),
        [queryState]
    );
    const controls = useRef<HTMLDivElement>(null);
    const filterSummary = useRef<HTMLElement>(null);
    const nextFilterFocus = useRef<number | null>(null);
    useLayoutEffect(() => {
        const index = nextFilterFocus.current;
        if (index === null) return;
        nextFilterFocus.current = null;
        const buttons =
            filterSummary.current?.querySelectorAll<HTMLButtonElement>(
                'button[data-filter-key]'
            );
        const target =
            buttons?.[Math.min(index, buttons.length - 1)] ??
            controls.current?.querySelector<HTMLElement>('select,button');
        target?.focus();
    }, [activeFilters]);

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

    // Random is redrawn by the server on every request, so its pages are not parts of one order.
    // Everything outside the first vertical keeps its pagination: see docs/ux/library-browsing.md.
    const isContinuous =
        !!libraryId &&
        primaryItemType === BaseItemKind.Movie &&
        recipe.layout === 'grid' &&
        viewMode === 'grid' &&
        queryState.sortBy !== ItemSortBy.Random;

    const baseParams = useMemo(
        () => ({
            parentId: libraryId,
            includeItemTypes,
            sortBy: queryState.sortBy,
            sortOrder: queryState.sortOrder,
            genre: queryState.genre,
            year: queryState.year,
            studioIds: queryState.studioIds,
            isFavorite: queryState.favorite,
            letter: queryState.letter
        }),
        [
            libraryId,
            includeItemTypes,
            queryState.sortBy,
            queryState.sortOrder,
            queryState.genre,
            queryState.year,
            queryState.studioIds,
            queryState.favorite,
            queryState.letter
        ]
    );
    const resultSet = JSON.stringify([user?.ServerId, user?.Id, baseParams]);

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

    const onRemoveFilter = useCallback(
        (filter: ActiveLibraryFilter) => {
            nextFilterFocus.current = activeFilters.findIndex(
                (item) => item.id === filter.id
            );
            updateQueryState(withoutLibraryFilter(queryState, filter));
        },
        [activeFilters, queryState, updateQueryState]
    );
    const onResetFilters = useCallback(() => {
        nextFilterFocus.current = 0;
        updateQueryState(clearedLibraryFilters);
    }, [updateQueryState]);

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

    // A `?page=N` link, or a paged view switched to the grid, opens at that page's first item. The
    // URL then drops `page`: from here on it would only describe where the viewer once was.
    const legacyStartIndex = useRef<number>();
    if (isContinuous && queryState.page > FIRST_PAGE) {
        legacyStartIndex.current = pageToStartIndex(queryState.page, pageSize);
    }
    useEffect(() => {
        if (!isContinuous) return;
        legacyStartIndex.current = undefined;
        if (queryState.page > FIRST_PAGE) onPageChange(FIRST_PAGE);
    }, [isContinuous, onPageChange, queryState.page]);

    // A new result set starts at its beginning; the controls above it stay where they were.
    const results = useRef<HTMLDivElement>(null);
    const previousResultSet = useRef(resultSet);
    useLayoutEffect(() => {
        if (previousResultSet.current === resultSet) return;
        previousResultSet.current = resultSet;
        const element = results.current;
        if (!isContinuous || !element) return;
        const top = element.getBoundingClientRect().top + window.scrollY;
        if (window.scrollY > top) {
            window.scrollTo({ top, behavior: 'instant' });
        }
    }, [isContinuous, resultSet]);

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

    /*
     * The filter controls, built ONCE and then PLACED — inline, or inside the drawer. This is the
     * whole of what `filters: 'inline' | 'drawer'` decides.
     *
     * What it deliberately cannot decide: every one of these controls writes to the URL query
     * state, which `useLibraryItems` reads above any recipe. So the catalogue query is identical
     * whichever placement is active, an unmounted drawer keeps the filters it was given applied,
     * and closing the drawer changes nothing about the request. `LibraryView.recipe.test.tsx`
     * asserts each of those separately, because each is a plausible way to get this wrong.
     */
    const filterControls = (
        <>
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
                    queryState.year ? String(queryState.year) : FILTER_ALL_VALUE
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
        </>
    );

    return (
        <>
            <div ref={controls} className='rf-library-view__controls'>
                {recipe.filters === 'drawer' ? (
                    <FilterDrawer
                        triggerLabel={globalize.translate('Filters')}
                        title={globalize.translate('Filters')}
                        closeLabel={globalize.translate('ButtonClose')}
                        open={isFilterDrawerOpen}
                        onOpenChange={setFilterDrawerOpen}
                    >
                        {filterControls}
                    </FilterDrawer>
                ) : (
                    filterControls
                )}

                {/*
                 * The list/grid view mode is USER state, and `layout: 'shelf'` is a theme choice in
                 * which "one item per row" has no meaning. The control is therefore ABSENT under a
                 * shelf rather than shown inert — this route's own precedent, the same way the
                 * granularity control is absent on a movies library. The stored preference is not
                 * written, so a return to `layout: 'grid'` restores the user's choice untouched.
                 */}
                {recipe.layout !== 'shelf' && (
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
                )}
            </div>

            <ActiveLibraryFilters
                filters={activeFilters}
                studios={studiosQuery.data?.Items ?? []}
                elementRef={filterSummary}
                onRemove={onRemoveFilter}
                onReset={onResetFilters}
            />

            <LibraryAlphaPicker
                value={queryState.letter}
                sortBy={queryState.sortBy}
                granularity={granularity}
                onSelect={onLetterSelect}
            />

            <div ref={results} className='rf-library-view__results'>
                {isContinuous ? (
                    <Suspense fallback={<LoadingState variant='grid' />}>
                        <ContinuousLibraryGrid
                            key={resultSet}
                            params={baseParams}
                            context={resultSet}
                            pageSize={pageSize}
                            legacyStartIndex={legacyStartIndex.current}
                            density={density}
                            cardAspect={recipe.cardAspect}
                            apiClient={apiClient}
                            label={libraryName}
                            onResetFilters={
                                activeFilters.length
                                    ? onResetFilters
                                    : undefined
                            }
                        />
                    </Suspense>
                ) : (
                    <PagedBrowseResults
                        params={baseParams}
                        page={queryState.page}
                        pageSize={pageSize}
                        isRandom={queryState.sortBy === ItemSortBy.Random}
                        onPageChange={onPageChange}
                        onResetFilters={
                            activeFilters.length ? onResetFilters : undefined
                        }
                        density={density}
                        viewMode={viewMode}
                        layout={recipe.layout}
                        cardAspect={recipe.cardAspect}
                        apiClient={apiClient}
                        label={libraryName}
                    />
                )}
            </div>
        </>
    );
};

export default BrowseDestination;
