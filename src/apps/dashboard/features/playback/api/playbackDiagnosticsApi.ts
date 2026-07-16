import type { Api } from '@jellyfin/sdk';

import type {
    PlaybackDiagnosticDetail,
    PlaybackSessionListItem
} from './types';

/**
 * Manual client for the Reefin-specific admin playback diagnostics routes
 * (`Reefin.Api/Controllers/PlaybackDiagnosticsSessionsController.cs`, `[Authorize(Policy =
 * Policies.RequiresElevation)]`). These routes are not part of `@jellyfin/sdk` (generated from
 * stock Jellyfin), so there is no `get*Api(api)` helper to call — this follows the precedent set
 * by `src/utils/bitrateTest.ts` for an out-of-SDK route: plain functions against
 * `api.axiosInstance`/`api.basePath`, with the auth header attached by hand via
 * `api.authorizationHeader`.
 */
const BASE = '/System/PlaybackDiagnostics/Sessions';

/** Gets a snapshot of all currently tracked playback sessions. */
export async function fetchPlaybackSessions(
    api: Api,
    signal?: AbortSignal
): Promise<PlaybackSessionListItem[]> {
    const { data } = await api.axiosInstance.get<PlaybackSessionListItem[]>(
        `${api.basePath}${BASE}`,
        { headers: { Authorization: api.authorizationHeader }, signal }
    );
    return data;
}

/** Gets a single tracked playback session's diagnostic detail. Not yet consumed (PR2). */
export async function fetchPlaybackSessionDetail(
    api: Api,
    id: string,
    signal?: AbortSignal
): Promise<PlaybackDiagnosticDetail> {
    const { data } = await api.axiosInstance.get<PlaybackDiagnosticDetail>(
        `${api.basePath}${BASE}/${id}`,
        { headers: { Authorization: api.authorizationHeader }, signal }
    );
    return data;
}

/**
 * Exports a session's retained shadow diagnostic as a playback-compatibility-lab fixture.
 * Returns 422 if the session has no retained diagnostic (`HasDiagnostic: false`). Not yet
 * consumed (PR3).
 */
export async function fetchPlaybackSessionFixture(api: Api, id: string): Promise<Blob> {
    const { data } = await api.axiosInstance.get<Blob>(
        `${api.basePath}${BASE}/${id}/Fixture`,
        { headers: { Authorization: api.authorizationHeader }, responseType: 'blob' }
    );
    return data;
}
