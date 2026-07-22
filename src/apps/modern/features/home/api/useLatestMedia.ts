import { queryOptions, useQuery } from '@tanstack/react-query';
import type { AxiosRequestConfig } from 'axios';

import { useApi } from 'hooks/useApi';
import { getLibraryApi } from 'lib/tesserafin-sdk';
import type {
    LibraryApiGetLatestMediaRequest,
    TesserafinApi
} from 'lib/tesserafin-sdk';

const LATEST_MEDIA_LIMIT = 16;

export const fetchLatestMedia = async (
    api: TesserafinApi,
    params: LibraryApiGetLatestMediaRequest,
    options?: AxiosRequestConfig
) => {
    const response = await getLibraryApi(api).getLatestMedia(params, options);
    return response.data;
};

/** Query options for fetching a single library view's "ajouts récents" on the home page. */
export const getLatestMediaQuery = (
    api?: TesserafinApi,
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
