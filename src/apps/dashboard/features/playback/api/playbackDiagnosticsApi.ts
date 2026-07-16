import type { Api } from '@jellyfin/sdk';

import { Configuration, SystemApi } from 'lib/reefin-sdk';
import type {
    PlaybackDiagnosticDetail,
    PlaybackSessionListItem
} from './types';

/**
 * Generated client for the Reefin-specific admin playback diagnostics routes
 * (`Reefin.Api/Controllers/PlaybackDiagnosticsSessionsController.cs`, `[Authorize(Policy =
 * Policies.RequiresElevation)]`) — `docs/reefin/design-reefin-api-layer.md` §4.1/§8 PR2, replacing
 * the hand-mirrored-types + raw-axios pattern this file used before (still the right pattern for a
 * Reefin route with no generated client at all — see `src/utils/bitrateTest.ts` — just no longer
 * this one's situation now that `src/lib/reefin-sdk/generated/` covers it).
 *
 * `systemApiFor()` configures the generated `SystemApi` class from the CURRENT `@jellyfin/sdk`
 * session (`api.basePath`/`api.axiosInstance`/`api.authorizationHeader`) rather than through
 * `lib/reefin-sdk`'s forward-looking `createReefinApi()` construction wrapper: that wrapper isn't
 * wired into `useApi()`/the connection layer yet (see its doc comment), so building a *second*,
 * independent client identity here would risk the server seeing two different `DeviceId`s for the
 * same browser session. This bridge — reuse the session that already exists, just call it through
 * the generated class — goes away once a later PR migrates the connection layer itself (design doc
 * §8 PR3), at which point `useApi()` can hand out a `ReefinApi` directly.
 */
const systemApiFor = (api: Api): SystemApi =>
    new SystemApi(
        new Configuration({
            basePath: api.basePath,
            baseOptions: { headers: { Authorization: api.authorizationHeader } }
        }),
        api.basePath,
        api.axiosInstance
    );

/**
 * Every generated model property is optional (see `./types.ts`'s file-level comment on
 * `DeepRequired`) even though the wire contract guarantees these fields — asserting through
 * `unknown` here is the one place that gap has to be bridged, right at the client boundary, so the
 * rest of this feature can keep working against the stricter local types unchanged.
 */
const asContract = <T>(data: unknown): T => data as T;

/** Gets a snapshot of all currently tracked playback sessions. */
export async function fetchPlaybackSessions(
    api: Api,
    signal?: AbortSignal
): Promise<PlaybackSessionListItem[]> {
    const { data } = await systemApiFor(api).getPlaybackSessions({ signal });
    return asContract<PlaybackSessionListItem[]>(data);
}

/** Gets a single tracked playback session's diagnostic detail. */
export async function fetchPlaybackSessionDetail(
    api: Api,
    id: string,
    signal?: AbortSignal
): Promise<PlaybackDiagnosticDetail> {
    const { data } = await systemApiFor(api).getPlaybackSession(
        { id },
        { signal }
    );
    return asContract<PlaybackDiagnosticDetail>(data);
}

/**
 * Exports a session's retained shadow diagnostic as a playback-compatibility-lab fixture.
 * Returns 422 if the session has no retained diagnostic (`HasDiagnostic: false`). The generated
 * operation is typed `AxiosPromise<void>` (the route's 200 response has no declared JSON schema in
 * the OpenAPI spec, since it deliberately serializes camelCase-always rather than through the
 * normal content model — design doc §4.1/design-web-playback-diagnostics.md §4.2) — `responseType:
 * 'blob'` is passed the same way it was against the raw-axios version of this function, and the
 * result is asserted to `Blob` for the same reason as `asContract` above.
 */
export async function fetchPlaybackSessionFixture(
    api: Api,
    id: string
): Promise<Blob> {
    const { data } = await systemApiFor(api).exportFixture(
        { id },
        { responseType: 'blob' }
    );
    return asContract<Blob>(data);
}
