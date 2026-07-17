import { queryOptions, useQuery } from '@tanstack/react-query';
import type { AxiosRequestConfig } from 'axios';

import { useApi } from 'hooks/useApi';
import { getShowApi } from 'lib/reefin-sdk';
import type { ReefinApi, ShowApiGetNextUpRequest } from 'lib/reefin-sdk';

const NEXT_UP_LIMIT = 12;

export const fetchNextUp = async (
    api: ReefinApi,
    params: ShowApiGetNextUpRequest,
    options?: AxiosRequestConfig
) => {
    const response = await getShowApi(api).getNextUp(params, options);
    return response.data;
};

/** Query options for fetching "à suivre" episodes on the home page. */
export const getNextUpQuery = (
    api?: ReefinApi,
    params: ShowApiGetNextUpRequest = {}
) =>
    queryOptions({
        queryKey: ['Home', params.userId, 'NextUp', params],
        queryFn: ({ signal }) => fetchNextUp(api!, params, { signal }),
        enabled: !!api
    });

/** Hook for fetching "à suivre" episodes on the home page. */
export const useNextUp = () => {
    const { reefinApi, user } = useApi();
    return useQuery(
        getNextUpQuery(reefinApi, {
            userId: user?.Id,
            limit: NEXT_UP_LIMIT
        })
    );
};
