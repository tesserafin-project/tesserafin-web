import { queryOptions, useQuery } from '@tanstack/react-query';
import type { AxiosRequestConfig } from 'axios';

import { useApi } from 'hooks/useApi';
import { getLibraryApi } from 'lib/reefin-sdk';
import type {
    LibraryApiGetLatestMediaRequest,
    ReefinApi
} from 'lib/reefin-sdk';

const LATEST_MEDIA_LIMIT = 16;

export const fetchLatestMedia = async (
    api: ReefinApi,
    params: LibraryApiGetLatestMediaRequest,
    options?: AxiosRequestConfig
) => {
    const response = await getLibraryApi(api).getLatestMedia(params, options);
    return response.data;
};

/** Query options for fetching a single library view's "ajouts récents" on the home page. */
export const getLatestMediaQuery = (
    api?: ReefinApi,
    params: LibraryApiGetLatestMediaRequest = {}
) =>
    queryOptions({
        queryKey: [
            'Home',
            params.userId,
            'LatestMedia',
            params.parentId,
            params
        ],
        queryFn: ({ signal }) => fetchLatestMedia(api!, params, { signal }),
        enabled: !!api && !!params.parentId
    });

/** Hook for fetching one library view's "ajouts récents" on the home page. */
export const useLatestMedia = (parentId?: string) => {
    const { reefinApi, user } = useApi();
    return useQuery(
        getLatestMediaQuery(reefinApi, {
            userId: user?.Id,
            parentId,
            limit: LATEST_MEDIA_LIMIT
        })
    );
};
