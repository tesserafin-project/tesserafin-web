import { useMutation } from '@tanstack/react-query';

import { useApi } from 'hooks/useApi';
import { fetchPlaybackSessionFixture } from './playbackDiagnosticsApi';

/**
 * Exports a session's retained shadow diagnostic as a playback-compatibility-lab fixture
 * (`GET .../Sessions/{id}/Fixture`, design doc §5.3 "Exporter le cas de test"). The server
 * returns 422 if the session has no retained diagnostic (`HasDiagnostic: false`) — the caller is
 * expected to disable the triggering control in that case (design doc §5.4) and to handle the
 * 422 as a distinct, expected outcome rather than a generic failure.
 */
export const useExportFixture = () => {
    const { api } = useApi();
    return useMutation({
        mutationFn: (sessionId: string) =>
            fetchPlaybackSessionFixture(api!, sessionId)
    });
};
