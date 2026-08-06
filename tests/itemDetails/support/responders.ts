/**
 * Canned responses for every API member the legacy Item Details route is known to reach.
 *
 * This is a MENU, not a permission grant: each equivalence class declares the subset it is allowed
 * to touch (see `legacy-contract.json`), and {@link createFailClosedApi} throws on anything outside
 * that subset. Keeping the responses here rather than inline in the spec keeps the per-class
 * declaration a bare list of member names, which is what the contract document records.
 */
import { SERVER_ID, USER_ID } from '../../fixtures/item-details/items';

export interface ResponderOptions {
    item: Record<string, unknown>;
    /** Items returned by list-shaped reads, keyed by the member that returns them. */
    lists?: Record<string, unknown[]>;
    /** The alternate-version DTO returned by the SDK `getItem` when a version is switched. */
    alternateItem?: Record<string, unknown>;
    user: { Id: string; Policy: Record<string, unknown> };
}

const result = (items: unknown[]) => ({
    Items: items,
    TotalRecordCount: items.length
});

/** Every legacy `apiClient` member the route can reach, with a deterministic response. */
export function legacyResponders(options: ResponderOptions) {
    const list = (key: string) => result(options.lists?.[key] ?? []);
    return {
        getCurrentUserId: () => USER_ID,
        serverId: () => SERVER_ID,
        getCurrentUser: () => Promise.resolve(options.user),
        getItem: () => Promise.resolve(options.item),
        getLiveTvSeriesTimer: () => Promise.resolve(options.item),
        getGenre: () => Promise.resolve(options.item),
        getMusicGenre: () => Promise.resolve(options.item),
        getArtist: () => Promise.resolve(options.item),
        getSeasons: () => Promise.resolve(list('getSeasons')),
        getEpisodes: () => Promise.resolve(list('getEpisodes')),
        getItems: () => Promise.resolve(list('getItems')),
        getSimilarItems: () => Promise.resolve(list('getSimilarItems')),
        getNextUpEpisodes: () => Promise.resolve(list('getNextUpEpisodes')),
        getSpecialFeatures: () =>
            Promise.resolve(options.lists?.getSpecialFeatures ?? []),
        getAdditionalVideoParts: () =>
            Promise.resolve(list('getAdditionalVideoParts')),
        getLiveTvPrograms: () => Promise.resolve(list('getLiveTvPrograms')),
        getLiveTvTimers: () => Promise.resolve(list('getLiveTvTimers')),
        getLiveTvProgram: () => Promise.resolve(options.item),
        getLiveTvChannel: () =>
            Promise.resolve({
                Id: 'channel-1',
                ServerId: SERVER_ID,
                Type: 'TvChannel'
            }),
        getScaledImageUrl: (id: string) => `image://${id}`,
        getUrl: (path: string) => `https://server.invalid/${path}`,
        ajax: () => Promise.resolve({ Lyrics: [{ Text: 'a lyric line' }] }),
        getJSON: () => Promise.resolve(list('getJSON')),
        subscribe: () => () => undefined
    } satisfies Record<string, unknown>;
}

/** Every `getLibraryApi(api)` member the route can reach. */
export function sdkResponders(options: ResponderOptions) {
    return {
        getItemCollections: () =>
            Promise.resolve({
                data: result(options.lists?.getItemCollections ?? [])
            }),
        getItem: () =>
            Promise.resolve({ data: options.alternateItem ?? options.item }),
        getDownloadUrl: () => 'https://server.invalid/download'
    } satisfies Record<string, unknown>;
}

/** Narrow a responder menu to the members an equivalence class declares. */
export function pick<T extends Record<string, unknown>>(
    menu: T,
    allowed: readonly string[]
): Record<string, unknown> {
    const picked: Record<string, unknown> = {};
    for (const name of allowed) {
        if (!(name in menu)) {
            throw new Error(
                `[item-details characterization] "${name}" is declared in the read inventory but ` +
                    'has no responder. Add it to tests/itemDetails/support/responders.ts.'
            );
        }
        picked[name] = menu[name];
    }
    return picked;
}
