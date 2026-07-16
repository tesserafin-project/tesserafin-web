import { useQuery } from '@tanstack/react-query';

import { useApi } from 'hooks/useApi';
import { fetchPlaybackSessions } from './playbackDiagnosticsApi';

export const QUERY_KEY = 'PlaybackDiagnosticsSessions';

/**
 * Lists currently tracked playback sessions with their diagnostic availability
 * (`GET /System/PlaybackDiagnostics/Sessions`). No automatic polling for this first slice —
 * design doc §9 Q3 leaves that decision to a later PR if manual refresh proves insufficient.
 */
export const usePlaybackSessions = () => {
    const { api } = useApi();
    return useQuery({
        queryKey: [ QUERY_KEY ],
        queryFn: ({ signal }) => fetchPlaybackSessions(api!, signal),
        enabled: !!api
    });
};
