import { queryOptions, useQuery } from '@tanstack/react-query';
import type { AxiosRequestConfig } from 'axios';

import { useApi } from 'hooks/useApi';
import type { ReefinApi, UserViewApiGetUserViewsRequest } from 'lib/reefin-sdk';
import { getUserViewApi } from 'lib/reefin-sdk';

export const fetchUserViews = async (
    api: ReefinApi,
    params: UserViewApiGetUserViewsRequest,
    options?: AxiosRequestConfig
) => {
    const response = await getUserViewApi(api).getUserViews(params, options);
    return response.data;
};

/** Query options for fetching the current user's media library tiles ("Mes médias"). */
export const getUserViewsQuery = (
    api?: ReefinApi,
    params: UserViewApiGetUserViewsRequest = {}
) =>
    queryOptions({
        queryKey: ['Home', params.userId, 'UserViews'],
        queryFn: ({ signal }) => fetchUserViews(api!, params, { signal }),
        enabled: !!api
    });

/** Hook for fetching the current user's media library tiles ("Mes médias"). */
export const useUserViews = () => {
    const { reefinApi, user } = useApi();
    return useQuery(getUserViewsQuery(reefinApi, { userId: user?.Id }));
};
