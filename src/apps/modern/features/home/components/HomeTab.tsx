import React, { type FC, useMemo } from 'react';

import { useApi } from 'hooks/useApi';
import globalize from 'lib/globalize';
import type { BaseItemDto } from 'lib/tesserafin-sdk';
import { MediaCard, MediaShelf } from 'ui';

import { useLatestMedia } from '../api/useLatestMedia';
import { useNextUp } from '../api/useNextUp';
import { useResumeItems } from '../api/useResumeItems';
import { useUserViews } from '../api/useUserViews';
import {
    getLatestMediaCardOptions,
    toMediaCardPropsArray
} from '../utils/mediaCardProps';
import { getLatestMediaViews } from '../utils/latestMediaViews';
import HomeSection from './HomeSection';

const MY_MEDIA_OPTIONS = { imageAspect: 'backdrop' as const };
const CONTINUE_WATCHING_OPTIONS = {
    imageAspect: 'backdrop' as const,
    preferThumb: true
};
const NEXT_UP_OPTIONS = { imageAspect: 'backdrop' as const, preferThumb: true };

interface LatestMediaSectionProps {
    view: BaseItemDto;
}

/**
 * One "ajouts récents" section for a single library view. Extracted so `useLatestMedia` (one query
 * per view) is called at this component's own top level - the number of user views is only known
 * at runtime, so it can't be called in a loop inside `HomeTab` itself (biome
 * `correctness/useHookAtTopLevel`).
 */
const LatestMediaSection: FC<LatestMediaSectionProps> = ({ view }) => {
    const { __legacyApiClient__ } = useApi();
    const query = useLatestMedia(view.Id ?? undefined);
    const cardOptions = useMemo(
        () => getLatestMediaCardOptions(view.CollectionType),
        [view.CollectionType]
    );
    const title = globalize.translate('LatestFromLibrary', view.Name ?? '');

    return (
        <HomeSection
            title={title}
            isLoading={query.isPending}
            isError={query.isError}
            onRetry={() => void query.refetch()}
            isEmpty={!query.data?.length}
        >
            <MediaShelf title={title}>
                {toMediaCardPropsArray(
                    query.data,
                    __legacyApiClient__,
                    cardOptions
                ).map((cardProps) => (
                    <MediaCard key={cardProps.href} {...cardProps} />
                ))}
            </MediaShelf>
        </HomeSection>
    );
};

const HomeTab: FC = () => {
    const { __legacyApiClient__ } = useApi();

    const userViewsQuery = useUserViews();
    const resumeQuery = useResumeItems();
    const nextUpQuery = useNextUp();

    const userViews = userViewsQuery.data?.Items;
    const latestMediaViews = useMemo(
        () => getLatestMediaViews(userViews),
        [userViews]
    );

    const myMediaTitle = globalize.translate('HeaderMyMedia');
    const continueWatchingTitle = globalize.translate('HeaderContinueWatching');
    const nextUpTitle = globalize.translate('NextUp');

    return (
        <>
            <HomeSection
                title={myMediaTitle}
                isLoading={userViewsQuery.isPending}
                isError={userViewsQuery.isError}
                onRetry={() => void userViewsQuery.refetch()}
                isEmpty={!userViews?.length}
                emptyLabel={globalize.translate('MessageNothingHere')}
            >
                <MediaShelf title={myMediaTitle}>
                    {toMediaCardPropsArray(
                        userViews,
                        __legacyApiClient__,
                        MY_MEDIA_OPTIONS
                    ).map((cardProps) => (
                        <MediaCard key={cardProps.href} {...cardProps} />
                    ))}
                </MediaShelf>
            </HomeSection>

            <HomeSection
                title={continueWatchingTitle}
                isLoading={resumeQuery.isPending}
                isError={resumeQuery.isError}
                onRetry={() => void resumeQuery.refetch()}
                isEmpty={!resumeQuery.data?.Items?.length}
            >
                <MediaShelf title={continueWatchingTitle}>
                    {toMediaCardPropsArray(
                        resumeQuery.data?.Items,
                        __legacyApiClient__,
                        CONTINUE_WATCHING_OPTIONS
                    ).map((cardProps) => (
                        <MediaCard key={cardProps.href} {...cardProps} />
                    ))}
                </MediaShelf>
            </HomeSection>

            <HomeSection
                title={nextUpTitle}
                isLoading={nextUpQuery.isPending}
                isError={nextUpQuery.isError}
                onRetry={() => void nextUpQuery.refetch()}
                isEmpty={!nextUpQuery.data?.Items?.length}
            >
                <MediaShelf title={nextUpTitle}>
                    {toMediaCardPropsArray(
                        nextUpQuery.data?.Items,
                        __legacyApiClient__,
                        NEXT_UP_OPTIONS
                    ).map((cardProps) => (
                        <MediaCard key={cardProps.href} {...cardProps} />
                    ))}
                </MediaShelf>
            </HomeSection>

            {latestMediaViews.map((view) => (
                <LatestMediaSection key={view.Id} view={view} />
            ))}
        </>
    );
};

export default HomeTab;
