import { useQuery } from '@tanstack/react-query';

import { useApi } from 'hooks/useApi';
import { fetchPlaybackSessionDetail } from './playbackDiagnosticsApi';

export const QUERY_KEY = 'PlaybackDiagnosticsSessionDetail';

/**
 * Gets a single tracked playback session's diagnostic detail
 * (`GET /System/PlaybackDiagnostics/Sessions/{id}`). Disabled until an `id` is selected (e.g. by
 * clicking a row in the sessions list), matching the "enabled on selection" shape described in
 * the design doc §5.2.
 */
export const usePlaybackSessionDetail = (id: string | undefined) => {
    const { api } = useApi();
    return useQuery({
        queryKey: [ QUERY_KEY, id ],
        queryFn: ({ signal }) => fetchPlaybackSessionDetail(api!, id!, signal),
        enabled: !!api && !!id
    });
};
