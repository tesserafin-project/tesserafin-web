import React, { type FC } from 'react';

import { useApi } from 'hooks/useApi';
import globalize from 'lib/globalize';
import { BaseItemKind } from 'lib/reefin-sdk';
import { EmptyState, MediaCard, MediaShelf } from 'ui';

import { useFavoriteItems } from '../api/useFavoriteItems';
import { toMediaCardPropsArray } from '../utils/mediaCardProps';
import HomeSection from './HomeSection';

const PORTRAIT_FAVORITE_OPTIONS = { imageAspect: 'poster' as const };
const EPISODE_OPTIONS = { imageAspect: 'backdrop' as const, preferThumb: true };

/**
 * Favorite sections: title translation keys mirror `apps/legacy/controllers/favorites.js`'s
 * `getSections()` (`Movies`/`Shows`/`Episodes` - note "Shows", not "Series"). Individual sections
 * hide when empty (no `emptyLabel`, matching legacy's `verticalSection.hide` toggling); the overall
 * "all favorites are empty" case is handled below instead, since legacy has no per-section fallback
 * message of its own.
 */
const FavoritesTab: FC = () => {
    const { __legacyApiClient__ } = useApi();

    const moviesQuery = useFavoriteItems([BaseItemKind.Movie]);
    const seriesQuery = useFavoriteItems([BaseItemKind.Series]);
    const episodesQuery = useFavoriteItems([BaseItemKind.Episode]);

    const isMoviesEmpty = !moviesQuery.data?.Items?.length;
    const isSeriesEmpty = !seriesQuery.data?.Items?.length;
    const isEpisodesEmpty = !episodesQuery.data?.Items?.length;

    const isAllEmpty =
        !moviesQuery.isPending &&
        !moviesQuery.isError &&
        isMoviesEmpty &&
        !seriesQuery.isPending &&
        !seriesQuery.isError &&
        isSeriesEmpty &&
        !episodesQuery.isPending &&
        !episodesQuery.isError &&
        isEpisodesEmpty;

    const moviesTitle = globalize.translate('Movies');
    const showsTitle = globalize.translate('Shows');
    const episodesTitle = globalize.translate('Episodes');

    return (
        <>
            <HomeSection
                title={moviesTitle}
                isLoading={moviesQuery.isPending}
                isError={moviesQuery.isError}
                onRetry={() => void moviesQuery.refetch()}
                isEmpty={isMoviesEmpty}
            >
                <MediaShelf title={moviesTitle}>
                    {toMediaCardPropsArray(
                        moviesQuery.data?.Items,
                        __legacyApiClient__,
                        PORTRAIT_FAVORITE_OPTIONS
                    ).map((cardProps) => (
                        <MediaCard key={cardProps.href} {...cardProps} />
                    ))}
                </MediaShelf>
            </HomeSection>

            <HomeSection
                title={showsTitle}
                isLoading={seriesQuery.isPending}
                isError={seriesQuery.isError}
                onRetry={() => void seriesQuery.refetch()}
                isEmpty={isSeriesEmpty}
            >
                <MediaShelf title={showsTitle}>
                    {toMediaCardPropsArray(
                        seriesQuery.data?.Items,
                        __legacyApiClient__,
                        PORTRAIT_FAVORITE_OPTIONS
                    ).map((cardProps) => (
                        <MediaCard key={cardProps.href} {...cardProps} />
                    ))}
                </MediaShelf>
            </HomeSection>

            <HomeSection
                title={episodesTitle}
                isLoading={episodesQuery.isPending}
                isError={episodesQuery.isError}
                onRetry={() => void episodesQuery.refetch()}
                isEmpty={isEpisodesEmpty}
            >
                <MediaShelf title={episodesTitle}>
                    {toMediaCardPropsArray(
                        episodesQuery.data?.Items,
                        __legacyApiClient__,
                        EPISODE_OPTIONS
                    ).map((cardProps) => (
                        <MediaCard key={cardProps.href} {...cardProps} />
                    ))}
                </MediaShelf>
            </HomeSection>

            {isAllEmpty && (
                <EmptyState title={globalize.translate('MessageNothingHere')} />
            )}
        </>
    );
};

export default FavoritesTab;
