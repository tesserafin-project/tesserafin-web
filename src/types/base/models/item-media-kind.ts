import { MediaType } from '@jellyfin/sdk/lib/generated-client/models/media-type';

export const ItemMediaKind = {
    ...MediaType,
    MusicArtist: 'MusicArtist',
    Playlist: 'Playlist',
    MusicGenre: 'MusicGenre',
    Recording: 'Recording'
} as const;

export type ItemMediaKind =
    | (typeof ItemMediaKind)[keyof typeof ItemMediaKind]
    | undefined;
