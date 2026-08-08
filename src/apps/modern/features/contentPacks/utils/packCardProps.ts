/**
 * One pack DTO to one `ui` `MediaCard` (#138 §5).
 *
 * Pure, and separate from the mosaic component, because the two rules it encodes are the ones most
 * worth being able to test on their own:
 *
 *  1. The count shown is `VisibleItemCount`, verbatim. It is never derived from a membership list,
 *     never compared against `TotalRecordCount`, and never replaced by "how many we happened to
 *     fetch". It is the server's answer about what THIS user may see.
 *  2. The artwork is the image of `RepresentativeItemId` and of nothing else. When the server sends
 *     no representative, the card renders its placeholder — it does NOT fall back to the first
 *     member, because picking one would mean fetching a membership list this surface has no reason
 *     to have and choosing artwork the server declined to choose.
 */
import type { ContentPackDto } from '../adapters/contentPacksApi';

/**
 * The `apiClient` slice needed to build an image URL — the same narrow shape
 * `features/home/utils/mediaCardProps.ts` declares, for the same reason: a test can pass a plain
 * object instead of a full `ApiClient`.
 */
export interface PackImageApiClient {
    getImageUrl(itemId: string, options?: Record<string, unknown>): string;
}

/** Route of one pack. The identifier is encoded for the URL and otherwise untouched. */
export const contentPackHref = (packId: string): string =>
    `#/contentpacks/${encodeURIComponent(packId)}`;

/**
 * Artwork for one pack, or `undefined`.
 *
 * `undefined` is a real answer here, not a failure: a pack whose representative the server did not
 * name, or one whose representative is not something this client can build a URL for, shows the
 * card's placeholder.
 */
export const representativeImageUrl = (
    pack: ContentPackDto,
    apiClient: PackImageApiClient | undefined
): string | undefined => {
    const representativeItemId = pack.RepresentativeItemId;
    if (!representativeItemId || !apiClient) return undefined;

    return apiClient.getImageUrl(representativeItemId, {
        type: 'Primary',
        quality: 96
    });
};
