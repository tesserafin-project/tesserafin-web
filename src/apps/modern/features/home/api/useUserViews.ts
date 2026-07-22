import { queryOptions, useQuery } from '@tanstack/react-query';
import type { AxiosRequestConfig } from 'axios';

import { useApi } from 'hooks/useApi';
import type {
    TesserafinApi,
    UserViewApiGetUserViewsRequest
} from 'lib/tesserafin-sdk';
import { getUserViewApi } from 'lib/tesserafin-sdk';

export const fetchUserViews = async (
    api: TesserafinApi,
    params: UserViewApiGetUserViewsRequest,
    options?: AxiosRequestConfig
) => {
    const response = await getUserViewApi(api).getUserViews(params, options);
    return response.data;
};

/** Query options for fetching the current user's media library tiles ("Mes médias"). */
export const getUserViewsQuery = (
    api?: TesserafinApi,
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
