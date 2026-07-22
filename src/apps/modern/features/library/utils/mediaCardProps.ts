import { ImageType } from 'lib/tesserafin-sdk';

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

export const toMediaCardProps = (
    item: ItemDto,
    apiClient: ImageApiClient | undefined
): MediaCardProps => {
    // `ItemDto` (unlike the raw `BaseItemDto`) flattens `UserItemDataDto`'s fields directly onto the
    // item instead of nesting them under `UserData` (`types/base/models/item-dto.ts`'s `UserItem`
    // mixin omits `UserData`'s own `Key`/`ItemId`, which don't apply once flattened).
    const playedPercentage = item.PlayedPercentage ?? undefined;

    return {
        title: item.Name ?? '',
        subtitle: item.ProductionYear ? String(item.ProductionYear) : undefined,
        imageUrl: getItemImageUrl(item, apiClient),
        imageAspect: 'poster',
        progressPercent:
            playedPercentage && playedPercentage > 0 && playedPercentage < 100
                ? playedPercentage
                : undefined,
        href: getItemHref(item, apiClient?.serverId?.())
    };
};

export const toMediaCardPropsArray = (
    items: ItemDto[] | null | undefined,
    apiClient: ImageApiClient | undefined
): MediaCardProps[] =>
    (items ?? []).map((item) => toMediaCardProps(item, apiClient));
