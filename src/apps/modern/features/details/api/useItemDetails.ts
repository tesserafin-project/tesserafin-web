/**
 * The Item Details read model.
 *
 * One hook per logical read, each with the SAME entry condition the legacy controller used. That
 * matters more than it looks: invariant 16 forbids suppressing a required logical read merely
 * because rendering changed. `minimal-video`, `program` and both `recording` classes all issue
 * `getSimilarItems` and render no related section; every class issues `getItemCollections` and only
 * `movie` renders one. So the QUERY is gated on the legacy branch condition and the SECTION is
 * gated on the result — never the other way round.
 *
 * Every query key carries the server, the lookup kind and the lookup value, so a route change
 * cannot show a late response belonging to the previous item.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import {
    fetchAdditionalParts,
    fetchChannelGuide,
    fetchChildren,
    fetchCurrentUser,
    fetchItemCollections,
    fetchItemsByName,
    fetchLyrics,
    fetchMoreFromArtist,
    fetchMusicVideos,
    fetchNextUp,
    fetchPlaylistItems,
    fetchPrimaryItem,
    fetchSeasonEpisodes,
    fetchSeasons,
    fetchSeriesSchedule,
    fetchSeriesTimerSchedule,
    fetchSiblingEpisodes,
    fetchSimilarItems,
    fetchSpecialFeatures,
    getDetailsApiClient,
    type DetailItem,
    type DetailUser,
    type ItemList
} from '../adapters/itemDetailsApi';
import {
    ITEMS_BY_NAME_TYPES,
    SIMILAR_TYPES,
    hasMoreFromArtist
} from '../utils/itemPredicates';
import { detailsQueryKey, type DetailsRouteParams } from '../utils/routeParams';

export interface ItemDetailsPrimary {
    item: DetailItem;
    user: DetailUser;
}

/**
 * The primary read: the item and the acting user, together.
 *
 * The legacy route ran both in one `Promise.all` and treated either rejection as a single failure.
 * That grouping is behaviour — a page with an item but no user renders no permission-gated control
 * — so it is preserved rather than split into two independent queries.
 */
export function useItemDetailsPrimary(
    params: DetailsRouteParams
): UseQueryResult<ItemDetailsPrimary> {
    return useQuery({
        queryKey: detailsQueryKey(params),
        /*
         * A malformed route issues no request at all. The legacy `getPromise` threw synchronously
         * from inside a `Promise.all` argument list, escaping its own `.catch` (`SUSPECT` #1);
         * disabling the query is the migrated form of "there is nothing to ask for", and it leaves
         * retry policy to the application's client rather than overriding it here.
         */
        enabled: params.kind !== null,
        queryFn: async () => {
            const client = getDetailsApiClient(params.serverId);
            const [item, user] = await Promise.all([
                fetchPrimaryItem(client, params),
                fetchCurrentUser(client)
            ]);
            return { item, user };
        }
    });
}

type SectionQuery<T> = UseQueryResult<T>;

const sectionKey = (
    name: string,
    item: DetailItem | undefined,
    extra: unknown[] = []
) => ['itemDetails', name, item?.ServerId, item?.Id, ...extra] as const;

/** Seasons, episodes, items-by-name, playlist items or folder children, per type. */
export function useDetailChildren(
    item: DetailItem | undefined,
    user: DetailUser | undefined
): SectionQuery<ItemList> {
    const type = item?.Type;
    return useQuery({
        queryKey: sectionKey('children', item, [type]),
        enabled: Boolean(item && user && childrenKind(item) !== 'none'),
        queryFn: () => {
            const kind = childrenKind(item as DetailItem);
            switch (kind) {
                case 'seasons':
                    return fetchSeasons(item as DetailItem);
                case 'episodes':
                    return fetchSeasonEpisodes(item as DetailItem);
                case 'itemsByName':
                    return fetchItemsByName(
                        item as DetailItem,
                        user as DetailUser
                    );
                case 'playlist':
                    return fetchPlaylistItems(item as DetailItem);
                default:
                    return fetchChildren(item as DetailItem);
            }
        }
    });
}

export type ChildrenKind =
    | 'none'
    | 'seasons'
    | 'episodes'
    | 'itemsByName'
    | 'playlist'
    | 'folder';

/** `setInitialCollapsibleState`, restated. Which child read a type gets, if any. */
export function childrenKind(item: DetailItem): ChildrenKind {
    if (item.Type === 'Playlist') return 'playlist';
    if (ITEMS_BY_NAME_TYPES.includes(item.Type ?? '')) return 'itemsByName';
    if (item.Type === 'Series') return 'seasons';
    if (item.Type === 'Season') return 'episodes';
    if (item.IsFolder) return 'folder';
    return 'none';
}

/** The sibling-episode strip. Episodes only, and only with both parents known. */
export function useMoreFromSeason(
    item: DetailItem | undefined
): SectionQuery<ItemList> {
    return useQuery({
        queryKey: sectionKey('moreFromSeason', item),
        enabled: Boolean(
            item?.Type === 'Episode' && item.SeasonId && item.SeriesId
        ),
        queryFn: () => fetchSiblingEpisodes(item as DetailItem)
    });
}

export function useNextUp(
    item: DetailItem | undefined,
    user: DetailUser | undefined
): SectionQuery<ItemList> {
    return useQuery({
        queryKey: sectionKey('nextUp', item),
        enabled: Boolean(item?.Type === 'Series' && user),
        queryFn: () => fetchNextUp(item as DetailItem, user as DetailUser)
    });
}

export function useSeriesSchedule(
    item: DetailItem | undefined
): SectionQuery<ItemList> {
    return useQuery({
        queryKey: sectionKey('seriesSchedule', item),
        enabled: item?.Type === 'Series',
        queryFn: () => fetchSeriesSchedule(item as DetailItem)
    });
}

/**
 * The related surface.
 *
 * Gated on the legacy TYPE predicate, not on whether the section will render. Four classes issue
 * this read and show nothing — invariant 16 says that must stay true.
 */
export function useSimilarItems(
    item: DetailItem | undefined
): SectionQuery<ItemList> {
    return useQuery({
        queryKey: sectionKey('similar', item),
        enabled: Boolean(item && SIMILAR_TYPES.includes(item.Type ?? '')),
        queryFn: () => fetchSimilarItems(item as DetailItem)
    });
}

/** Every class issues this. Only some render a section from it. */
export function useItemCollections(
    item: DetailItem | undefined,
    user: DetailUser | undefined
): SectionQuery<DetailItem[]> {
    return useQuery({
        queryKey: sectionKey('collections', item),
        enabled: Boolean(item && user),
        queryFn: () =>
            fetchItemCollections(
                item as DetailItem,
                (user as DetailUser).Id as string
            )
    });
}

/** Special features. Read only when the item declares some — `SpecialFeatureCount`. */
export function useSpecialFeatures(
    item: DetailItem | undefined,
    user: DetailUser | undefined
): SectionQuery<DetailItem[]> {
    return useQuery({
        queryKey: sectionKey('specials', item),
        enabled: Boolean(
            item && user && ((item.SpecialFeatureCount as number) ?? 0) > 0
        ),
        queryFn: () =>
            fetchSpecialFeatures(item as DetailItem, user as DetailUser)
    });
}

/** Additional parts. Read only when the item declares more than one — `PartCount`. */
export function useAdditionalParts(
    item: DetailItem | undefined,
    user: DetailUser | undefined
): SectionQuery<ItemList> {
    return useQuery({
        queryKey: sectionKey('additionalParts', item),
        enabled: Boolean(item && user && ((item.PartCount as number) ?? 0) > 1),
        queryFn: () =>
            fetchAdditionalParts(item as DetailItem, user as DetailUser)
    });
}

export function useMusicVideos(
    item: DetailItem | undefined,
    user: DetailUser | undefined
): SectionQuery<ItemList> {
    return useQuery({
        queryKey: sectionKey('musicVideos', item),
        enabled: Boolean(item?.Type === 'MusicAlbum' && user),
        queryFn: () => fetchMusicVideos(item as DetailItem, user as DetailUser)
    });
}

export function useMoreFromArtist(
    item: DetailItem | undefined
): SectionQuery<ItemList> {
    return useQuery({
        queryKey: sectionKey('moreFromArtist', item),
        enabled: Boolean(item && hasMoreFromArtist(item)),
        queryFn: () => fetchMoreFromArtist(item as DetailItem)
    });
}

/**
 * Lyrics.
 *
 * `SUSPECT` #8 in the legacy route: the section was never hidden when `HasLyrics` was false,
 * because the whole block was skipped rather than the section cleared. Here the read is gated on
 * `HasLyrics` AND the type, and the section renders from the result — so a track without lyrics
 * shows no lyrics surface. Recorded as delta D5.
 */
export function useLyrics(
    item: DetailItem | undefined
): SectionQuery<{ Lyrics?: { Text?: string }[] }> {
    return useQuery({
        queryKey: sectionKey('lyrics', item),
        enabled: Boolean(item?.Type === 'Audio' && item?.HasLyrics),
        queryFn: () => fetchLyrics(item as DetailItem)
    });
}

export function useChannelGuide(
    item: DetailItem | undefined
): SectionQuery<ItemList> {
    return useQuery({
        queryKey: sectionKey('channelGuide', item),
        enabled: item?.Type === 'TvChannel',
        queryFn: () => fetchChannelGuide(item as DetailItem)
    });
}

/** The timers a series timer scheduled. Gated on `EnableLiveTvManagement`. */
export function useSeriesTimerSchedule(
    item: DetailItem | undefined,
    canManage: boolean
): SectionQuery<ItemList> {
    return useQuery({
        queryKey: sectionKey('seriesTimerSchedule', item),
        enabled: Boolean(item?.Type === 'SeriesTimer' && canManage),
        queryFn: () => fetchSeriesTimerSchedule(item as DetailItem)
    });
}
