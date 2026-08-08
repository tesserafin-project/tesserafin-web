import React, { type FC, useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

import { useApi } from 'hooks/useApi';
import globalize from 'lib/globalize';
import {
    EmptyState,
    ErrorState,
    LoadingState,
    MediaCard,
    MediaGrid,
    Surface
} from 'ui';

import type { ContentPackDto } from '../adapters/contentPacksApi';
import { useContentPacks } from '../api/useContentPackQueries';
import {
    contentPackHref,
    representativeImageUrl,
    type PackImageApiClient
} from '../utils/packCardProps';
import { isContentPackDeletedState } from './ContentPackDetailActions';
import ContentPackManagerBar from './ContentPackManagerBar';

interface ContentPackMosaicGridProps {
    packs: ContentPackDto[];
    apiClient: PackImageApiClient | undefined;
}

/**
 * The cards themselves. Split out so the four states below stay four early returns rather than a
 * ternary chain — the same contract `features/library/components/LibraryItemsGrid.tsx` follows.
 */
const ContentPackMosaicGrid: FC<ContentPackMosaicGridProps> = ({
    packs,
    apiClient
}) => (
    <MediaGrid
        density='comfortable'
        aria-label={globalize.translate('ContentPacks')}
    >
        {packs.map((pack) => (
            <MediaCard
                key={pack.Id}
                title={pack.Name}
                /*
                 * `VisibleItemCount` verbatim, including `0`: a pack that shows this user nothing
                 * says so, rather than hiding the number and letting the viewer assume it is
                 * unknown. `?? 0` covers only a DTO that omitted the field; it never stands in for
                 * a count computed here.
                 */
                subtitle={globalize.translate(
                    'ItemCount',
                    pack.VisibleItemCount ?? 0
                )}
                imageUrl={representativeImageUrl(pack, apiClient)}
                imageAspect='poster'
                href={contentPackHref(pack.Id ?? '')}
            />
        ))}
    </MediaGrid>
);

/**
 * `/contentpacks` — every pack this user may see, in the server's order (#138 §5).
 *
 * ## What each card is allowed to say
 *
 * The name, the server's `VisibleItemCount`, and artwork for the server's `RepresentativeItemId`.
 * Nothing else. In particular the mosaic never fetches a pack's memberships to count them or to
 * find a picture — a count derived that way would be "how many the client happened to receive" and
 * artwork chosen that way would be a choice the server declined to make.
 *
 * ## The heading, and why it is focusable
 *
 * One `h1` naming the page, present in every state, so the route has a heading hierarchy rather
 * than a first heading that appears only once data arrives. It carries `tabIndex={-1}` for exactly
 * one reason: a pack deleted from `/contentpacks/:packId` returns here, and focus has to land on
 * something that says where the viewer now is. Without it, deleting the pack whose detail route
 * held focus would drop focus to the document body — the browser's answer to "the element you were
 * on is gone", and the reason a keyboard or remote user would have to tab from the top of the page
 * again. It is not in the tab order; it is a destination, not a stop.
 *
 * ## Presentation
 *
 * `Surface` and `MediaCard` read the resolved `presentation.surface` / `presentation.mediaCard`
 * through their own context. Nothing here branches on a theme identity and nothing here reads a
 * `presentation.page.contentPacks` — there is no such capability and this route does not need one.
 */
const ContentPackMosaic: FC = () => {
    const { __legacyApiClient__: apiClient } = useApi();
    const packsQuery = useContentPacks();
    const location = useLocation();
    const onRetry = useCallback(() => void packsQuery.refetch(), [packsQuery]);

    const deletedName = isContentPackDeletedState(location.state)
        ? location.state.contentPackDeleted
        : null;

    const headingRef = useRef<HTMLHeadingElement>(null);
    useEffect(() => {
        if (deletedName === null) return;
        headingRef.current?.focus();
    }, [deletedName]);

    let body: React.ReactNode;
    if (packsQuery.isPending) {
        body = (
            <LoadingState
                variant='grid'
                label={globalize.translate('ContentPacks')}
            />
        );
    } else if (packsQuery.isError) {
        body = (
            <ErrorState
                message={globalize.translate('ErrorDefault')}
                retryLabel={globalize.translate('Retry')}
                onRetry={onRetry}
            />
        );
    } else if ((packsQuery.data ?? []).length === 0) {
        body = (
            <>
                <ContentPackManagerBar packs={[]} />
                <EmptyState
                    title={globalize.translate('MessageNoContentPacks')}
                    description={globalize.translate(
                        'MessageContentPacksMosaic'
                    )}
                />
            </>
        );
    } else {
        const packs = packsQuery.data ?? [];
        body = (
            <>
                <ContentPackManagerBar packs={packs} />
                <ContentPackMosaicGrid packs={packs} apiClient={apiClient} />
            </>
        );
    }

    return (
        <Surface className='rf-content-packs'>
            <h1
                ref={headingRef}
                tabIndex={-1}
                data-content-packs='mosaic-heading'
            >
                {globalize.translate('ContentPacks')}
            </h1>

            {/*
             * Announced, not merely shown. A pack that was deleted from its own route disappears
             * from a page the viewer did not ask to be taken to, and `role='status'` is what tells
             * a screen-reader user why they are here. It is rendered once, from the navigation
             * state, so a re-render cannot repeat the announcement.
             */}
            {deletedName === null ? null : (
                <p role='status' data-content-packs='deleted-notice'>
                    {globalize.translate(
                        'MessageContentPackDeleted',
                        deletedName
                    )}
                </p>
            )}

            {body}
        </Surface>
    );
};

export default ContentPackMosaic;
