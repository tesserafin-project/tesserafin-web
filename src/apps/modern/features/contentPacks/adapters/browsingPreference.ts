/**
 * The per-user browsing arrangement (#139 gates 4 and 5).
 *
 * The value is **server-owned**, on `UserConfiguration.ContentPackBrowsingPreference`, and is read
 * and written through the ordinary authenticated user-configuration endpoints. There is deliberately
 * no browser-side source of truth: a preference kept in `localStorage` would follow the device
 * rather than the person, and two people sharing a television would overwrite each other.
 *
 * `ContentPackBrowsingPreference` is imported from its concrete generated model module rather than
 * from the `lib/tesserafin-sdk` barrel. The barrel is eagerly reachable from
 * `utils/jellyfin-apiclient/compat.ts` and therefore from `main.tesserafin.bundle.js`; the measured
 * start-up headroom on `main` is 45 B gzip, so the import path is a delivery decision, not a style
 * one.
 */
import { ContentPackBrowsingPreference } from 'lib/tesserafin-sdk/generated/models/content-pack-browsing-preference';
import type { UserConfiguration } from 'lib/tesserafin-sdk/generated/models/user-configuration';

export { ContentPackBrowsingPreference };

/**
 * What an installation that has never been asked should do.
 *
 * Absent, `undefined` and any value this build does not recognise all resolve to media-family-first,
 * which is exactly today's arrangement. That is what makes gate 5's "existing users are not
 * prompted" true without a migration: there is no third "unset" state to prompt about, because
 * unset already has a meaning.
 */
export const DEFAULT_BROWSING_PREFERENCE =
    ContentPackBrowsingPreference.MediaFamilyFirst;

export const resolveBrowsingPreference = (
    configuration: UserConfiguration | null | undefined
): ContentPackBrowsingPreference =>
    configuration?.ContentPackBrowsingPreference ===
    ContentPackBrowsingPreference.ContentPackFirst
        ? ContentPackBrowsingPreference.ContentPackFirst
        : DEFAULT_BROWSING_PREFERENCE;

export const isContentPackFirst = (
    configuration: UserConfiguration | null | undefined
): boolean =>
    resolveBrowsingPreference(configuration) ===
    ContentPackBrowsingPreference.ContentPackFirst;

/**
 * Writes the arrangement back, preserving every other field.
 *
 * The whole `UserConfiguration` is the request body, so the write starts from the configuration the
 * server last returned and changes exactly one key. Building a fresh object here — or sending only
 * the changed field — would silently reset subtitle mode, audio language, the home sections and
 * everything else the user has ever chosen.
 */
export const applyBrowsingPreference = (
    configuration: UserConfiguration,
    preference: ContentPackBrowsingPreference
): UserConfiguration => ({
    ...configuration,
    ContentPackBrowsingPreference: preference
});
