import React, { type FC, useCallback } from 'react';

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

import { useContentPacks } from '../api/useContentPackQueries';
import {
    contentPackHref,
    representativeImageUrl
} from '../utils/packCardProps';
import ContentPackManagerBar from './ContentPackManagerBar';

/**
 * `/contentpacks` — every pack this user may see, in the server's order (#138 §5).
 *
 * Four states, each an early return rather than a nested ternary, the same contract
 * `features/library/components/LibraryItemsGrid.tsx` follows.
 *
 * ## What each card is allowed to say
 *
 * The name, the server's `VisibleItemCount`, and artwork for the server's `RepresentativeItemId`.
 * Nothing else. In particular the mosaic never fetches a pack's memberships to count them or to
 * find a picture — a count derived that way would be "how many the client happened to receive" and
 * artwork chosen that way would be a choice the server declined to make.
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
    const onRetry = useCallback(() => void packsQuery.refetch(), [packsQuery]);

    if (packsQuery.isPending) {
        return (
            <LoadingState
                variant='grid'
                label={globalize.translate('ContentPacks')}
            />
        );
    }

    if (packsQuery.isError) {
        return (
            <ErrorState
                message={globalize.translate('ErrorDefault')}
                retryLabel={globalize.translate('Retry')}
                onRetry={onRetry}
            />
        );
    }

    const packs = packsQuery.data ?? [];

    return (
        <Surface className='rf-content-packs'>
            <ContentPackManagerBar packs={packs} />

            {packs.length === 0 ? (
                <EmptyState
                    title={globalize.translate('MessageNoContentPacks')}
                    description={globalize.translate(
                        'MessageContentPacksMosaic'
                    )}
                />
            ) : (
                <MediaGrid
                    density='comfortable'
                    aria-label={globalize.translate('ContentPacks')}
                >
                    {packs.map((pack) => (
                        <MediaCard
                            key={pack.Id}
                            title={pack.Name}
                            /*
                             * `VisibleItemCount` verbatim, including `0`: a pack that shows this
                             * user nothing says so, rather than hiding the number and letting the
                             * viewer assume it is unknown. `?? 0` covers only a DTO that omitted
                             * the field; it never stands in for a count computed here.
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
            )}
        </Surface>
    );
};

export default ContentPackMosaic;
