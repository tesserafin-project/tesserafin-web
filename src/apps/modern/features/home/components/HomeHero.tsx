import React, { type FC } from 'react';

import { playbackManager } from 'components/playback/playbackmanager';
import globalize from 'lib/globalize';
import datetime from 'scripts/datetime';
import type { BaseItemDto } from 'lib/tesserafin-sdk';
import { Ambient } from 'ui';

import { toMediaCardProps, type ImageApiClient } from '../utils/mediaCardProps';

import './HomeHero.scss';

export interface HomeHeroProps {
    /** Already-fetched Continue Watching items. Never fetched here. */
    resumeItems: BaseItemDto[] | null | undefined;
    /** Already-fetched Next Up items. Never fetched here. */
    nextUpItems: BaseItemDto[] | null | undefined;
    apiClient: ImageApiClient | undefined;
    /** The recipe's `backdrop: 'ambient'`: the artwork also stands, blurred, behind the page. */
    ambient?: boolean;
}

/**
 * The `hero` section of the Home recipe (RFC-0007 §4.7).
 *
 * ## It re-presents; it does not select
 *
 * The hero is composed ENTIRELY from data `HomeTab` has already fetched for Continue Watching and
 * Next Up. It issues no query of its own, and it must never grow one: a section that appears only
 * in some recipes and triggers a request would make the active theme decide what the client asks
 * the server for, which RFC-0007 §6.1 forbids.
 *
 * The item shown is the first resumable item, or the first Next Up item when there is nothing to
 * resume — the same "most immediately continuable thing" the shelves already lead with. That order
 * is fixed here, not in the recipe: a theme choosing WHICH item is featured would be media
 * selection, not presentation.
 *
 * ## The featured item is deliberately NOT removed from its shelf
 *
 * Continue Watching still shows it. De-duplicating would mean the presence of `hero` in a recipe
 * changed the contents of another section — a theme quietly filtering a list. Showing it twice is
 * the honest, boring behaviour: the hero is a second view of the same item, not a promotion of it.
 *
 * Renders nothing when neither list has an item, exactly like an empty shelf: a hero with no media
 * is not a composition anyone chose.
 *
 * ## Play plays
 *
 * The action starts playback at the saved position and says so, like the details Play button
 * (WEB-UX-1-R1); it used to be a link that only opened the details page. The title is that link.
 */
export const HomeHero: FC<HomeHeroProps> = ({
    resumeItems,
    nextUpItems,
    apiClient,
    ambient
}) => {
    const item = resumeItems?.[0] ?? nextUpItems?.[0];
    if (!item) return null;

    const position = item.UserData?.PlaybackPositionTicks ?? 0;

    const { title, subtitle, imageUrl, href } = toMediaCardProps(
        item,
        apiClient,
        { imageAspect: 'backdrop', preferThumb: true }
    );

    return (
        <section
            className='rf-home-hero'
            data-rf-slot='home-hero'
            aria-labelledby='rf-home-hero-title'
        >
            {/* The same URL as the artwork below, so the browser fetches it once. */}
            {imageUrl && ambient && <Ambient src={imageUrl} />}
            {imageUrl && (
                // Decorative: the title beside it is the accessible name of the region, so
                // announcing the artwork again would only repeat it (WCAG 1.1.1, decorative).
                // Not lazy: the hero is the first thing on the page, and lazy loading held its
                // largest paint back.
                <img className='rf-home-hero__image' src={imageUrl} alt='' />
            )}
            <div className='rf-home-hero__body'>
                <h2 className='rf-home-hero__title' id='rf-home-hero-title'>
                    <a href={href}>{title}</a>
                </h2>
                {subtitle && (
                    <p className='rf-home-hero__subtitle'>{subtitle}</p>
                )}
                <button
                    type='button'
                    className='rf-home-hero__action'
                    onClick={() => {
                        void playbackManager.play({
                            items: [item],
                            startPositionTicks: position
                        });
                    }}
                >
                    {position > 0
                        ? globalize.translate(
                              'ResumeAt',
                              datetime.getDisplayRunningTime(position)
                          )
                        : globalize.translate('Play')}
                </button>
            </div>
        </section>
    );
};

export default HomeHero;
