import { RecordingStatus } from '@jellyfin/sdk/lib/generated-client/models/recording-status';
import { SeriesStatus } from '@jellyfin/sdk/lib/generated-client/models/series-status';

export const ItemStatus = {
    ...RecordingStatus,
    ...SeriesStatus
} as const;

export type ItemStatus =
    | (typeof ItemStatus)[keyof typeof ItemStatus]
    | null
    | undefined;
