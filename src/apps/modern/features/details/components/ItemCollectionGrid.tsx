import React, { type FC } from 'react';

import { MediaCard, MediaGrid, type MediaCardImageAspect } from 'ui';

import type { DetailItem } from '../adapters/itemDetailsApi';
import { scaledImageUrl } from '../adapters/itemDetailsApi';

interface ItemCollectionGridProps {
    items: DetailItem[];
    aspect?: MediaCardImageAspect;
    /** Accessible name when the enclosing section's heading is suppressed. */
    label?: string;
}

const primaryImageUrl = (item: DetailItem): string | undefined => {
    const tags = (item.ImageTags ?? {}) as Record<string, string>;
    if (!item.Id || !tags.Primary) return undefined;
    return scaledImageUrl(item, {
        type: 'Primary',
        tag: tags.Primary,
        maxWidth: 400
    });
};

const itemHref = (item: DetailItem): string =>
    `#/details?id=${item.Id ?? ''}&serverId=${item.ServerId ?? ''}`;

/**
 * A grid of items, in server order.
 *
 * `MUST PRESERVE` #3 makes the ORDER inside a section part of the contract; nothing here sorts, and
 * nothing here filters. The card is `ui`'s `MediaCard`, so this route composes through the published
 * design system rather than through `components/cardbuilder`, which invariant 11 forbids.
 */
const ItemCollectionGrid: FC<ItemCollectionGridProps> = ({
    items,
    aspect = 'poster',
    label
}) => (
    <MediaGrid
        aria-label={label}
        minItemWidth={aspect === 'backdrop' ? '260px' : undefined}
    >
        {items.map((item) => (
            <MediaCard
                key={item.Id ?? item.Name}
                title={item.Name ?? ''}
                subtitle={
                    item.ProductionYear
                        ? String(item.ProductionYear)
                        : undefined
                }
                imageUrl={primaryImageUrl(item)}
                imageAspect={aspect}
                href={itemHref(item)}
                className='itemDetailsCard'
            />
        ))}
    </MediaGrid>
);

export default ItemCollectionGrid;
