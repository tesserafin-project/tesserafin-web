import { useEffect } from 'react';

import {
    getDetailsApiClient,
    subscribeToUserData,
    type DetailItem
} from '../adapters/itemDetailsApi';

interface UserDataMessage {
    UserId?: string;
    UserDataList?: { Key?: string }[];
}

/**
 * Refresh the item when the server reports that ITS user data changed.
 *
 * `MUST PRESERVE` #6: the websocket-driven refresh, and that it matches on the acting user and on
 * the item's own `UserData.Key` — a change to a different item must not refresh this page.
 *
 * The subscription is an effect, so it is released on unmount and on any change of item or server.
 * The legacy route bound it on `viewshow` and released it on `viewbeforehide`, which left it live
 * across a `viewdestroy` that never fired.
 */
export function useUserDataRefresh(
    item: DetailItem | undefined,
    serverId: string | undefined,
    refresh: () => void
): void {
    const itemKey = (item?.UserData as { Key?: string } | undefined)?.Key;

    useEffect(() => {
        if (!item) return;

        const client = getDetailsApiClient(serverId);
        const currentUserId = client.getCurrentUserId();

        const unsubscribe = subscribeToUserData(client, (message) => {
            const data = message.Data as UserDataMessage | undefined;
            if (!data || data.UserId !== currentUserId) return;
            const matched = (data.UserDataList ?? []).some(
                (entry) => entry.Key === itemKey
            );
            if (matched) refresh();
        });

        return () => {
            unsubscribe();
        };
    }, [item, itemKey, refresh, serverId]);
}
