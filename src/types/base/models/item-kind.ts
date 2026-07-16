import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';

export const ItemKind = {
    ...BaseItemKind,
    Timer: 'Timer',
    SeriesTimer: 'SeriesTimer'
} as const;

export type ItemKind = (typeof ItemKind)[keyof typeof ItemKind] | undefined;
