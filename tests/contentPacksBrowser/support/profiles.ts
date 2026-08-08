/**
 * The authored server projections the Content packs browser suite runs against.
 *
 * Every count, every representative and every membership below is a LITERAL. Nothing here is
 * computed from an item array — see `fixtureApi.ts` for why that distinction is the whole point of
 * the no-leak and count scenarios.
 */
import {
    BOOK,
    EPISODE,
    MOVIE,
    MUSIC_ALBUM,
    UNARTED,
    USER_A,
    USER_B,
    type FixtureProfile
} from './fixtureApi';

/**
 * User A's view: three packs, in the server's order, deliberately NOT alphabetical.
 *
 * `Weeknights` is authored with `VisibleItemCount: 9` while its authorized page holds four items.
 * The two numbers disagree on purpose: the card must show `9` because that is what the server said,
 * and the browse route must never compare the two to hint that five more exist.
 */
export const MANAGER_A: FixtureProfile = {
    userId: USER_A,
    userName: 'Manager A',
    canManage: true,
    packs: [
        {
            Id: 'pack-weeknights',
            Name: 'Weeknights',
            Description: 'Short things, on a school night.',
            VisibleItemCount: 9,
            RepresentativeItemId: MOVIE.Id,
            items: [MOVIE, EPISODE, MUSIC_ALBUM, BOOK],
            visibleTotal: 4
        },
        {
            Id: 'pack-archive',
            Name: 'Archive',
            VisibleItemCount: 1,
            // The server declined to name a representative: the card must show its placeholder
            // rather than reaching for the first member.
            RepresentativeItemId: null,
            items: [UNARTED]
        },
        {
            Id: 'pack-empty',
            Name: 'Nothing yet',
            VisibleItemCount: 0,
            RepresentativeItemId: null,
            items: []
        }
    ],
    membership: { [MOVIE.Id]: ['pack-weeknights'] },
    items: [MOVIE, EPISODE, MUSIC_ALBUM, BOOK, UNARTED]
};

/** The same account without the capability. Everything is browsable; nothing is manageable. */
export const VIEWER_A: FixtureProfile = {
    ...MANAGER_A,
    userName: 'Viewer A',
    canManage: false
};

/**
 * An administrator WITHOUT `EnableContentPackManagement`.
 *
 * The gate is the capability and only the capability; the server publishes it precisely so a
 * deployment can separate the two. This profile is what proves the Web did not substitute the role.
 */
export const ADMIN_WITHOUT_CAPABILITY: FixtureProfile = {
    ...MANAGER_A,
    userName: 'Administrator A',
    canManage: false,
    isAdministrator: true
};

/**
 * User B's view of the SAME server.
 *
 * One pack in common with A, projected differently — a smaller visible count, a different
 * representative, a shorter authorized page — and `pack-archive` absent entirely, which is how the
 * M1 contract expresses "wholly inaccessible". `pack-solo` is B's alone.
 */
export const MANAGER_B: FixtureProfile = {
    userId: USER_B,
    userName: 'Manager B',
    canManage: true,
    packs: [
        {
            Id: 'pack-weeknights',
            Name: 'Weeknights',
            Description: 'Short things, on a school night.',
            VisibleItemCount: 2,
            RepresentativeItemId: BOOK.Id,
            items: [BOOK],
            visibleTotal: 1
        },
        {
            Id: 'pack-solo',
            Name: 'B only',
            VisibleItemCount: 1,
            RepresentativeItemId: MUSIC_ALBUM.Id,
            items: [MUSIC_ALBUM]
        }
    ],
    membership: { [BOOK.Id]: ['pack-weeknights'] },
    items: [BOOK, MUSIC_ALBUM]
};

/** No packs at all. The empty mosaic. */
export const MANAGER_EMPTY: FixtureProfile = {
    ...MANAGER_A,
    packs: [],
    membership: {}
};

/** A deep copy, so a scenario that mutates the fixture cannot leak into the next one. */
export const clone = (profile: FixtureProfile): FixtureProfile =>
    JSON.parse(JSON.stringify(profile)) as FixtureProfile;
