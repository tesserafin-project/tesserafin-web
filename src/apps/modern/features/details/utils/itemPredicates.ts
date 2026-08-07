/**
 * The branch table of the legacy controller, restated as predicates.
 *
 * Every function here corresponds to a named branch site in
 * `src/apps/legacy/controllers/itemDetails/index.js`, recorded in
 * `docs/tesserafin/item-details-legacy-contract.md` §2. They exist as pure functions so the
 * composition can be asserted without rendering, and so a gate cannot drift into a component.
 *
 * Nothing here knows a theme, and nothing here is theme-controllable: these are the permission and
 * capability gates RFC-0007 §6.1 places outside the theme contract.
 */
import itemHelper from 'components/itemHelper';
import { playbackManager } from 'components/playback/playbackmanager';

import type { DetailItem, DetailUser } from '../adapters/itemDetailsApi';

/** Types whose children render as a list rather than as cards. */
export const LIST_VIEW_TYPES = ['MusicAlbum', 'Playlist', 'Season', 'Series'];

/** Types that get an items-by-name child list rather than a folder listing. */
export const ITEMS_BY_NAME_TYPES = [
    'Studio',
    'Person',
    'Genre',
    'MusicGenre',
    'MusicArtist'
];

/** Types the related surface is offered for. `renderSimilarItems`. */
export const SIMILAR_TYPES = [
    'Movie',
    'Trailer',
    'Series',
    'Program',
    'Recording',
    'MusicAlbum',
    'MusicArtist',
    'Playlist',
    'Audio'
];

const INSTANT_MIX_TYPES = ['Audio', 'MusicAlbum', 'MusicGenre', 'MusicArtist'];
const SHUFFLE_TYPES = ['MusicAlbum', 'MusicGenre', 'MusicArtist'];

/** Is a programme inside its airing window right now? */
export function isProgramAiring(item: DetailItem, now = new Date()): boolean {
    const start = item.StartDate ? new Date(item.StartDate as string) : null;
    const end = item.EndDate ? new Date(item.EndDate as string) : null;
    if (!start || !end) return false;
    return now >= start && now < end;
}

export interface PlaybackGates {
    /** `btnPlay` */
    canPlay: boolean;
    /** `btnReplay` — offered alongside play when a resume position exists. */
    isResumable: boolean;
    /** `btnInstantMix` */
    canInstantMix: boolean;
    /** `btnShuffle` */
    canShuffle: boolean;
}

/**
 * `reloadPlayButtons`, as a value.
 *
 * A `Program` is playable only inside its airing window, and never offers replay, instant mix or
 * shuffle. Everything else defers to the player's own capability answer.
 */
export function playbackGates(
    item: DetailItem,
    now = new Date()
): PlaybackGates {
    if (item.Type === 'Program') {
        return {
            canPlay: isProgramAiring(item, now),
            isResumable: false,
            canInstantMix: false,
            canShuffle: false
        };
    }

    if (!playbackManager.canPlay(item)) {
        return {
            canPlay: false,
            isResumable: false,
            canInstantMix: false,
            canShuffle: false
        };
    }

    const userData = item.UserData as
        | { PlaybackPositionTicks?: number }
        | undefined;

    return {
        canPlay: true,
        isResumable: (userData?.PlaybackPositionTicks ?? 0) > 0,
        canInstantMix: INSTANT_MIX_TYPES.includes(item.Type ?? ''),
        canShuffle:
            item.IsFolder === true || SHUFFLE_TYPES.includes(item.Type ?? '')
    };
}

/** `setTrailerButtonVisibility`. */
export function canPlayTrailer(item: DetailItem): boolean {
    const remote = item.RemoteTrailers as unknown[] | undefined;
    const hasTrailer =
        Boolean(item.LocalTrailerCount) || Boolean(remote?.length);
    return (
        hasTrailer &&
        playbackManager.getSupportedCommands().includes('PlayTrailers')
    );
}

/** `renderTrackSelections`' entry gate. */
export function canSelectMediaSource(item: DetailItem): boolean {
    const sources = item.MediaSources as unknown[] | undefined;
    return Boolean(
        sources?.length &&
            itemHelper.supportsMediaSourceSelection(item) &&
            playbackManager
                .getSupportedCommands()
                .includes('PlayMediaSource') &&
            playbackManager.canPlay(item)
    );
}

/** `MUST PRESERVE` #7: administrator-only, and only when a grouped source exists. */
export function canSplitVersions(item: DetailItem, user: DetailUser): boolean {
    const sources = (item.MediaSources ?? []) as { Type?: string }[];
    return Boolean(
        user.Policy?.IsAdministrator &&
            sources.some((source) => source.Type === 'Grouping')
    );
}

/** `MUST PRESERVE` #7: every live-TV editor is gated on `EnableLiveTvManagement`. */
export function canManageLiveTv(user: DetailUser): boolean {
    return Boolean(user.Policy?.EnableLiveTvManagement);
}

/** `renderTimerEditor` — the stop-recording action. */
export function canCancelTimer(item: DetailItem, user: DetailUser): boolean {
    return Boolean(
        item.Type === 'Recording' &&
            canManageLiveTv(user) &&
            item.TimerId &&
            item.Status === 'InProgress'
    );
}

/** `renderSeriesTimerEditor` — the cancel-series action and the schedule section. */
export function canCancelSeriesTimer(
    item: DetailItem,
    user: DetailUser
): boolean {
    return item.Type === 'SeriesTimer' && canManageLiveTv(user);
}

export function canMarkPlayed(item: DetailItem): boolean {
    return Boolean(itemHelper.canMarkPlayed(item));
}

export function canRate(item: DetailItem): boolean {
    return Boolean(itemHelper.canRate(item));
}

/** `renderHeaderBackdrop`: `Person` and `Book` only ever have a primary image. */
export function hasBackdrop(item: DetailItem): boolean {
    return item.Type !== 'Person' && item.Type !== 'Book';
}

/** `setPeopleHeader`: the cast heading differs for audio, albums, books and photos. */
export function peopleHeadingKey(item: DetailItem): string {
    if (
        item.MediaType === 'Audio' ||
        item.Type === 'MusicAlbum' ||
        item.MediaType === 'Book' ||
        item.MediaType === 'Photo'
    ) {
        return 'People';
    }
    return 'HeaderCastAndCrew';
}

/** `renderChildren`'s section heading. */
export function childrenHeadingKey(item: DetailItem): string {
    if (item.Type === 'Season') return 'Episodes';
    if (item.Type === 'Series') return 'HeaderSeasons';
    if (item.Type === 'MusicAlbum') return 'HeaderTracks';
    return 'Items';
}

/**
 * `renderChildren` hides its own heading for albums and seasons.
 *
 * Recorded because it is the reason `music-album` and `season` list no heading in the frozen
 * fixture despite rendering `listChildrenCollapsible`.
 */
export function childrenHeadingIsHidden(item: DetailItem): boolean {
    return item.Type === 'MusicAlbum' || item.Type === 'Season';
}

/** `renderMoreFromArtist`'s entry gate. */
export function hasMoreFromArtist(item: DetailItem): boolean {
    if (item.Type === 'MusicArtist' || item.Type === 'Audio') return true;
    const albumArtists = item.AlbumArtists as unknown[] | undefined;
    return item.Type === 'MusicAlbum' && Boolean(albumArtists?.length);
}

/** `inferContext` — the context the nested metadata lists used, in preference to `params.context`. */
export function inferContext(item: DetailItem): string | undefined {
    if (item.Type === 'Movie' || item.Type === 'BoxSet') return 'movies';
    if (
        item.Type === 'Series' ||
        item.Type === 'Season' ||
        item.Type === 'Episode'
    ) {
        return 'tvshows';
    }
    if (
        item.Type === 'MusicArtist' ||
        item.Type === 'MusicAlbum' ||
        item.Type === 'Audio' ||
        item.Type === 'AudioBook'
    ) {
        return 'music';
    }
    if (item.Type === 'Program') return 'livetv';
    return undefined;
}

/** Cast and guest cast, split the way `setInitialCollapsibleState` splits them. */
export function splitCast(item: DetailItem): {
    cast: DetailItem[];
    guestCast: DetailItem[];
} {
    const cast: DetailItem[] = [];
    const guestCast: DetailItem[] = [];

    for (const person of (item.People ?? []) as DetailItem[]) {
        if (person.Type === 'GuestStar') {
            guestCast.push(person);
        } else if (person.Type === 'Artist' || person.Type === 'AlbumArtist') {
            // Excluded until artists move to the persons endpoint. Preserved as-is.
            continue;
        } else {
            cast.push(person);
        }
    }

    return { cast, guestCast };
}

/** Chapters that can actually be shown: the legacy route drops the set when the first has no image. */
export function renderableChapters(item: DetailItem): DetailItem[] {
    const chapters = (item.Chapters ?? []) as DetailItem[];
    if (chapters.length && !chapters[0].ImageTag) return [];
    return chapters;
}
