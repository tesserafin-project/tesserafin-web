import React, { type FC } from 'react';

import { scaledImageUrl, type DetailItem } from '../adapters/itemDetailsApi';
import { hasBackdrop } from '../utils/itemPredicates';

const tagsOf = (item: DetailItem) =>
    (item.ImageTags ?? {}) as Record<string, string | undefined>;

/** `logoImageUrl`: the item's own logo, else the parent's, else nothing. */
function logoUrl(item: DetailItem): string | null {
    const tags = tagsOf(item);
    if (tags.Logo) {
        return scaledImageUrl(item, { type: 'Logo', tag: tags.Logo });
    }
    if (item.ParentLogoImageTag && item.ParentLogoItemId) {
        return scaledImageUrl(
            { ...item, Id: item.ParentLogoItemId as string },
            { type: 'Logo', tag: item.ParentLogoImageTag as string }
        );
    }
    return null;
}

function posterUrl(item: DetailItem): string | null {
    const tags = tagsOf(item);
    if (!tags.Primary) return null;
    return scaledImageUrl(item, {
        type: 'Primary',
        tag: tags.Primary,
        maxWidth: 500
    });
}

function backdropUrl(item: DetailItem): string | null {
    const backdrops = (item.BackdropImageTags ?? []) as string[];
    if (!backdrops.length) return null;
    return scaledImageUrl(item, {
        type: 'Backdrop',
        tag: backdrops[0],
        maxWidth: 1920
    });
}

/**
 * The item's own artwork: backdrop, logo and poster.
 *
 * `MUST PRESERVE` #9: **a poster is always rendered**, and `Person` and `Book` never get a
 * backdrop. The first cut of this migration shipped with no item image at all and every section
 * assertion stayed green, because `.detailImageContainer` was a template element rather than a
 * named section in the frozen record. It is now asserted directly, per class, in
 * `itemDetails.characterization.test.tsx`.
 *
 * "Always rendered" means the ELEMENT, not the picture: an item with no primary image still gets
 * the poster frame, exactly as `buildCardImage` always emitted a card. That is what keeps the hero
 * layout stable across items with and without artwork.
 */
const DetailImage: FC<{ item: DetailItem }> = ({ item }) => {
    const backdrop = hasBackdrop(item) ? backdropUrl(item) : null;
    const logo = logoUrl(item);
    const poster = posterUrl(item);

    return (
        <>
            {hasBackdrop(item) ? (
                <div
                    className='rf-item-details__backdrop'
                    data-detail-backdrop
                    aria-hidden='true'
                    style={
                        backdrop
                            ? { backgroundImage: `url("${backdrop}")` }
                            : undefined
                    }
                />
            ) : null}

            <div className='rf-item-details__poster' data-detail-image='poster'>
                {poster ? (
                    <img
                        className='rf-item-details__poster-image'
                        src={poster}
                        alt=''
                    />
                ) : (
                    <span
                        className='rf-item-details__poster-placeholder'
                        aria-hidden='true'
                    />
                )}
            </div>

            {logo ? (
                <img
                    className='rf-item-details__logo'
                    data-detail-image='logo'
                    src={logo}
                    alt=''
                />
            ) : null}
        </>
    );
};

export default DetailImage;
