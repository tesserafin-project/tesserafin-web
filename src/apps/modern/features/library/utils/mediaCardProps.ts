import globalize from 'lib/globalize';
import { ImageType } from 'lib/tesserafin-sdk';
import { getWatchState } from 'utils/watchState';

import type { ImageApiClient } from 'apps/modern/features/home/utils/mediaCardProps';
import type { ItemDto } from 'types/base/models/item-dto';
import type { MediaCardProps } from 'ui';

/**
 * `ItemDto` (`types/base/models/item-dto.ts`) to `ui`'s `MediaCardProps` adapter for
 * `/library/:libraryId` (RFC-0005 §11 WP-C step 4). `/home`'s own adapter
 * (`apps/modern/features/home/utils/mediaCardProps.ts`) does the same job but is typed against
 * `lib/tesserafin-sdk`'s `BaseItemDto` (RFC-0005 §4.2) - a different, non-assignable nominal type from
 * the `ItemDto` this route's grid works in, which `useLibraryItems` produces by casting its
 * `getItems` response to `ItemDtoQueryResult`. Rather than force a
 * generic cross-realm shared module (more coupling than the ~20 lines below are worth), this
 * re-implements only what a movies/tvshows grid card needs: `ImageApiClient` is re-imported
 * (type-only, no behavior duplicated) since `useApi().__legacyApiClient__` has the same shape either
 * way; the image-selection and href logic below are deliberately smaller than `/home`'s - no
 * thumb-preference, series-inherited image, or folder/library-tile href branches, since every item
 * in this grid is a leaf `Movie`/`Series` with its own primary image and its own details page.
 */
export type { ImageApiClient };

const getItemImageUrl = (
    item: ItemDto,
    apiClient: ImageApiClient | undefined
): string | undefined => {
    if (!apiClient) return undefined;

    const tag = item.ImageTags?.Primary;
    if (!item.Id || !tag) return undefined;

    return apiClient.getImageUrl(item.Id, {
        type: ImageType.Primary,
        tag,
        quality: 96
    });
};

/**
 * `Movie`/`Series` always link to the generic details page (mirrors `appRouter.getRouteUrl()`'s
 * fallback for non-folder/non-library items - series aren't folder tiles from this grid's point of
 * view, they still open their details page like a movie does).
 */
const getItemHref = (item: ItemDto, fallbackServerId?: string): string => {
    const id = item.Id ?? '';
    const serverId = item.ServerId ?? fallbackServerId ?? '';

    return `#/details?id=${id}&serverId=${serverId}`;
};

/**
 * @param imageAspect The shape the card is drawn at, resolved from
 * `presentation.page.library.cardAspect` by `utils/libraryRecipe.ts`. Required rather than
 * defaulted: a call site that forgot it would silently render the platform default under every
 * theme, which is the "control that does nothing" failure the binding exists to avoid.
 *
 * Note what this does NOT do: {@link getItemImageUrl} asks for `ImageType.Primary` at
 * `quality: 96` whatever the aspect is, so changing `cardAspect` changes the CSS box a card draws
 * into and issues the byte-identical image request for the byte-identical media item. A theme
 * cropping a poster is presentation; a theme choosing a different image endpoint would be a theme
 * changing what the client asks the server for.
 */
export const toMediaCardProps = (
    item: ItemDto,
    apiClient: ImageApiClient | undefined,
    imageAspect: MediaCardProps['imageAspect']
): MediaCardProps => {
    // The `ItemDto` type flattens `UserItemDataDto` onto the item, but the response it is cast from
    // nests it under `UserData`, as the server sends it. Reading the flattened field found nothing,
    // so no library card ever showed progress (WEB-UX-1).
    const watch = getWatchState(item.UserData);

    return {
        title: item.Name ?? '',
        subtitle: item.ProductionYear ? String(item.ProductionYear) : undefined,
        imageUrl: getItemImageUrl(item, apiClient),
        imageAspect,
        progressPercent: watch.progressPercent,
        played: watch.played,
        playedLabel: globalize.translate('Watched'),
        href: getItemHref(item, apiClient?.serverId?.())
    };
};

export const toMediaCardPropsArray = (
    items: ItemDto[] | null | undefined,
    apiClient: ImageApiClient | undefined,
    imageAspect: MediaCardProps['imageAspect']
): MediaCardProps[] =>
    (items ?? []).map((item) => toMediaCardProps(item, apiClient, imageAspect));
