import React, { type FC } from 'react';

import { scaledImageUrl, type DetailItem } from '../adapters/itemDetailsApi';
import { hasBackdrop } from '../utils/itemPredicates';
import type { HeroLayout } from '../utils/itemDetailsRecipe';

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
 * the poster frame, exactly as `buildCardImage` always emitted a card. That is what keeps the
 * artwork layout stable across items with and without artwork.
 *
 * ## What the recipe's `hero` does here, and what it must not
 *
 * Every URL below is built the same way under every treatment. That is deliberate and it is what
 * the P7 ledger measures: `artwork.scaledImageUrl` records the DISTINCT OPTION SETS this component
 * asks for, so a treatment that skipped building one would change the ledger — a theme deciding
 * which requests the route makes, which RFC-0007 §6.1 forbids outright.
 *
 * What the treatment decides is which elements are RENDERED. `backdrop` is the only treatment that
 * emits the decorative backdrop layer, and it does so only when the item may have one and the user
 * has not turned the details banner off. `minimal` additionally drops the logotype. The poster is
 * rendered under all three, for every class.
 */
const DetailImage: FC<{ item: DetailItem; hero: HeroLayout }> = ({
    item,
    hero
}) => {
    const backdrop = hasBackdrop(item) ? backdropUrl(item) : null;
    const logo = logoUrl(item);
    const poster = posterUrl(item);

    return (
        <>
            {hero.backdrop ? (
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

            {logo && hero.logo ? (
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
