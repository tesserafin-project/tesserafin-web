/**
 * Item fixtures for the legacy Item Details characterization suite.
 *
 * One entry per BEHAVIOURAL EQUIVALENCE CLASS, derived from the controller's own branch sites
 * (`src/apps/legacy/controllers/itemDetails/index.js`) rather than from intuition about item
 * types. `docs/tesserafin/item-details-legacy-contract.md` §2 records how each class was derived
 * and which types collapse into it.
 *
 * These DTOs are deliberately minimal: they carry only the fields the controller branches on.
 * A field that appears here is a field the route's behaviour depends on.
 */

export const SERVER_ID = 'server-1';
export const USER_ID = 'user-1';

export interface FixtureUser {
    Id: string;
    Policy: {
        IsAdministrator?: boolean;
        EnableLiveTvManagement?: boolean;
    };
}

export const REGULAR_USER: FixtureUser = {
    Id: USER_ID,
    Policy: { IsAdministrator: false, EnableLiveTvManagement: false }
};

export const ADMIN_USER: FixtureUser = {
    Id: USER_ID,
    Policy: { IsAdministrator: true, EnableLiveTvManagement: true }
};

const base = (over: Record<string, unknown>) => ({
    ServerId: SERVER_ID,
    ImageTags: {},
    ...over
});

/** A video media source with one video, two audio and two subtitle streams. */
export const multiTrackSource = (id: string, name: string) => ({
    Id: id,
    Name: name,
    Type: 'Default',
    DefaultAudioStreamIndex: 1,
    DefaultSubtitleStreamIndex: 3,
    MediaStreams: [
        {
            Index: 0,
            Type: 'Video',
            Codec: 'h264',
            DisplayTitle: '1080p H264',
            Width: 1920,
            Height: 1080
        },
        {
            Index: 1,
            Type: 'Audio',
            DisplayTitle: 'English AAC',
            IsExternal: false,
            IsForced: false,
            IsDefault: true
        },
        {
            Index: 2,
            Type: 'Audio',
            DisplayTitle: 'French AC3',
            IsExternal: false,
            IsForced: false,
            IsDefault: false
        },
        {
            Index: 3,
            Type: 'Subtitle',
            DisplayTitle: 'English SRT',
            IsExternal: true,
            IsForced: false,
            IsDefault: true
        },
        {
            Index: 4,
            Type: 'Subtitle',
            DisplayTitle: 'French PGS',
            IsExternal: false,
            IsForced: false,
            IsDefault: false
        }
    ]
});

/** MOVIE — the richest playable-standalone-video class. */
export const movie = () =>
    base({
        Id: 'movie-1',
        Name: 'A Movie',
        Type: 'Movie',
        MediaType: 'Video',
        IsFolder: false,
        CanDelete: true,
        Overview: 'An overview.',
        Taglines: ['A tagline.'],
        Tags: ['tag-a'],
        HomePageUrl: 'https://example.invalid/movie',
        ExternalUrls: [{ Name: 'IMDb', Url: 'https://example.invalid/imdb' }],
        Genres: ['Drama'],
        GenreItems: [{ Id: 'genre-1', Name: 'Drama' }],
        Studios: [{ Id: 'studio-1', Name: 'A Studio' }],
        LocalTrailerCount: 1,
        SpecialFeatureCount: 2,
        PartCount: 2,
        Chapters: [
            { Name: 'Chapter 1', StartPositionTicks: 0, ImageTag: 'c1' }
        ],
        People: [
            { Id: 'p-1', Name: 'A Director', Type: 'Director' },
            { Id: 'p-2', Name: 'An Actor', Type: 'Actor' },
            { Id: 'p-3', Name: 'A Guest', Type: 'GuestStar' }
        ],
        UserData: { Key: 'movie-1', PlaybackPositionTicks: 0, Played: false },
        MediaSources: [
            multiTrackSource('movie-1', 'Version A'),
            multiTrackSource('movie-1-alt', 'Version B')
        ]
    });

/** MOVIE, resumable — same class, different user-data state. */
export const movieResumable = () => {
    const item = movie();
    item.UserData = {
        Key: 'movie-1',
        PlaybackPositionTicks: 6000000000,
        Played: false
    };
    return item;
};

/**
 * MOVIE with a grouped alternate version — the only shape that can reveal `btnSplitVersions`.
 *
 * `reloadFromItem` reveals that control on `user.Policy.IsAdministrator && groupedVersions.length`,
 * where a grouped version is a media source of `Type: 'Grouping'`. Without such a source the
 * control is hidden for every user, so the administrator gate cannot be observed at all.
 */
export const movieWithGroupedVersions = () => {
    const item = movie();
    item.Id = 'movie-grouped';
    item.UserData = {
        Key: 'movie-grouped',
        PlaybackPositionTicks: 0,
        Played: false
    };
    item.MediaSources = [
        multiTrackSource('movie-grouped', 'Version A'),
        {
            ...multiTrackSource('movie-grouped-alt', 'Version B'),
            Type: 'Grouping'
        }
    ];
    return item;
};

/** MINIMAL — a playable video with none of the optional data. */
export const minimalVideo = () =>
    base({
        Id: 'minimal-1',
        Name: 'Minimal',
        Type: 'Movie',
        MediaType: 'Video',
        IsFolder: false,
        People: [],
        UserData: { Key: 'minimal-1', PlaybackPositionTicks: 0 },
        MediaSources: [
            {
                Id: 'minimal-1',
                Name: 'Minimal',
                Type: 'Default',
                MediaStreams: []
            }
        ]
    });

export const series = () =>
    base({
        Id: 'series-1',
        Name: 'A Series',
        Type: 'Series',
        IsFolder: true,
        IsSeries: true,
        Status: 'Continuing',
        AirDays: ['Monday'],
        AirTime: '20:00',
        Overview: 'Series overview.',
        People: [{ Id: 'p-2', Name: 'An Actor', Type: 'Actor' }],
        UserData: { Key: 'series-1' }
    });

export const season = () =>
    base({
        Id: 'season-1',
        Name: 'Season 1',
        Type: 'Season',
        IsFolder: true,
        IsSeries: true,
        SeriesId: 'series-1',
        SeriesName: 'A Series',
        IndexNumber: 1,
        People: [],
        UserData: { Key: 'season-1' }
    });

export const episode = () =>
    base({
        Id: 'episode-1',
        Name: 'An Episode',
        Type: 'Episode',
        MediaType: 'Video',
        IsFolder: false,
        SeriesId: 'series-1',
        SeriesName: 'A Series',
        SeasonId: 'season-1',
        SeasonName: 'Season 1',
        IndexNumber: 3,
        ParentIndexNumber: 1,
        People: [],
        UserData: { Key: 'episode-1', PlaybackPositionTicks: 0 },
        MediaSources: [
            {
                Id: 'episode-1',
                Name: 'Episode',
                Type: 'Default',
                MediaStreams: []
            }
        ]
    });

export const musicAlbum = () =>
    base({
        Id: 'album-1',
        Name: 'An Album',
        Type: 'MusicAlbum',
        IsFolder: true,
        AlbumArtists: [{ Id: 'artist-1', Name: 'An Artist' }],
        ArtistItems: [{ Id: 'artist-1', Name: 'An Artist' }],
        People: [{ Id: 'artist-1', Name: 'An Artist', Type: 'AlbumArtist' }],
        UserData: { Key: 'album-1' }
    });

export const audio = () =>
    base({
        Id: 'audio-1',
        Name: 'A Track',
        Type: 'Audio',
        MediaType: 'Audio',
        IsFolder: false,
        HasLyrics: true,
        Album: 'An Album',
        AlbumId: 'album-1',
        AlbumArtists: [{ Id: 'artist-1', Name: 'An Artist' }],
        ArtistItems: [{ Id: 'artist-1', Name: 'An Artist' }],
        People: [],
        UserData: { Key: 'audio-1', PlaybackPositionTicks: 0 },
        MediaSources: [
            {
                Id: 'audio-1',
                Name: 'A Track',
                Type: 'Default',
                MediaStreams: []
            }
        ]
    });

export const musicArtist = () =>
    base({
        Id: 'artist-1',
        Name: 'An Artist',
        Type: 'MusicArtist',
        IsFolder: true,
        People: [],
        UserData: { Key: 'artist-1' }
    });

export const playlist = () =>
    base({
        Id: 'playlist-1',
        Name: 'A Playlist',
        Type: 'Playlist',
        IsFolder: true,
        People: [],
        UserData: { Key: 'playlist-1' }
    });

export const boxSet = () =>
    base({
        Id: 'boxset-1',
        Name: 'A Collection',
        Type: 'BoxSet',
        IsFolder: true,
        People: [],
        UserData: { Key: 'boxset-1' }
    });

export const person = () =>
    base({
        Id: 'person-1',
        Name: 'A Person',
        Type: 'Person',
        IsFolder: false,
        PremiereDate: '1970-01-01T00:00:00.0000000Z',
        ProductionLocations: ['Somewhere'],
        Overview: 'A biography.',
        People: [],
        UserData: { Key: 'person-1' }
    });

export const book = () =>
    base({
        Id: 'book-1',
        Name: 'A Book',
        Type: 'Book',
        MediaType: 'Book',
        IsFolder: false,
        CanDownload: true,
        Path: '/media/books/a-book.epub',
        People: [{ Id: 'p-4', Name: 'An Author', Type: 'Author' }],
        UserData: { Key: 'book-1' },
        MediaSources: [
            { Id: 'book-1', Name: 'A Book', Type: 'Default', MediaStreams: [] }
        ]
    });

export const photo = () =>
    base({
        Id: 'photo-1',
        Name: 'A Photo',
        Type: 'Photo',
        MediaType: 'Photo',
        IsFolder: false,
        People: [],
        UserData: { Key: 'photo-1' }
    });

export const program = () =>
    base({
        Id: 'program-1',
        Name: 'A Programme',
        Type: 'Program',
        MediaType: 'Video',
        IsFolder: false,
        ChannelId: 'channel-1',
        Tags: ['ignored-tag'],
        // Deliberately in the past so the airing window is closed and `btnPlay` stays hidden.
        StartDate: '2000-01-01T00:00:00.0000000Z',
        EndDate: '2000-01-01T01:00:00.0000000Z',
        People: [],
        UserData: { Key: 'program-1' }
    });

export const recording = () =>
    base({
        Id: 'recording-1',
        Name: 'A Recording',
        Type: 'Recording',
        MediaType: 'Video',
        IsFolder: false,
        Status: 'InProgress',
        TimerId: 'timer-1',
        People: [],
        UserData: { Key: 'recording-1', PlaybackPositionTicks: 0 },
        MediaSources: [
            {
                Id: 'recording-1',
                Name: 'A Recording',
                Type: 'Default',
                MediaStreams: []
            }
        ]
    });

export const seriesTimer = () =>
    base({
        Id: 'seriestimer-1',
        Name: 'A Series Timer',
        Type: 'SeriesTimer',
        IsFolder: false,
        StartDate: '2026-01-01T20:00:00.0000000Z',
        EndDate: '2026-01-01T21:00:00.0000000Z',
        People: []
    });

export const tvChannel = () =>
    base({
        Id: 'channel-1',
        Name: 'A Channel',
        Type: 'TvChannel',
        MediaType: 'Video',
        IsFolder: false,
        People: [],
        UserData: { Key: 'channel-1' },
        MediaSources: [
            {
                Id: 'channel-1',
                Name: 'A Channel',
                Type: 'Default',
                MediaStreams: []
            }
        ]
    });

export const genre = () =>
    base({
        Id: 'genre-1',
        Name: 'Drama',
        Type: 'Genre',
        IsFolder: true,
        People: [],
        UserData: { Key: 'genre-1' }
    });

export const musicGenre = () =>
    base({
        Id: 'musicgenre-1',
        Name: 'Jazz',
        Type: 'MusicGenre',
        IsFolder: true,
        People: [],
        UserData: { Key: 'musicgenre-1' }
    });
