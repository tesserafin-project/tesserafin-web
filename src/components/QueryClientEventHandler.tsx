import { OutboundWebSocketMessageType } from '@jellyfin/sdk/lib/websocket/types';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, type FC } from 'react';

import { EventType } from 'constants/eventType';
import { useApi } from 'hooks/useApi';
import Events from 'utils/events';

/** Component that handles mapping events to query client actions. */
const QueryClientEventHandler: FC = () => {
    const queryClient = useQueryClient();
    const { api, user } = useApi();

    const invalidate = useCallback(() => {
        for (const queryKey of [
            ['Home', user?.Id],
            ['User', user?.Id, 'Items'],
            ['User', user?.Id, 'Views'],
            ['Items']
        ]) {
            void queryClient.invalidateQueries({ queryKey });
        }
    }, [queryClient, user?.Id]);

    useEffect(() => {
        Events.on(document, EventType.REFRESH_NEEDED, invalidate);

        return () => {
            Events.off(document, EventType.REFRESH_NEEDED, invalidate);
        };
    }, [invalidate]);

    /**
     * The server says the library or this user's play state changed, so what the cache holds about
     * them is wrong now, not in a minute. Without this the home page a new user lands on after the
     * first-run wizard stays a snapshot of a scan that had only just begun — missing titles, no
     * posters — and, because the cache is persisted, reloading within the stale time does not help.
     * Invalidation only refetches what is on screen; everything else is refetched when next shown.
     */
    useEffect(() => {
        if (!api || !user?.Id) return;

        return api.subscribe(
            [
                OutboundWebSocketMessageType.LibraryChanged,
                OutboundWebSocketMessageType.UserDataChanged
            ],
            invalidate
        );
    }, [api, user?.Id, invalidate]);

    return null;
};

export default QueryClientEventHandler;
