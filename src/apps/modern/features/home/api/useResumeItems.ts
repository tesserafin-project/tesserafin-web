import { queryOptions, useQuery } from '@tanstack/react-query';
import type { AxiosRequestConfig } from 'axios';

import { useApi } from 'hooks/useApi';
import {
    ItemFields,
    type LibraryApiGetResumeItemsRequest,
    MediaType,
    type TesserafinApi,
    getLibraryApi
} from 'lib/tesserafin-sdk';

const RESUME_ITEMS_LIMIT = 12;

export const fetchResumeItems = async (
    api: TesserafinApi,
    params: LibraryApiGetResumeItemsRequest,
    options?: AxiosRequestConfig
) => {
    const response = await getLibraryApi(api).getResumeItems(params, options);
    return response.data;
};

/** Query options for fetching "continuer à regarder" items on the home page. */
export const getResumeItemsQuery = (
    api?: TesserafinApi,
    params: LibraryApiGetResumeItemsRequest = {}
) =>
    queryOptions({
        queryKey: ['Home', params.userId, 'ResumeItems', params],
        queryFn: ({ signal }) => fetchResumeItems(api!, params, { signal }),
        enabled: !!api
    });

/** Hook for fetching "continuer à regarder" items on the home page. */
export const useResumeItems = () => {
    const { reefinApi, user } = useApi();
    return useQuery(
        getResumeItemsQuery(reefinApi, {
            userId: user?.Id,
            mediaTypes: [MediaType.Video],
            limit: RESUME_ITEMS_LIMIT,
            fields: [ItemFields.PrimaryImageAspectRatio]
        })
    );
};
