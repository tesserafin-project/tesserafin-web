import React, { type FC, useMemo } from 'react';

import { getBackdropShape } from 'components/cardbuilder/utils/shape';
import SectionContainer from 'components/common/SectionContainer';
import { useApi } from 'hooks/useApi';
import globalize from 'lib/globalize';
import type { BaseItemDto } from 'lib/reefin-sdk';

import { useLatestMedia } from '../api/useLatestMedia';
import { useNextUp } from '../api/useNextUp';
import { useResumeItems } from '../api/useResumeItems';
import { useUserViews } from '../api/useUserViews';
import { getLatestMediaCardOptions } from '../utils/latestMediaCardOptions';
import { getLatestMediaViews } from '../utils/latestMediaViews';
import { toItemDtoArray } from '../utils/itemDtoAdapter';
import HomeSection from './HomeSection';

const MY_MEDIA_CARD_OPTIONS = {
    shape: getBackdropShape(true),
    showTitle: true,
    centerText: true,
    overlayText: false,
    scalable: true,
    cardLayout: false
};

const CONTINUE_WATCHING_CARD_OPTIONS = {
    shape: getBackdropShape(true),
    preferThumb: true,
    showTitle: true,
    showParentTitle: true,
    showYear: true,
    overlayPlayButton: true,
    overlayText: false,
    centerText: true,
    cardLayout: false,
    lines: 2
};

const NEXT_UP_CARD_OPTIONS = {
    shape: getBackdropShape(true),
    preferThumb: true,
    showTitle: true,
    showParentTitle: true,
    overlayPlayButton: true,
    overlayText: false,
    centerText: true,
    cardLayout: false
};

interface LatestMediaSectionProps {
    view: BaseItemDto;
    serverId?: string;
}

/**
 * One "ajouts récents" section for a single library view. Extracted so `useLatestMedia` (one query
 * per view) is called at this component's own top level - the number of user views is only known
 * at runtime, so it can't be called in a loop inside `HomeTab` itself (biome
 * `correctness/useHookAtTopLevel`).
 */
const LatestMediaSection: FC<LatestMediaSectionProps> = ({
    view,
    serverId
}) => {
    const query = useLatestMedia(view.Id ?? undefined);
    const cardOptions = useMemo(
        () => getLatestMediaCardOptions(view.CollectionType),
        [view.CollectionType]
    );
    const title = globalize.translate('LatestFromLibrary', view.Name ?? '');
    const queryKey = ['Home', 'LatestMedia', view.Id];

    return (
        <HomeSection
            title={title}
            isLoading={query.isPending}
            isError={query.isError}
            onRetry={() => void query.refetch()}
            isEmpty={!query.data?.length}
        >
            <SectionContainer
                sectionHeaderProps={{ title }}
                itemsContainerProps={{ queryKey }}
                items={toItemDtoArray(query.data)}
                cardOptions={{ ...cardOptions, queryKey, serverId }}
            />
        </HomeSection>
    );
};

const HomeTab: FC = () => {
    const { __legacyApiClient__ } = useApi();
    const serverId = __legacyApiClient__?.serverId();

    const userViewsQuery = useUserViews();
    const resumeQuery = useResumeItems();
    const nextUpQuery = useNextUp();

    const userViews = userViewsQuery.data?.Items;
    const latestMediaViews = useMemo(
        () => getLatestMediaViews(userViews),
        [userViews]
    );

    return (
        <>
            <HomeSection
                title={globalize.translate('HeaderMyMedia')}
                isLoading={userViewsQuery.isPending}
                isError={userViewsQuery.isError}
                onRetry={() => void userViewsQuery.refetch()}
                isEmpty={!userViews?.length}
                emptyLabel={globalize.translate('MessageNothingHere')}
            >
                <SectionContainer
                    sectionHeaderProps={{
                        title: globalize.translate('HeaderMyMedia')
                    }}
                    itemsContainerProps={{ queryKey: ['Home', 'UserViews'] }}
                    items={toItemDtoArray(userViews)}
                    cardOptions={{
                        ...MY_MEDIA_CARD_OPTIONS,
                        queryKey: ['Home', 'UserViews'],
                        serverId
                    }}
                />
            </HomeSection>

            <HomeSection
                title={globalize.translate('HeaderContinueWatching')}
                isLoading={resumeQuery.isPending}
                isError={resumeQuery.isError}
                onRetry={() => void resumeQuery.refetch()}
                isEmpty={!resumeQuery.data?.Items?.length}
            >
                <SectionContainer
                    sectionHeaderProps={{
                        title: globalize.translate('HeaderContinueWatching')
                    }}
                    itemsContainerProps={{ queryKey: ['Home', 'ResumeItems'] }}
                    items={toItemDtoArray(resumeQuery.data?.Items)}
                    cardOptions={{
                        ...CONTINUE_WATCHING_CARD_OPTIONS,
                        queryKey: ['Home', 'ResumeItems'],
                        serverId
                    }}
                />
            </HomeSection>

            <HomeSection
                title={globalize.translate('NextUp')}
                isLoading={nextUpQuery.isPending}
                isError={nextUpQuery.isError}
                onRetry={() => void nextUpQuery.refetch()}
                isEmpty={!nextUpQuery.data?.Items?.length}
            >
                <SectionContainer
                    sectionHeaderProps={{
                        title: globalize.translate('NextUp')
                    }}
                    itemsContainerProps={{ queryKey: ['Home', 'NextUp'] }}
                    items={toItemDtoArray(nextUpQuery.data?.Items)}
                    cardOptions={{
                        ...NEXT_UP_CARD_OPTIONS,
                        queryKey: ['Home', 'NextUp'],
                        serverId
                    }}
                />
            </HomeSection>

            {latestMediaViews.map((view) => (
                <LatestMediaSection
                    key={view.Id}
                    view={view}
                    serverId={serverId}
                />
            ))}
        </>
    );
};

export default HomeTab;
