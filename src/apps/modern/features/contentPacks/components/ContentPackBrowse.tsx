import React, { type FC, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import { useApi } from 'hooks/useApi';
import globalize from 'lib/globalize';
import type { MediaCardImageAspect } from 'ui';
import {
    EmptyState,
    ErrorState,
    LoadingState,
    MediaCard,
    MediaGrid,
    Pagination,
    Surface,
    usePresentation
} from 'ui';

import type { ImageApiClient } from '../../home/utils/mediaCardProps';
import { toMediaCardPropsArray } from '../../home/utils/mediaCardProps';
import { isNotFoundError } from '../api/contentPackErrors';
import {
    useContentPack,
    useContentPackItems
} from '../api/useContentPackQueries';
import ContentPackDetailActions from './ContentPackDetailActions';

/** One page of a pack. Matches the paging convention the library grid already uses. */
export const CONTENT_PACK_PAGE_SIZE = 50;

const parsePage = (raw: string | null): number => {
    const parsed = Number.parseInt(raw ?? '1', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

interface ContentPackItemsProps {
    itemsQuery: ReturnType<typeof useContentPackItems>;
    apiClient: ImageApiClient | undefined;
    imageAspect: MediaCardImageAspect;
    label: string;
    page: number;
    totalPages: number;
    onRetry: () => void;
    onPreviousPage: () => void;
    onNextPage: () => void;
}

/**
 * The items region: loading, transport error, empty pack, or a page of cards.
 *
 * Its own component with four early returns rather than four nested ternaries inside the route —
 * the same four-state contract `features/library/components/LibraryItemsGrid.tsx` follows, and for
 * the same reason: each state is a distinct thing the viewer is being told, and a ternary chain
 * makes it very easy to accidentally tell them two of them at once.
 */
const ContentPackItems: FC<ContentPackItemsProps> = ({
    itemsQuery,
    apiClient,
    imageAspect,
    label,
    page,
    totalPages,
    onRetry,
    onPreviousPage,
    onNextPage
}) => {
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

    const items = itemsQuery.data?.items ?? [];
    if (items.length === 0) {
        return (
            <EmptyState
                title={globalize.translate('MessageContentPackEmpty')}
            />
        );
    }

    return (
        <>
            <MediaGrid density='comfortable' aria-label={label}>
                {toMediaCardPropsArray(items, apiClient, {
                    imageAspect,
                    preferThumb: false
                }).map((cardProps) => (
                    <MediaCard key={cardProps.href} {...cardProps} />
                ))}
            </MediaGrid>

            {totalPages > 1 && (
                <Pagination
                    page={page}
                    totalPages={totalPages}
                    previousLabel={globalize.translate('Previous')}
                    nextLabel={globalize.translate('Next')}
                    aria-label={globalize.translate('Pagination')}
                    onPreviousPage={onPreviousPage}
                    onNextPage={onNextPage}
                />
            )}
        </>
    );
};

/**
 * `/contentpacks/:packId` — one pack's mixed-media browse (#138 §6).
 *
 * ## Why Home's card adapter and not the library one
 *
 * A pack holds whatever its owner put in it: a film, a series, an episode, an album, a book, a
 * recording. `features/library/utils/mediaCardProps.ts` documents itself as covering Movie/Series
 * leaf items only, so it would mis-route half of that. `features/home/utils/mediaCardProps.ts`
 * already mirrors `appRouter.getRouteUrl()`'s branches — folders, Live TV, home videos, mixed
 * libraries, and everything else to `/details` — and already selects artwork per item (own thumb,
 * series-inherited thumb, own primary, series-inherited primary, backdrop). That is the whole of
 * the mixed-media behaviour this route needs, and reusing it is what keeps the two surfaces from
 * disagreeing about where an item lives.
 *
 * ## Aspect
 *
 * One aspect for the grid, taken from the resolved `presentation.mediaCard.imageAspect` — the
 * contract names that value as "the DEFAULT a consuming route may read". A per-family aspect would
 * need a new media-family classifier, and adding a third one is exactly what this milestone is
 * forbidden to do. Artwork selection and destination still differ per item, through the Home
 * adapter, which is where the family differences actually live.
 *
 * ## What this surface must not hint at
 *
 * `TotalRecordCount` is the paging total for the items this caller may see. It is used for paging
 * and for nothing else — in particular it is never compared against the pack's `VisibleItemCount`
 * to suggest that other members exist. A pack that shows this caller nothing is simply empty.
 */
const ContentPackBrowse: FC = () => {
    const { packId } = useParams<{ packId: string }>();
    const [searchParams, setSearchParams] = useSearchParams();
    const { __legacyApiClient__: apiClient } = useApi();
    const presentation = usePresentation();

    const page = parsePage(searchParams.get('page'));
    const packQuery = useContentPack(packId);
    const itemsQuery = useContentPackItems(packId, {
        startIndex: (page - 1) * CONTENT_PACK_PAGE_SIZE,
        limit: CONTENT_PACK_PAGE_SIZE
    });

    const goToPage = useCallback(
        (next: number) => {
            searchParams.set('page', String(next));
            setSearchParams(searchParams);
        },
        [searchParams, setSearchParams]
    );
    const goToPrevious = useCallback(
        () => goToPage(page - 1),
        [goToPage, page]
    );
    const goToNext = useCallback(() => goToPage(page + 1), [goToPage, page]);

    const onRetry = useCallback(() => {
        void packQuery.refetch();
        void itemsQuery.refetch();
    }, [packQuery, itemsQuery]);

    if (packQuery.isPending) {
        return <LoadingState variant='block' />;
    }

    /*
     * A 404 is "absent OR wholly inaccessible", and the contract makes those indistinguishable on
     * purpose. The surface says the one thing it is entitled to say and offers no retry, because a
     * retry cannot change the answer.
     */
    if (packQuery.isError && isNotFoundError(packQuery.error)) {
        return (
            <EmptyState
                title={globalize.translate('MessageContentPackUnavailable')}
            />
        );
    }

    if (packQuery.isError) {
        return (
            <ErrorState
                message={globalize.translate('ErrorDefault')}
                retryLabel={globalize.translate('Retry')}
                onRetry={onRetry}
            />
        );
    }

    const pack = packQuery.data;
    const totalPages = Math.max(
        1,
        Math.ceil(
            (itemsQuery.data?.totalRecordCount ?? 0) / CONTENT_PACK_PAGE_SIZE
        )
    );

    return (
        <Surface className='rf-content-pack'>
            <h1 data-content-packs='pack-name'>{pack?.Name}</h1>
            {pack?.Description ? (
                <p data-content-packs='pack-description'>{pack.Description}</p>
            ) : null}
            <p data-content-packs='pack-count'>
                {globalize.translate('ItemCount', pack?.VisibleItemCount ?? 0)}
            </p>

            {/*
             * Rename and delete for THIS pack, from the route that is showing it. Same dialogs,
             * same copy, same mutations as the mosaic's manager bar — see
             * ContentPackDetailActions. Rendered only once the pack is loaded, because both
             * actions name it.
             */}
            {pack ? <ContentPackDetailActions pack={pack} /> : null}

            <ContentPackItems
                itemsQuery={itemsQuery}
                apiClient={apiClient}
                imageAspect={presentation.mediaCard.imageAspect}
                label={pack?.Name ?? ''}
                page={page}
                totalPages={totalPages}
                onRetry={onRetry}
                onPreviousPage={goToPrevious}
                onNextPage={goToNext}
            />
        </Surface>
    );
};

export default ContentPackBrowse;
