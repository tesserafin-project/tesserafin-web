/**
 * The write half of the browsing arrangement, deliberately in its own module.
 *
 * `browsingPreference.ts` is imported by `UserViewNav`, which lives in `main.tesserafin.bundle.js`.
 * Anything reachable from that module is start-up weight, and the measured gzip headroom there is
 * 45 bytes. The resolver next door is a comparison against one string; this function talks to the
 * server, so it is kept out of the start-up graph and imported only by the two surfaces that
 * actually write — the wizard step and the display-preferences page, both lazy.
 */
import type { ApiClient } from 'jellyfin-apiclient';

import type { ContentPackBrowsingPreference } from 'lib/tesserafin-sdk/generated/models/content-pack-browsing-preference';
import type { UserConfiguration } from 'lib/tesserafin-sdk/generated/models/user-configuration';

import { applyBrowsingPreference } from './browsingPreference';

/**
 * Reads the caller's own configuration and writes the arrangement back through the ordinary
 * authenticated endpoints. Nothing here is administrator-only: `POST /Users/{userId}/Configuration`
 * is plain `[Authorize]`, so an ordinary household member can change their own arrangement.
 */
export const saveBrowsingPreference = async (
    apiClient: ApiClient,
    userId: string,
    preference: ContentPackBrowsingPreference
): Promise<UserConfiguration> => {
    const user = await apiClient.getUser(userId);
    const next = applyBrowsingPreference(
        (user.Configuration || {}) as UserConfiguration,
        preference
    );
    await apiClient.updateUserConfiguration(userId, next);
    return next;
};
