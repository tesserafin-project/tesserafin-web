import type { Api } from '@jellyfin/sdk';
import type { UserDto } from '@jellyfin/sdk/lib/generated-client';
import type { ApiClient, Event } from 'jellyfin-apiclient';
import React, {
    type FC,
    type PropsWithChildren,
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState
} from 'react';

import { ServerConnections } from 'lib/jellyfin-apiclient';
import type { ReefinApi } from 'lib/reefin-sdk';
import events from 'utils/events';

export interface TesserafinApiContext {
    __legacyApiClient__?: ApiClient;
    api?: Api;
    /**
     * Parallel `reefin-sdk` client for the same session/device as `api` (design doc §8 PR3) -
     * additive, not a replacement: see `ReefinApi`'s doc comment (`lib/reefin-sdk`) for why `api`
     * (still the only field with WebSocket support via `.subscribe()`) isn't being swapped out
     * wholesale. New call sites against Reefin-superset routes (generated `*Api` classes) should
     * prefer this over `api`; existing `api` consumers are unaffected.
     */
    reefinApi?: ReefinApi;
    user?: UserDto;
}

export const ApiContext = createContext<TesserafinApiContext>({});
export const useApi = () => useContext(ApiContext);

export const ApiProvider: FC<PropsWithChildren<unknown>> = ({ children }) => {
    const [legacyApiClient, setLegacyApiClient] = useState<ApiClient>();
    const [api, setApi] = useState<Api>();
    const [reefinApi, setReefinApi] = useState<ReefinApi>();
    const [user, setUser] = useState<UserDto>();

    const context = useMemo(
        () => ({
            __legacyApiClient__: legacyApiClient,
            api,
            reefinApi,
            user
        }),
        [api, legacyApiClient, reefinApi, user]
    );

    useEffect(() => {
        ServerConnections.currentApiClient()
            ?.getCurrentUser()
            .then((newUser) => updateApiUser(undefined, newUser))
            .catch((err) => {
                console.info('[ApiProvider] Could not get current user', err);
            });

        const updateApiUser = (_e: Event | undefined, newUser: UserDto) => {
            setUser(newUser);

            if (newUser.ServerId) {
                setLegacyApiClient(
                    ServerConnections.getApiClient(newUser.ServerId)
                );
            }
        };

        const resetApiUser = () => {
            setLegacyApiClient(undefined);
            setUser(undefined);
        };

        events.on(ServerConnections, 'localusersignedin', updateApiUser);
        events.on(ServerConnections, 'localusersignedout', resetApiUser);

        return () => {
            events.off(ServerConnections, 'localusersignedin', updateApiUser);
            events.off(ServerConnections, 'localusersignedout', resetApiUser);
        };
    }, [setLegacyApiClient, setUser]);

    useEffect(() => {
        setApi(
            legacyApiClient
                ? ServerConnections.getApi(legacyApiClient.serverId())
                : undefined
        );
        setReefinApi(
            legacyApiClient
                ? ServerConnections.getReefinApi(legacyApiClient.serverId())
                : undefined
        );
    }, [legacyApiClient, setApi, setReefinApi]);

    return (
        <ApiContext.Provider value={context}>{children}</ApiContext.Provider>
    );
};
