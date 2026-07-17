import Typography from '@mui/material/Typography';
import React, { type FC } from 'react';

import {
    getBackdropShape,
    getPortraitShape
} from 'components/cardbuilder/utils/shape';
import SectionContainer from 'components/common/SectionContainer';
import { useApi } from 'hooks/useApi';
import globalize from 'lib/globalize';
import { BaseItemKind } from 'lib/reefin-sdk';

import { useFavoriteItems } from '../api/useFavoriteItems';
import { toItemDtoArray } from '../utils/itemDtoAdapter';
import HomeSection from './HomeSection';

const PORTRAIT_FAVORITE_CARD_OPTIONS = {
    shape: getPortraitShape(true),
    showTitle: true,
    showYear: true,
    overlayPlayButton: true,
    overlayText: false,
    centerText: true,
    cardLayout: false
};

const EPISODE_CARD_OPTIONS = {
    shape: getBackdropShape(true),
    preferThumb: true,
    showTitle: true,
    showParentTitle: true,
    overlayPlayButton: true,
    overlayText: false,
    centerText: true,
    cardLayout: false
};

/**
 * Favorite sections: title translation keys mirror `apps/legacy/controllers/favorites.js`'s
 * `getSections()` (`Movies`/`Shows`/`Episodes` - note "Shows", not "Series"). Individual sections
 * hide when empty (no `emptyLabel`, matching legacy's `verticalSection.hide` toggling); the overall
 * "all favorites are empty" case is handled below instead, since legacy has no per-section fallback
 * message of its own.
 */
const FavoritesTab: FC = () => {
    const { __legacyApiClient__ } = useApi();
    const serverId = __legacyApiClient__?.serverId();

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

    return (
        <>
            <HomeSection
                title={globalize.translate('Movies')}
                isLoading={moviesQuery.isPending}
                isError={moviesQuery.isError}
                onRetry={() => void moviesQuery.refetch()}
                isEmpty={isMoviesEmpty}
            >
                <SectionContainer
                    sectionHeaderProps={{
                        title: globalize.translate('Movies')
                    }}
                    itemsContainerProps={{
                        queryKey: ['Home', 'FavoriteItems', 'Movie']
                    }}
                    items={toItemDtoArray(moviesQuery.data?.Items)}
                    cardOptions={{
                        ...PORTRAIT_FAVORITE_CARD_OPTIONS,
                        queryKey: ['Home', 'FavoriteItems', 'Movie'],
                        serverId
                    }}
                />
            </HomeSection>

            <HomeSection
                title={globalize.translate('Shows')}
                isLoading={seriesQuery.isPending}
                isError={seriesQuery.isError}
                onRetry={() => void seriesQuery.refetch()}
                isEmpty={isSeriesEmpty}
            >
                <SectionContainer
                    sectionHeaderProps={{ title: globalize.translate('Shows') }}
                    itemsContainerProps={{
                        queryKey: ['Home', 'FavoriteItems', 'Series']
                    }}
                    items={toItemDtoArray(seriesQuery.data?.Items)}
                    cardOptions={{
                        ...PORTRAIT_FAVORITE_CARD_OPTIONS,
                        queryKey: ['Home', 'FavoriteItems', 'Series'],
                        serverId
                    }}
                />
            </HomeSection>

            <HomeSection
                title={globalize.translate('Episodes')}
                isLoading={episodesQuery.isPending}
                isError={episodesQuery.isError}
                onRetry={() => void episodesQuery.refetch()}
                isEmpty={isEpisodesEmpty}
            >
                <SectionContainer
                    sectionHeaderProps={{
                        title: globalize.translate('Episodes')
                    }}
                    itemsContainerProps={{
                        queryKey: ['Home', 'FavoriteItems', 'Episode']
                    }}
                    items={toItemDtoArray(episodesQuery.data?.Items)}
                    cardOptions={{
                        ...EPISODE_CARD_OPTIONS,
                        queryKey: ['Home', 'FavoriteItems', 'Episode'],
                        serverId
                    }}
                />
            </HomeSection>

            {isAllEmpty && (
                <Typography
                    variant='body2'
                    color='text.secondary'
                    sx={{ px: 2 }}
                >
                    {globalize.translate('MessageNothingHere')}
                </Typography>
            )}
        </>
    );
};

export default FavoritesTab;
