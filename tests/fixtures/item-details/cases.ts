/**
 * One case per behavioural equivalence class in `legacy-contract.json`.
 *
 * The case supplies the route parameters, the primary item DTO, the acting user and the list
 * results the class's reads return. It supplies NO expectations: those live in the contract
 * fixture, so the document, the fixture and the test cannot drift apart quietly.
 */
import * as fixtures from './items';

export interface ItemDetailsCase {
    /** Must match a `classes[].id` in `legacy-contract.json`. */
    id: string;
    params: Record<string, string>;
    item: Record<string, unknown>;
    user: fixtures.FixtureUser;
    lists?: Record<string, unknown[]>;
}

const SERVER_ID = fixtures.SERVER_ID;

const child = (id: string, name: string, type: string, extra = {}) => ({
    Id: id,
    Name: name,
    Type: type,
    ServerId: SERVER_ID,
    ...extra
});

export const ITEM_DETAILS_CASES: ItemDetailsCase[] = [
    {
        id: 'movie',
        params: { id: 'movie-1' },
        item: fixtures.movie(),
        user: fixtures.ADMIN_USER,
        lists: {
            getSimilarItems: [child('sim-1', 'Similar', 'Movie')],
            getSpecialFeatures: [child('sp-1', 'Special', 'Video')],
            getAdditionalVideoParts: [child('part-2', 'Part 2', 'Video')],
            getItemCollections: [child('boxset-1', 'A Collection', 'BoxSet')]
        }
    },
    {
        id: 'movie-resumable',
        params: { id: 'movie-1' },
        item: fixtures.movieResumable(),
        user: fixtures.REGULAR_USER
    },
    {
        id: 'minimal-video',
        params: { id: 'minimal-1' },
        item: fixtures.minimalVideo(),
        user: fixtures.REGULAR_USER
    },
    {
        id: 'series',
        params: { id: 'series-1' },
        item: fixtures.series(),
        user: fixtures.REGULAR_USER,
        lists: {
            getSeasons: [child('season-1', 'Season 1', 'Season')],
            getNextUpEpisodes: [child('episode-1', 'An Episode', 'Episode')]
        }
    },
    {
        id: 'season',
        params: { id: 'season-1' },
        item: fixtures.season(),
        user: fixtures.REGULAR_USER,
        lists: {
            getEpisodes: [
                child('episode-1', 'An Episode', 'Episode'),
                child('episode-2', 'Another', 'Episode')
            ]
        }
    },
    {
        id: 'episode',
        params: { id: 'episode-1' },
        item: fixtures.episode(),
        user: fixtures.REGULAR_USER,
        lists: {
            getEpisodes: [
                child('episode-1', 'An Episode', 'Episode'),
                child('episode-2', 'Another', 'Episode')
            ]
        }
    },
    {
        id: 'music-album',
        params: { id: 'album-1' },
        item: fixtures.musicAlbum(),
        user: fixtures.REGULAR_USER,
        lists: {
            getItems: [
                child('audio-1', 'A Track', 'Audio', {
                    ArtistItems: [{ Id: 'artist-1' }],
                    AlbumArtists: [{ Id: 'artist-1' }],
                    ParentIndexNumber: 1
                })
            ]
        }
    },
    {
        id: 'audio',
        params: { id: 'audio-1' },
        item: fixtures.audio(),
        user: fixtures.REGULAR_USER
    },
    {
        id: 'music-artist',
        params: { id: 'artist-1' },
        item: fixtures.musicArtist(),
        user: fixtures.REGULAR_USER
    },
    {
        id: 'playlist',
        params: { id: 'playlist-1' },
        item: fixtures.playlist(),
        user: fixtures.REGULAR_USER
    },
    {
        id: 'box-set',
        params: { id: 'boxset-1' },
        item: fixtures.boxSet(),
        user: fixtures.REGULAR_USER,
        lists: { getItems: [child('movie-1', 'A Movie', 'Movie')] }
    },
    {
        id: 'person',
        params: { id: 'person-1' },
        item: fixtures.person(),
        user: fixtures.REGULAR_USER
    },
    {
        id: 'book',
        params: { id: 'book-1' },
        item: fixtures.book(),
        user: fixtures.REGULAR_USER
    },
    {
        id: 'photo',
        params: { id: 'photo-1' },
        item: fixtures.photo(),
        user: fixtures.REGULAR_USER
    },
    {
        id: 'program',
        params: { id: 'program-1' },
        item: fixtures.program(),
        user: fixtures.ADMIN_USER
    },
    {
        id: 'recording',
        params: { id: 'recording-1' },
        item: fixtures.recording(),
        user: fixtures.ADMIN_USER
    },
    {
        id: 'series-timer',
        params: { seriesTimerId: 'seriestimer-1' },
        item: fixtures.seriesTimer(),
        user: fixtures.ADMIN_USER
    },
    {
        id: 'tv-channel',
        params: { id: 'channel-1' },
        item: fixtures.tvChannel(),
        user: fixtures.REGULAR_USER,
        lists: {
            getLiveTvPrograms: [
                child('program-1', 'A Programme', 'Program', {
                    StartDate: '2000-01-01T00:00:00.0000000Z',
                    EndDate: '2000-01-01T01:00:00.0000000Z'
                })
            ]
        }
    },
    {
        id: 'genre',
        params: { genre: 'Drama' },
        item: fixtures.genre(),
        user: fixtures.REGULAR_USER
    },
    {
        id: 'music-genre',
        params: { musicgenre: 'Jazz' },
        item: fixtures.musicGenre(),
        user: fixtures.REGULAR_USER
    }
];
