import React, { type FC, useCallback, useMemo } from 'react';

import globalize from 'lib/globalize';
import type { BaseItemKind } from 'lib/tesserafin-sdk';
import { EmptyState, ErrorState, LoadingState, MediaCard, MediaGrid } from 'ui';

import { useLibraryGenres } from '../api/useLibraryDestinations';
import type { LibraryDensity } from '../utils/density';

export interface GenresDestinationProps {
    libraryId: string;
    primaryItemType: BaseItemKind;
    density: LibraryDensity;
}

/**
 * Genres — a destination, not a filter, because a genre is an **aggregate**, not an item (design
 * §3.1 criterion 1) and it comes from a different endpoint (`getGenres`) rather than a predicate on
 * `getItems` (criterion 2). Both criteria have to hold, and here both do.
 *
 * Each genre card opens **Browse pre-filtered** — `/library/:libraryId?genre=<name>` — which is the
 * concrete payoff of the arbitration: the genre list is one level of navigation, and choosing a
 * genre returns you to the canonical list with all of its controls (sort, AlphaPicker, view mode)
 * instead of a parallel, poorer grid.
 *
 * The link target uses the genre `Name`, not its `Id`, because Browse's genre filter is
 * `genres: [name]` on `getItems` (`useLibraryItems.ts`) — matching by id would need `genreIds`,
 * a different param, and would silently disagree with the genre `SortSelect` in the Browse bar.
 */
export const GenresDestination: FC<GenresDestinationProps> = ({
    libraryId,
    primaryItemType,
    density
}) => {
    const genresQuery = useLibraryGenres(
        libraryId
            ? { parentId: libraryId, includeItemTypes: [primaryItemType] }
            : undefined
    );

    const onRetry = useCallback(
        () => void genresQuery.refetch(),
        [genresQuery]
    );

    const cards = useMemo(
        () =>
            (genresQuery.data?.Items ?? [])
                .filter((genre) => !!genre.Name)
                .map((genre) => ({
                    title: genre.Name as string,
                    href: `#/library/${libraryId}?genre=${encodeURIComponent(
                        genre.Name as string
                    )}`
                })),
        [genresQuery.data?.Items, libraryId]
    );

    if (genresQuery.isPending) {
        return <LoadingState variant='grid' />;
    }

    if (genresQuery.isError) {
        return (
            <ErrorState
                message={globalize.translate('ErrorDefault')}
                retryLabel={globalize.translate('Retry')}
                onRetry={onRetry}
            />
        );
    }

    if (!cards.length) {
        return (
            <EmptyState
                title={globalize.translate('MessageNoGenresAvailable')}
            />
        );
    }

    return (
        <MediaGrid
            density={density}
            aria-label={globalize.translate('Genres')}
            // Genre cards carry a name, not a poster, so the poster-sized default column would
            // leave most of each card empty.
            minItemWidth='200px'
        >
            {cards.map((card) => (
                <MediaCard
                    key={card.href}
                    title={card.title}
                    href={card.href}
                    imageAspect='backdrop'
                />
            ))}
        </MediaGrid>
    );
};

export default GenresDestination;
