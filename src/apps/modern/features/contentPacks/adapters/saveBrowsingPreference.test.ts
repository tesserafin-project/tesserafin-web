import type { ApiClient } from 'jellyfin-apiclient';
import { describe, expect, it, vi } from 'vitest';

import { ContentPackBrowsingPreference } from './browsingPreference';
import { saveBrowsingPreference } from './saveBrowsingPreference';

const SERVER_CONFIGURATION = {
    AudioLanguagePreference: 'fra',
    SubtitleMode: 'Smart',
    DisplayMissingEpisodes: true,
    OrderedViews: ['view-a', 'view-b']
};

const client = (
    configuration: unknown,
    policy: unknown = { IsAdministrator: false }
) => {
    const updateUserConfiguration = vi.fn().mockResolvedValue(undefined);
    return {
        apiClient: {
            getUser: vi
                .fn()
                .mockResolvedValue({ Configuration: configuration, Policy: policy }),
            updateUserConfiguration
        } as unknown as ApiClient,
        updateUserConfiguration
    };
};

describe('saveBrowsingPreference', () => {
    it('writes the whole configuration back with one key changed', async () => {
        const { apiClient, updateUserConfiguration } =
            client(SERVER_CONFIGURATION);

        await saveBrowsingPreference(
            apiClient,
            'user-a',
            ContentPackBrowsingPreference.ContentPackFirst
        );

        expect(updateUserConfiguration).toHaveBeenCalledTimes(1);
        expect(updateUserConfiguration).toHaveBeenCalledWith('user-a', {
            ...SERVER_CONFIGURATION,
            ContentPackBrowsingPreference:
                ContentPackBrowsingPreference.ContentPackFirst
        });
    });

    it('needs no administrator right and no content-pack permission', async () => {
        // `POST /Users/{userId}/Configuration` is plain `[Authorize]`. Nothing here reads a policy,
        // so an ordinary household member changing their own arrangement is indistinguishable from
        // an administrator doing it.
        const { apiClient, updateUserConfiguration } = client(
            SERVER_CONFIGURATION,
            { IsAdministrator: false, EnableContentPackManagement: false }
        );

        await saveBrowsingPreference(
            apiClient,
            'ordinary-user',
            ContentPackBrowsingPreference.ContentPackFirst
        );

        expect(updateUserConfiguration).toHaveBeenCalledTimes(1);
    });

    it('starts from an empty object when the server sent no configuration', async () => {
        const { apiClient, updateUserConfiguration } = client(undefined);

        await saveBrowsingPreference(
            apiClient,
            'user-a',
            ContentPackBrowsingPreference.MediaFamilyFirst
        );

        expect(updateUserConfiguration).toHaveBeenCalledWith('user-a', {
            ContentPackBrowsingPreference:
                ContentPackBrowsingPreference.MediaFamilyFirst
        });
    });

    it('writes to the user it was given, never to a cached current user', async () => {
        const { apiClient, updateUserConfiguration } =
            client(SERVER_CONFIGURATION);

        await saveBrowsingPreference(
            apiClient,
            'user-b',
            ContentPackBrowsingPreference.ContentPackFirst
        );

        expect(apiClient.getUser).toHaveBeenCalledWith('user-b');
        expect(updateUserConfiguration.mock.calls[0][0]).toBe('user-b');
    });
});
