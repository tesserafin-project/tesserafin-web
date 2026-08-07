/**
 * The one place the Item Details slice reaches the server.
 *
 * Phase 3 requirement 10: where a legacy service remains necessary, isolate it behind a narrow
 * typed adapter, and keep the rendering components away from the legacy API client and the global
 * event buses. Every read below is one the frozen contract already records — the migration
 * preserves the request inventory member-for-member so that
 * `tests/fixtures/item-details/legacy-contract.json` can judge the migrated route unchanged.
 * `docs/tesserafin/item-details-migration.md` §2 records why that is deliberate and what it costs.
 *
 * Nothing here renders. Nothing that renders imports this.
 */
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields';
import { OutboundWebSocketMessageType } from '@jellyfin/sdk/lib/websocket';

import { ServerConnections } from 'lib/jellyfin-apiclient';

import type { DetailsRouteParams } from '../utils/routeParams';

/** A minimal structural view of the fields this route branches on. */
export interface DetailItem {
    Id?: string;
    Name?: string;
    Type?: string;
    MediaType?: string;
    ServerId?: string;
    IsFolder?: boolean;
    IsSeries?: boolean;
    [key: string]: unknown;
}

export interface DetailUser {
    Id?: string;
    Policy?: {
        IsAdministrator?: boolean;
        EnableLiveTvManagement?: boolean;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

export interface ItemList {
    Items?: DetailItem[];
    TotalRecordCount?: number;
}

/**
 * The legacy `apiClient` surface this route uses, named exactly as the frozen read inventory names
 * it. Typing it structurally rather than importing the client's own type keeps the adapter honest:
 * a member that is not listed here cannot be reached from the slice at all.
 */
interface LegacyApiClient {
    serverId(): string;
    getCurrentUserId(): string;
    getCurrentUser(): Promise<DetailUser>;
    getItem(userId: string, itemId: string): Promise<DetailItem>;
    getLiveTvSeriesTimer(id: string): Promise<DetailItem>;
    getGenre(name: string, userId: string): Promise<DetailItem>;
    getMusicGenre(name: string, userId: string): Promise<DetailItem>;
    getArtist(name: string, userId: string): Promise<DetailItem>;
    getSeasons(seriesId: string, options: object): Promise<ItemList>;
    getEpisodes(seriesId: string, options: object): Promise<ItemList>;
    getItems(userId: string, query: object): Promise<ItemList>;
    getSimilarItems(itemId: string, options: object): Promise<ItemList>;
    getNextUpEpisodes(options: object): Promise<ItemList>;
    getSpecialFeatures(userId: string, itemId: string): Promise<DetailItem[]>;
    getAdditionalVideoParts(userId: string, itemId: string): Promise<ItemList>;
    getLiveTvPrograms(options: object): Promise<ItemList>;
    getLiveTvTimers(options: object): Promise<ItemList>;
    getLiveTvProgram(id: string, userId: string): Promise<DetailItem>;
    getLiveTvChannel(id: string, userId: string): Promise<DetailItem>;
    getScaledImageUrl(itemId: string, options: object): string;
    getUrl(path: string): string;
    getJSON(url: string): Promise<ItemList>;
    ajax(options: object): Promise<unknown>;
    subscribe(
        messages: string[],
        handler: (message: { Data?: unknown }) => void
    ): () => void;
}

/**
 * The API client for this route.
 *
 * `serverId` selects the SERVER; it never selects the item. That is `MUST PRESERVE` #1 and the one
 * rule about `serverId` the migration may not relax.
 */
export function getDetailsApiClient(serverId?: string): LegacyApiClient {
    return (serverId
        ? ServerConnections.getApiClient(serverId)
        : ServerConnections.currentApiClient()) as unknown as LegacyApiClient;
}

function apiClientFor(item: DetailItem): LegacyApiClient {
    return ServerConnections.getApiClient(
        item.ServerId
    ) as unknown as LegacyApiClient;
}

/**
 * The primary read, chosen by the frozen precedence.
 *
 * `kind: null` is a bounded failure, not a throw. The legacy route threw synchronously from inside
 * a `Promise.all` argument list, escaping its own `.catch` and leaving the spinner up forever
 * (`SUSPECT` #1). Returning a rejected promise keeps the caller's error path reachable.
 */
export function fetchPrimaryItem(
    client: LegacyApiClient,
    params: DetailsRouteParams
): Promise<DetailItem> {
    const userId = client.getCurrentUserId();

    switch (params.kind) {
        case 'id':
            return client.getItem(userId, params.value);
        case 'seriesTimerId':
            return client.getLiveTvSeriesTimer(params.value);
        case 'genre':
            return client.getGenre(params.value, userId);
        case 'musicgenre':
            return client.getMusicGenre(params.value, userId);
        case 'musicartist':
            return client.getArtist(params.value, userId);
        default:
            return Promise.reject(new InvalidDetailsRouteError());
    }
}

/** A malformed `/details` URL. Carried as a value so the route can render a bounded error. */
export class InvalidDetailsRouteError extends Error {
    constructor() {
        super('Invalid request');
        this.name = 'InvalidDetailsRouteError';
    }
}

export function fetchCurrentUser(client: LegacyApiClient): Promise<DetailUser> {
    return client.getCurrentUser();
}

const CHILD_FIELDS =
    'ItemCounts,PrimaryImageAspectRatio,CanDelete,MediaSourceCount';

/** Seasons of a series, in server order. */
export function fetchSeasons(item: DetailItem): Promise<ItemList> {
    const client = apiClientFor(item);
    return client.getSeasons(item.Id as string, {
        userId: client.getCurrentUserId(),
        Fields: CHILD_FIELDS
    });
}

/** Episodes of a season, in server order. */
export function fetchSeasonEpisodes(item: DetailItem): Promise<ItemList> {
    const client = apiClientFor(item);
    return client.getEpisodes(item.SeriesId as string, {
        seasonId: item.Id,
        userId: client.getCurrentUserId(),
        Fields: `${CHILD_FIELDS},Overview`
    });
}

/** The sibling episodes of an episode — the More From Season strip. */
export function fetchSiblingEpisodes(item: DetailItem): Promise<ItemList> {
    const client = apiClientFor(item);
    return client.getEpisodes(item.SeriesId as string, {
        SeasonId: item.SeasonId,
        UserId: client.getCurrentUserId(),
        Fields: CHILD_FIELDS
    });
}

/** Generic folder children (`BoxSet`, `MusicAlbum`, items-by-name parents). */
export function fetchChildren(item: DetailItem): Promise<ItemList> {
    const client = apiClientFor(item);
    const query: Record<string, unknown> = {
        ParentId: item.Id,
        Fields: CHILD_FIELDS
    };

    if (item.Type === 'MusicAlbum') {
        query.SortBy = 'ParentIndexNumber,IndexNumber,SortName';
    } else if (item.Type === 'MusicArtist') {
        query.SortBy = 'PremiereDate,ProductionYear,SortName';
    } else if (item.Type !== 'BoxSet') {
        query.SortBy = 'SortName';
    }

    return client.getItems(client.getCurrentUserId(), query);
}

/** Items-by-name children: everything attributed to a person, genre, studio or artist. */
export function fetchItemsByName(
    item: DetailItem,
    user: DetailUser
): Promise<ItemList> {
    const client = apiClientFor(item);
    const query: Record<string, unknown> = {
        SortBy: 'SortName',
        SortOrder: 'Ascending',
        Recursive: true,
        Fields: CHILD_FIELDS,
        CollapseBoxSetItems: false
    };

    if (item.Type === 'MusicArtist') {
        query.ArtistIds = item.Id;
        query.SortBy = 'PremiereDate,ProductionYear,SortName';
    } else if (item.Type === 'MusicGenre') {
        query.GenreIds = item.Id;
    } else if (item.Type === 'Genre') {
        query.GenreIds = item.Id;
    } else if (item.Type === 'Studio') {
        query.StudioIds = item.Id;
    } else {
        query.PersonIds = item.Id;
    }

    return client.getItems(user.Id ?? client.getCurrentUserId(), query);
}

/** Playlist children, through the playlist item endpoint the legacy viewer used. */
export function fetchPlaylistItems(item: DetailItem): Promise<ItemList> {
    const client = apiClientFor(item);
    return client.getJSON(
        client.getUrl(
            `Playlists/${item.Id}/Items?UserId=${client.getCurrentUserId()}&Fields=${CHILD_FIELDS}`
        )
    );
}

export function fetchNextUp(
    item: DetailItem,
    user: DetailUser
): Promise<ItemList> {
    return apiClientFor(item).getNextUpEpisodes({
        SeriesId: item.Id,
        UserId: user.Id,
        Fields: 'MediaSourceCount'
    });
}

export function fetchSimilarItems(item: DetailItem): Promise<ItemList> {
    const client = apiClientFor(item);
    const options: Record<string, unknown> = {
        userId: client.getCurrentUserId(),
        limit: 12,
        fields: 'PrimaryImageAspectRatio,CanDelete'
    };

    const albumArtists = item.AlbumArtists as { Id?: string }[] | undefined;
    if (item.Type === 'MusicAlbum' && albumArtists?.length) {
        options.ExcludeArtistIds = albumArtists[0].Id;
    }

    return client.getSimilarItems(item.Id as string, options);
}

export function fetchSpecialFeatures(
    item: DetailItem,
    user: DetailUser
): Promise<DetailItem[]> {
    return apiClientFor(item).getSpecialFeatures(
        user.Id as string,
        item.Id as string
    );
}

export function fetchAdditionalParts(
    item: DetailItem,
    user: DetailUser
): Promise<ItemList> {
    return apiClientFor(item).getAdditionalVideoParts(
        user.Id as string,
        item.Id as string
    );
}

export function fetchMusicVideos(
    item: DetailItem,
    user: DetailUser
): Promise<ItemList> {
    return apiClientFor(item).getItems(user.Id as string, {
        SortBy: 'SortName',
        SortOrder: 'Ascending',
        IncludeItemTypes: 'MusicVideo',
        Recursive: true,
        Fields: 'PrimaryImageAspectRatio,CanDelete,MediaSourceCount',
        AlbumIds: item.Id
    });
}

export function fetchMoreFromArtist(item: DetailItem): Promise<ItemList> {
    const client = apiClientFor(item);
    const query: Record<string, unknown> = {
        IncludeItemTypes: 'MusicAlbum',
        Recursive: true,
        ExcludeItemIds: item.Id,
        SortBy: 'PremiereDate,ProductionYear,SortName',
        SortOrder: 'Descending'
    };

    if (item.Type === 'MusicArtist') {
        query.ContributingArtistIds = item.Id;
    } else {
        const albumArtists = (item.AlbumArtists ?? []) as { Id?: string }[];
        query.AlbumArtistIds = albumArtists.map((a) => a.Id).join(',');
    }

    return client.getItems(client.getCurrentUserId(), query);
}

export function fetchChannelGuide(item: DetailItem): Promise<ItemList> {
    const client = apiClientFor(item);
    return client.getLiveTvPrograms({
        ChannelIds: item.Id,
        UserId: client.getCurrentUserId(),
        HasAired: false,
        SortBy: 'StartDate',
        EnableTotalRecordCount: false,
        EnableImages: false,
        ImageTypeLimit: 0,
        EnableUserData: false
    });
}

export function fetchSeriesSchedule(item: DetailItem): Promise<ItemList> {
    const client = apiClientFor(item);
    return client.getLiveTvPrograms({
        UserId: client.getCurrentUserId(),
        ImageTypeLimit: 1,
        HasAired: false,
        SortBy: 'StartDate',
        EnableTotalRecordCount: false,
        Limit: 50,
        EnableUserData: false,
        Fields: 'ChannelInfo,ChannelImage',
        LibrarySeriesId: item.Id
    });
}

/**
 * The timers a series timer scheduled.
 *
 * The legacy route discarded the whole result when the first entry belonged to a different series
 * timer; that guard is preserved because the endpoint's filter is advisory.
 */
export function fetchSeriesTimerSchedule(item: DetailItem): Promise<ItemList> {
    const client = apiClientFor(item);
    return client
        .getLiveTvTimers({
            UserId: client.getCurrentUserId(),
            ImageTypeLimit: 1,
            SortBy: 'StartDate',
            EnableTotalRecordCount: false,
            EnableUserData: false,
            SeriesTimerId: item.Id,
            Fields: 'ChannelInfo,ChannelImage'
        })
        .then((result) => {
            const items = result.Items ?? [];
            if (items.length && items[0].SeriesTimerId !== item.Id) {
                return { Items: [], TotalRecordCount: 0 };
            }
            return result;
        });
}

export function fetchLyrics(
    item: DetailItem
): Promise<{ Lyrics?: { Text?: string }[] }> {
    const client = apiClientFor(item);
    return client.ajax({
        url: client.getUrl(`Audio/${item.Id}/Lyrics`),
        type: 'GET',
        dataType: 'json'
    }) as Promise<{ Lyrics?: { Text?: string }[] }>;
}

/** The collections an item belongs to. The one read on the SDK surface. */
export function fetchItemCollections(
    item: DetailItem,
    userId: string
): Promise<DetailItem[]> {
    const api = ServerConnections.getApi(item.ServerId);
    if (!api) return Promise.resolve([]);

    return getLibraryApi(api)
        .getItemCollections({
            itemId: item.Id as string,
            userId,
            fields: [ItemFields.PrimaryImageAspectRatio]
        })
        .then((response) => (response.data?.Items ?? []) as DetailItem[]);
}

/** The download URL for a downloadable item. A URL builder, not a request. */
export function itemDownloadUrl(item: DetailItem): string | null {
    const api = ServerConnections.getApi(item.ServerId);
    if (!api) return null;
    return getLibraryApi(api).getDownloadUrl({ itemId: item.Id as string });
}

/** The live-TV channel a programme airs on — the target `Play` uses for a `Program`. */
export function fetchProgramChannel(item: DetailItem): Promise<DetailItem> {
    const client = apiClientFor(item);
    return client.getLiveTvChannel(
        item.ChannelId as string,
        client.getCurrentUserId()
    );
}

/** A scaled image URL. A URL builder, not a request. */
export function scaledImageUrl(
    item: DetailItem,
    options: Record<string, unknown>
): string {
    return apiClientFor(item).getScaledImageUrl(item.Id as string, options);
}

/**
 * Subscribe to `UserDataChanged` for the acting user.
 *
 * Returns the unsubscribe function; the caller owns it. The legacy route bound this on `viewshow`
 * and released it on `viewbeforehide`; here it is an effect, so an unmount cannot leak it.
 */
export function subscribeToUserData(
    client: LegacyApiClient,
    handler: (message: { Data?: unknown }) => void
): () => void {
    return client.subscribe(
        [OutboundWebSocketMessageType.UserDataChanged],
        handler
    );
}
