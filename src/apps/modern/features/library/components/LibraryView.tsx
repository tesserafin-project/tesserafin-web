import { BaseItemKind, CollectionType } from 'lib/reefin-sdk';
import React, { type FC, useCallback, useMemo } from 'react';
import {
    Navigate,
    useNavigate,
    useParams,
    useSearchParams
} from 'react-router-dom';
import { useLocalStorage } from 'usehooks-ts';

import Page from 'components/Page';
import { useApi } from 'hooks/useApi';
import globalize from 'lib/globalize';
import {
    EmptyState,
    ErrorState,
    LoadingState,
    Tabs,
    type TabItem
} from 'ui';

import { useLibraryInfo } from '../api/useLibraryInfo';
import {
    DEFAULT_DESTINATION,
    isLibraryDestination,
    LIBRARY_DESTINATIONS,
    type LibraryDestination,
    resolveDestination
} from '../constants/librarySections';
import {
    DEFAULT_DENSITY,
    DENSITY_QUERY_PARAM,
    getDensityStorageKey,
    resolveLibraryDensity,
    toggleLibraryDensity,
    type LibraryDensity
} from '../utils/density';
import {
    classifyLibraryFailure,
    isRetryableLibraryFailure
} from '../utils/libraryAccess';
import {
    getLibraryRedirectPath,
    isSupportedLibraryCollectionType
} from '../utils/libraryRedirect';

import BrowseDestination from './BrowseDestination';
import CollectionsDestination from './CollectionsDestination';
import GenresDestination from './GenresDestination';
import SuggestionsDestination from './SuggestionsDestination';

import './LibraryView.scss';

/** `Movie`/`Series` per v1's two supported collection types. */
const getPrimaryItemType = (
    collectionType: CollectionType | string | null | undefined
): BaseItemKind =>
    collectionType === CollectionType.Tvshows
        ? BaseItemKind.Series
        : BaseItemKind.Movie;

const DESTINATION_LABEL_KEY: Record<LibraryDestination, string> = {
    browse: 'Browse',
    genres: 'Genres',
    collections: 'Collections',
    suggestions: 'Suggestions'
};

/**
 * `/library/:libraryId` and `/library/:libraryId/:destination` — the four-destination library route
 * (issue #15; `docs/reefin/design-library-navigation.md`), **activated** by L15b.
 *
 * ## What activation means here
 *
 * L15a delivered the model as tested vocabulary and queries and routed none of it. L15b mounts the
 * four destinations, wires the Browse controls, and repoints `appRouter.getRouteUrl()`'s
 * `CollectionType.Movies`/`Tvshows` branches at this route — **in that order**. The order is the
 * whole point: `getRouteUrl()` is the single URL builder behind home cards, `MainDrawerContent` and
 * `UserViewNav` alike, so repointing it before the destinations existed would have moved every
 * entry point onto a route that could not render what they asked for.
 *
 * ## Four destinations, not seven or eight tabs
 *
 * Design §3.2 gives each of the 15 legacy tab entries a fate, and it is deliberately not a
 * one-for-one port. Studios and Favorites are **filters** on Browse (`studioIds`, `isFavorite` —
 * parameters of the query this route already issues), Episodes is a **granularity** on the same
 * query, Upcoming is a **shelf** of Suggestions, and Playlists is **out of library scope** (a
 * playlist crosses libraries). That leaves Browse, Genres, Collections, Suggestions.
 *
 * ## URL shape
 *
 * Browse is the default destination and renders at the short `/library/:libraryId` — the short URL
 * is canonical (design §5), so `/library/:libraryId/browse` and any unknown segment redirect to it
 * (query string preserved) rather than rendering a second URL for one page. Every other destination
 * is a real route segment, so it is shareable, reloadable, and the browser's back button behaves.
 *
 * ## Redirects out, and why there is no loop
 *
 * A library this route does not render (music, books, …) leaves via `getLibraryRedirectPath`. That
 * cannot bounce: the set it redirects *out* and the set `getRouteUrl` redirects *in* are disjoint
 * by construction — `getRouteUrl` only points Movies/Tvshows here, and those are exactly the two
 * types `isSupportedLibraryCollectionType` accepts. `libraryRedirect.test.ts` asserts that
 * disjointness over every `CollectionType` rather than leaving it to inspection.
 */
const LibraryView: FC = () => {
    const { libraryId = '', destination: destinationParam } = useParams<{
        libraryId: string;
        destination?: string;
    }>();
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const { __legacyApiClient__ } = useApi();

    const infoQuery = useLibraryInfo(libraryId);
    const collectionType = infoQuery.data?.CollectionType;
    const libraryName = infoQuery.data?.Name ?? '';

    const destination = resolveDestination(destinationParam);
    const primaryItemType = getPrimaryItemType(collectionType);

    const [storedDensity, setStoredDensity] = useLocalStorage<LibraryDensity>(
        getDensityStorageKey(libraryId || 'unknown'),
        DEFAULT_DENSITY
    );
    const density = resolveLibraryDensity(
        searchParams.get(DENSITY_QUERY_PARAM),
        storedDensity
    );

    const isSupported = isSupportedLibraryCollectionType(collectionType);

    const onToggleDensity = useCallback(() => {
        const next = toggleLibraryDensity(density);
        setStoredDensity(next);
        const nextParams = new URLSearchParams(searchParams);
        nextParams.set(DENSITY_QUERY_PARAM, next);
        setSearchParams(nextParams, { replace: true });
    }, [density, searchParams, setStoredDensity, setSearchParams]);

    const onInfoRetry = useCallback(
        () => void infoQuery.refetch(),
        [infoQuery]
    );

    const tabs: TabItem[] = useMemo(
        () =>
            LIBRARY_DESTINATIONS.map((value) => ({
                id: `library-destination-${value}`,
                label: globalize.translate(DESTINATION_LABEL_KEY[value])
            })),
        []
    );

    const activeTabIndex = LIBRARY_DESTINATIONS.indexOf(destination);

    /**
     * Switching destination is a real navigation (a history entry), not a `replace`: the back
     * button returning you to the previous destination is exactly what design §5 asks for by making
     * the destination a route segment. The query string is intentionally *dropped* — a `letter` or
     * `studio` from Browse means nothing on Genres, and carrying it would leave the URL claiming
     * filters the page does not apply.
     */
    const onTabChange = useCallback(
        (index: number) => {
            const next = LIBRARY_DESTINATIONS[index];
            if (!next || next === destination) return;

            navigate(
                next === DEFAULT_DESTINATION
                    ? `/library/${libraryId}`
                    : `/library/${libraryId}/${next}`
            );
        },
        [navigate, libraryId, destination]
    );

    // Canonicalize the URL before anything else: `/library/:id/browse` and `/library/:id/<unknown>`
    // both name the default destination, whose canonical URL is the short one. One-way by
    // construction — the short URL has no `:destination` param, so it can never re-enter here.
    if (destinationParam && !isLibraryDestination(destinationParam)) {
        const search = searchParams.toString();
        return (
            <Navigate
                replace
                to={`/library/${libraryId}${search ? `?${search}` : ''}`}
            />
        );
    }
    if (destinationParam === DEFAULT_DESTINATION) {
        const search = searchParams.toString();
        return (
            <Navigate
                replace
                to={`/library/${libraryId}${search ? `?${search}` : ''}`}
            />
        );
    }

    if (infoQuery.isPending) {
        return (
            <Page id='libraryPage' className='mainAnimatedPage libraryPage'>
                <div className='rf-library-view'>
                    <LoadingState variant='block' />
                </div>
            </Page>
        );
    }

    // A stale bookmark (library deleted) and a shared link to a library the user cannot see are
    // different failures with different honest answers, and neither is retryable. Activation is
    // what makes this matter: before it, nothing linked here.
    if (infoQuery.isError) {
        const failure = classifyLibraryFailure(infoQuery.error);

        return (
            <Page id='libraryPage' className='mainAnimatedPage libraryPage'>
                <div className='rf-library-view'>
                    {failure === 'not-found' && (
                        <EmptyState
                            title={globalize.translate(
                                'HeaderLibraryNotFound'
                            )}
                            description={globalize.translate(
                                'MessageLibraryNotFound'
                            )}
                        />
                    )}
                    {failure === 'access-denied' && (
                        <EmptyState
                            title={globalize.translate(
                                'HeaderLibraryAccessDenied'
                            )}
                            description={globalize.translate(
                                'MessageLibraryAccessDenied'
                            )}
                        />
                    )}
                    {isRetryableLibraryFailure(failure) && (
                        <ErrorState
                            message={globalize.translate('ErrorDefault')}
                            retryLabel={globalize.translate('Retry')}
                            onRetry={onInfoRetry}
                        />
                    )}
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
            backDropType={[primaryItemType]}
        >
            <div className='rf-library-view'>
                <h1 className='rf-library-view__title'>{libraryName}</h1>

                <Tabs
                    className='rf-library-view__destinations'
                    items={tabs}
                    value={activeTabIndex}
                    onChange={onTabChange}
                    aria-label={globalize.translate('HeaderLibraries')}
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

                {destination === 'browse' && (
                    <BrowseDestination
                        libraryId={libraryId}
                        libraryName={libraryName}
                        collectionType={collectionType}
                        primaryItemType={primaryItemType}
                        density={density}
                        apiClient={__legacyApiClient__}
                    />
                )}
                {destination === 'genres' && (
                    <GenresDestination
                        libraryId={libraryId}
                        primaryItemType={primaryItemType}
                        density={density}
                    />
                )}
                {destination === 'collections' && (
                    <CollectionsDestination
                        libraryId={libraryId}
                        density={density}
                        apiClient={__legacyApiClient__}
                    />
                )}
                {destination === 'suggestions' && (
                    <SuggestionsDestination
                        libraryId={libraryId}
                        collectionType={collectionType}
                        density={density}
                        apiClient={__legacyApiClient__}
                    />
                )}
            </div>
        </Page>
    );
};

export default LibraryView;
