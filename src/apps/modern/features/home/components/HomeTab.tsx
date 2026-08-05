import React, { type FC, type ReactNode, useMemo } from 'react';

import { useApi } from 'hooks/useApi';
import globalize from 'lib/globalize';
import type { BaseItemDto } from 'lib/tesserafin-sdk';
import {
    MediaCard,
    MediaShelf,
    usePresentation,
    type MediaShelfDensity
} from 'ui';

import { useLatestMedia } from '../api/useLatestMedia';
import { useNextUp } from '../api/useNextUp';
import { useResumeItems } from '../api/useResumeItems';
import { useUserViews } from '../api/useUserViews';
import {
    getLatestMediaCardOptions,
    toMediaCardPropsArray
} from '../utils/mediaCardProps';
import { getLatestMediaViews } from '../utils/latestMediaViews';
import {
    toRenderedHomeSections,
    type WebHomeSection
} from '../utils/homeRecipe';
import HomeHero from './HomeHero';
import HomeSection from './HomeSection';

const MY_MEDIA_OPTIONS = { imageAspect: 'backdrop' as const };
const CONTINUE_WATCHING_OPTIONS = {
    imageAspect: 'backdrop' as const,
    preferThumb: true
};
const NEXT_UP_OPTIONS = { imageAspect: 'backdrop' as const, preferThumb: true };

interface LatestMediaSectionProps {
    view: BaseItemDto;
    density: MediaShelfDensity;
    /**
     * Fetch, render nothing. Set when the active Home recipe leaves `latestMedia` out.
     *
     * The section is still MOUNTED in that case, on purpose: `useLatestMedia` is one query per
     * library view, and simply not mounting the component would have meant a recipe deciding
     * whether those requests happen at all — a theme controlling API queries, which RFC-0007 §6.1
     * forbids outright and which `HomeTab.recipe.test.tsx` asserts against with a recipe that omits
     * the section.
     */
    hidden?: boolean;
}

/**
 * One "ajouts récents" section for a single library view. Extracted so `useLatestMedia` (one query
 * per view) is called at this component's own top level - the number of user views is only known
 * at runtime, so it can't be called in a loop inside `HomeTab` itself (biome
 * `correctness/useHookAtTopLevel`).
 */
const LatestMediaSection: FC<LatestMediaSectionProps> = ({
    view,
    density,
    hidden
}) => {
    const { __legacyApiClient__ } = useApi();
    const query = useLatestMedia(view.Id ?? undefined);
    const cardOptions = useMemo(
        () => getLatestMediaCardOptions(view.CollectionType),
        [view.CollectionType]
    );
    const title = globalize.translate('LatestFromLibrary', view.Name ?? '');

    // After every hook, never before: the early return must not change hook order.
    if (hidden) return null;

    return (
        <HomeSection
            title={title}
            isLoading={query.isPending}
            isError={query.isError}
            onRetry={() => void query.refetch()}
            isEmpty={!query.data?.length}
        >
            <MediaShelf title={title} density={density}>
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

/**
 * The modern Home tab, composed from the active theme's resolved `presentation.page.home` recipe
 * (RFC-0007 §4.7).
 *
 * ## What the recipe does, and the two invariants that bound it
 *
 * It orders and selects sections. That is all. Two things are deliberately kept above it:
 *
 *  1. **Every query is unconditional.** `useUserViews`, `useResumeItems` and `useNextUp` are called
 *     before the recipe is consulted and regardless of what it says. `useLatestMedia` is one query
 *     per library view and so has to live in a child component; that child is mounted either way,
 *     `hidden` when the recipe omits `latestMedia`, precisely so the recipe cannot decide whether
 *     those requests happen. The set of requests Home issues is therefore identical under every
 *     recipe: a theme cannot change what the client asks the server for, cannot reach data the user
 *     is not entitled to, and cannot use "hide a section" as a covert way to stop a fetch
 *     (RFC-0007 §6.1). `HomeTab.recipe.test.tsx` asserts this with a recipe that omits a section,
 *     rather than trusting the reading.
 *  2. **Nothing here knows a theme id.** The recipe arrives already resolved through
 *     `usePresentation()`. There is no `if (themeId === …)` anywhere in this vertical, and adding a
 *     theme means adding a manifest, never editing this file.
 *
 * A section omitted by a recipe is HIDDEN, not unfetched and not reranked. Whether hiding a section
 * is the right product behaviour for a given section stays a product decision, recorded in
 * `docs/tesserafin/presentation-boundary.md` — composition must not quietly become a ranking
 * engine.
 *
 * `shelfDensity` is passed to every shelf, which is why it is bound here and not left to CSS: the
 * Theme Studio must not offer a control that only moves in its preview.
 */
const HomeTab: FC = () => {
    const { __legacyApiClient__ } = useApi();

    /*
     * Unconditional, and above the recipe read on purpose — see invariant 1. Moving any of these
     * behind a section check is the single change that would turn composition into data access.
     */
    const userViewsQuery = useUserViews();
    const resumeQuery = useResumeItems();
    const nextUpQuery = useNextUp();

    const homeRecipe = usePresentation().page.home;
    const sections = useMemo(
        () => toRenderedHomeSections(homeRecipe.sections),
        [homeRecipe.sections]
    );
    const density = homeRecipe.shelfDensity;

    const userViews = userViewsQuery.data?.Items;
    const latestMediaViews = useMemo(
        () => getLatestMediaViews(userViews),
        [userViews]
    );

    const myMediaTitle = globalize.translate('HeaderMyMedia');
    const continueWatchingTitle = globalize.translate('HeaderContinueWatching');
    const nextUpTitle = globalize.translate('NextUp');

    const renderSection = (section: WebHomeSection): ReactNode => {
        switch (section) {
            case 'hero':
                return (
                    <HomeHero
                        key='hero'
                        resumeItems={resumeQuery.data?.Items}
                        nextUpItems={nextUpQuery.data?.Items}
                        apiClient={__legacyApiClient__}
                    />
                );

            case 'libraries':
                return (
                    <HomeSection
                        key='libraries'
                        title={myMediaTitle}
                        isLoading={userViewsQuery.isPending}
                        isError={userViewsQuery.isError}
                        onRetry={() => void userViewsQuery.refetch()}
                        isEmpty={!userViews?.length}
                        emptyLabel={globalize.translate('MessageNothingHere')}
                    >
                        <MediaShelf title={myMediaTitle} density={density}>
                            {toMediaCardPropsArray(
                                userViews,
                                __legacyApiClient__,
                                MY_MEDIA_OPTIONS
                            ).map((cardProps) => (
                                <MediaCard
                                    key={cardProps.href}
                                    {...cardProps}
                                />
                            ))}
                        </MediaShelf>
                    </HomeSection>
                );

            case 'continueWatching':
                return (
                    <HomeSection
                        key='continueWatching'
                        title={continueWatchingTitle}
                        isLoading={resumeQuery.isPending}
                        isError={resumeQuery.isError}
                        onRetry={() => void resumeQuery.refetch()}
                        isEmpty={!resumeQuery.data?.Items?.length}
                    >
                        <MediaShelf
                            title={continueWatchingTitle}
                            density={density}
                        >
                            {toMediaCardPropsArray(
                                resumeQuery.data?.Items,
                                __legacyApiClient__,
                                CONTINUE_WATCHING_OPTIONS
                            ).map((cardProps) => (
                                <MediaCard
                                    key={cardProps.href}
                                    {...cardProps}
                                />
                            ))}
                        </MediaShelf>
                    </HomeSection>
                );

            case 'nextUp':
                return (
                    <HomeSection
                        key='nextUp'
                        title={nextUpTitle}
                        isLoading={nextUpQuery.isPending}
                        isError={nextUpQuery.isError}
                        onRetry={() => void nextUpQuery.refetch()}
                        isEmpty={!nextUpQuery.data?.Items?.length}
                    >
                        <MediaShelf title={nextUpTitle} density={density}>
                            {toMediaCardPropsArray(
                                nextUpQuery.data?.Items,
                                __legacyApiClient__,
                                NEXT_UP_OPTIONS
                            ).map((cardProps) => (
                                <MediaCard
                                    key={cardProps.href}
                                    {...cardProps}
                                />
                            ))}
                        </MediaShelf>
                    </HomeSection>
                );

            case 'latestMedia':
                // The one 1:N token: one shelf per eligible view. A recipe orders the group, never
                // an individual library — which libraries exist is authorization state.
                return (
                    <React.Fragment key='latestMedia'>
                        {latestMediaViews.map((view) => (
                            <LatestMediaSection
                                key={view.Id}
                                view={view}
                                density={density}
                            />
                        ))}
                    </React.Fragment>
                );
        }
    };

    return (
        <div className='rf-home-composition' data-rf-slot='home-composition'>
            {sections.map(renderSection)}

            {/*
             * `latestMedia` left out of the recipe: mount the per-view sections anyway, hidden, so
             * their queries still fire. Exactly one instance per view exists either way — the
             * branch above renders them or this one does, never both — so hiding costs no extra
             * request and omitting the section costs none either. See `LatestMediaSectionProps
             * .hidden`.
             */}
            {!sections.includes('latestMedia') &&
                latestMediaViews.map((view) => (
                    <LatestMediaSection
                        key={view.Id}
                        view={view}
                        density={density}
                        hidden
                    />
                ))}
        </div>
    );
};

export default HomeTab;
