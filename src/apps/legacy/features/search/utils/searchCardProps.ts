import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';

import itemHelper from 'components/itemHelper';
import { appRouter } from 'components/router/appRouter';
import datetime from 'scripts/datetime';
import globalize from 'lib/globalize';
import type { MediaCardImageAspect, MediaCardLink, MediaCardProps } from 'ui';
import { getWatchState } from 'utils/watchState';

import type { SearchCardOptions } from '../types';

/**
 * Search results to `MediaCard` props (DEBT-WEB-1).
 *
 * The rows used to go through `cardBuilder`, configured by each section's `cardOptions`. Those
 * options are kept, and read here, so that every section still decides what its cards say — but
 * only the branches the search sections can reach are reproduced: shape, image choice, caption
 * lines and their links. What a card can DO (play, menu…) is `searchCardActions.tsx`'s job.
 */

export type ImageUrlBuilder = (
    itemId: string,
    imageType: string,
    tag: string
) => string;

const POSTER = 2 / 3;
const BACKDROP = 16 / 9;

/** Median aspect of a row's primary images, snapped like `imageLoader.getPrimaryImageAspectRatio`. */
const getRowAspect = (items: BaseItemDto[]): number | null => {
    const values = items
        .map((item) => item.PrimaryImageAspectRatio || 0)
        .filter(Boolean)
        .sort((a, b) => a - b);
    if (!values.length) return null;

    const half = Math.floor(values.length / 2);
    const median =
        values.length % 2
            ? values[half]
            : (values[half - 1] + values[half]) / 2;

    if (Math.abs(POSTER - median) <= 0.15) return POSTER;
    if (Math.abs(BACKDROP - median) <= 0.2) return BACKDROP;
    return median;
};

/**
 * One shape per ROW, as before: `autooverflow` picks it from the row's median image aspect (a
 * banner aspect has no `MediaCard` shape and is drawn as a backdrop), an explicit shape wins.
 */
export const getRowImageAspect = (
    items: BaseItemDto[],
    options: SearchCardOptions
): MediaCardImageAspect => {
    switch (options.shape) {
        case 'portrait':
            return 'poster';
        case 'square':
            return 'square';
        case 'backdrop':
            return 'backdrop';
        default: {
            const aspect = getRowAspect(items);
            if (!aspect) return 'square';
            if (aspect >= 1.33) return 'backdrop';
            if (aspect > 0.8) return 'square';
            return 'poster';
        }
    }
};

interface ImageChoice {
    itemId?: string | null;
    type: string;
    tag?: string | null;
}

/** `getCardImageUrl`'s order, limited to the options search sets (`preferThumb`, `inheritThumb`). */
const chooseImage = (
    item: BaseItemDto,
    options: SearchCardOptions
): ImageChoice | undefined => {
    const inherit = options.inheritThumb !== false;
    const tags = item.ImageTags ?? {};

    if (options.preferThumb && tags.Thumb)
        return { type: 'Thumb', tag: tags.Thumb };
    if (options.preferThumb && item.SeriesThumbImageTag && inherit)
        return {
            itemId: item.SeriesId,
            type: 'Thumb',
            tag: item.SeriesThumbImageTag
        };
    if (
        options.preferThumb &&
        item.ParentThumbItemId &&
        inherit &&
        item.MediaType !== 'Photo'
    )
        return {
            itemId: item.ParentThumbItemId,
            type: 'Thumb',
            tag: item.ParentThumbImageTag
        };
    if (options.preferThumb && item.BackdropImageTags?.length)
        return { type: 'Backdrop', tag: item.BackdropImageTags[0] };
    if (
        options.preferThumb &&
        item.ParentBackdropImageTags?.length &&
        inherit &&
        item.Type === 'Episode'
    )
        return {
            itemId: item.ParentBackdropItemId,
            type: 'Backdrop',
            tag: item.ParentBackdropImageTags[0]
        };
    if (tags.Primary && (item.Type !== 'Episode' || item.ChildCount !== 0))
        return { type: 'Primary', tag: tags.Primary };
    if (item.SeriesPrimaryImageTag)
        return {
            itemId: item.SeriesId,
            type: 'Primary',
            tag: item.SeriesPrimaryImageTag
        };
    if (item.ParentPrimaryImageTag)
        return {
            itemId: item.ParentPrimaryImageItemId,
            type: 'Primary',
            tag: item.ParentPrimaryImageTag
        };
    if (item.AlbumId && item.AlbumPrimaryImageTag)
        return {
            itemId: item.AlbumId,
            type: 'Primary',
            tag: item.AlbumPrimaryImageTag
        };
    if (item.BackdropImageTags?.length)
        return { type: 'Backdrop', tag: item.BackdropImageTags[0] };
    if (tags.Thumb) return { type: 'Thumb', tag: tags.Thumb };
    if (item.SeriesThumbImageTag && inherit)
        return {
            itemId: item.SeriesId,
            type: 'Thumb',
            tag: item.SeriesThumbImageTag
        };
    if (item.ParentThumbItemId && inherit)
        return {
            itemId: item.ParentThumbItemId,
            type: 'Thumb',
            tag: item.ParentThumbImageTag
        };
    if (item.ParentBackdropImageTags?.length && inherit)
        return {
            itemId: item.ParentBackdropItemId,
            type: 'Backdrop',
            tag: item.ParentBackdropImageTags[0]
        };
    return undefined;
};

const isLiveTvNaming = (type?: string | null) =>
    type === 'Program' ||
    type === 'LiveTvProgram' ||
    type === 'Timer' ||
    type === 'Recording';

const route = (item: Record<string, unknown>): string =>
    appRouter.getRouteUrl(item);

const yearText = (item: BaseItemDto): string | undefined => {
    const year = item.ProductionYear
        ? datetime.toLocaleString(item.ProductionYear, { useGrouping: false })
        : '';
    if (item.Type === 'Series') {
        if (item.Status === 'Continuing')
            return globalize.translate('SeriesYearToPresent', year);
        if (item.EndDate && item.ProductionYear) {
            const end = datetime.toLocaleString(
                datetime.parseISO8601Date(item.EndDate).getFullYear(),
                { useGrouping: false }
            );
            return year + (end === year ? '' : ' - ' + end);
        }
    }
    return year || undefined;
};

const airTimeText = (item: BaseItemDto, withDate?: boolean) => {
    if (!item.StartDate) return undefined;
    const date = datetime.parseISO8601Date(item.StartDate);
    return (
        (withDate
            ? datetime.toLocaleDateString(date, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric'
              }) + ' '
            : '') + datetime.getDisplayTime(date)
    );
};

/**
 * The caption, in `MediaCard` terms: the item's own name as the title, then the facts `cardBuilder`
 * printed under it (year, air time) and the destinations it linked (series, artists, channel).
 */
const getCaption = (
    item: BaseItemDto,
    options: SearchCardOptions,
    serverId?: string
): Pick<MediaCardProps, 'title' | 'subtitle' | 'subtitleLinks'> => {
    const ServerId = item.ServerId ?? serverId ?? undefined;
    const links: MediaCardLink[] = [];
    const facts: string[] = [];
    const parentTitleUnderneath =
        item.Type === 'MusicAlbum' ||
        item.Type === 'Audio' ||
        item.Type === 'MusicVideo';

    let title =
        options.showTitle === false && isLiveTvNaming(item.Type)
            ? (item.Name ?? '')
            : itemHelper.getDisplayName(item);

    if (options.showParentTitle && !parentTitleUnderneath) {
        if (
            (item.Type === 'Episode' || item.Type === 'Season') &&
            item.SeriesName
        ) {
            links.push({
                label: item.SeriesName,
                href: route({
                    Id: item.SeriesId,
                    ServerId,
                    Name: item.SeriesName,
                    Type: 'Series',
                    IsFolder: true
                })
            });
        } else if (item.SeriesName || item.Album || item.AlbumArtist) {
            facts.push(item.SeriesName || item.Album || item.AlbumArtist || '');
        }
    }

    if (options.showParentTitle && parentTitleUnderneath) {
        if (item.AlbumArtists?.length) {
            for (const artist of item.AlbumArtists) {
                links.push({
                    label: artist.Name ?? '',
                    href: route({
                        Id: artist.Id,
                        ServerId,
                        Name: artist.Name,
                        Type: 'MusicArtist',
                        IsFolder: true
                    })
                });
            }
        } else if (item.AlbumArtist || item.Album) {
            facts.push(item.AlbumArtist || item.Album || '');
        }
    }

    if (options.showParentTitleOrTitle && isLiveTvNaming(item.Type)) {
        title = item.Name ?? '';
    }

    if (item.ExtraType && item.ExtraType !== 'Unknown') {
        facts.push(globalize.translate(item.ExtraType));
    }

    if (options.showYear) {
        const year = yearText(item);
        if (year) facts.push(year);
    }

    if (options.showAirTime) {
        const air = airTimeText(item, options.showAirDateTime);
        if (air) facts.push(air);
    }

    if (options.showChannelName && item.ChannelName) {
        if (item.ChannelId) {
            links.push({
                label: item.ChannelName,
                href: route({
                    Id: item.ChannelId,
                    ServerId,
                    Name: item.ChannelName,
                    Type: 'TvChannel',
                    MediaType: item.MediaType,
                    IsFolder: false
                })
            });
        } else {
            facts.push(item.ChannelName);
        }
    }

    return {
        title: title ?? '',
        subtitle: facts.length ? facts.join(' · ') : undefined,
        subtitleLinks: links.length ? links : undefined
    };
};

export const toSearchCardProps = (
    item: BaseItemDto,
    options: SearchCardOptions,
    imageAspect: MediaCardImageAspect,
    imageUrl: ImageUrlBuilder | undefined,
    serverId?: string,
    /** TV layout: no secondary links, as `cardBuilder` drew plain text there. */
    plainText?: boolean
): MediaCardProps => {
    const source = (item as { ProgramInfo?: BaseItemDto }).ProgramInfo || item;
    const image = chooseImage(source, options);
    const imageItemId = image?.itemId || source.Id;
    const watch = getWatchState(item.UserData);
    const caption = getCaption(item, options, serverId);

    return {
        ...caption,
        subtitleLinks: plainText ? undefined : caption.subtitleLinks,
        subtitle: plainText
            ? [
                  caption.subtitle,
                  ...(caption.subtitleLinks ?? []).map((link) => link.label)
              ]
                  .filter(Boolean)
                  .join(' · ') || undefined
            : caption.subtitle,
        imageUrl:
            imageUrl && image?.tag && imageItemId
                ? imageUrl(imageItemId, image.type, image.tag)
                : undefined,
        imageAspect,
        progressPercent: watch.progressPercent,
        played: watch.played,
        playedLabel: globalize.translate('Watched'),
        href: route({ ...item, ServerId: item.ServerId ?? serverId })
    };
};
