import { queryOptions, useQuery } from '@tanstack/react-query';
import type { AxiosRequestConfig } from 'axios';

import { useApi } from 'hooks/useApi';
import { type TesserafinApi, getSystemApi } from 'lib/tesserafin-sdk';

/**
 * Migrated from `@jellyfin/sdk`'s `getSystemApi`/`Api` to the generated `tesserafin-sdk` equivalents
 * (docs/tesserafin/design-tesserafin-api-layer.md §8 PR3) - `/System/Storage` is a route inherited from
 * stock Jellyfin (unchanged by Reefin), and this feature was already a thin, single-endpoint,
 * read-only consumer, which is exactly why it was picked as the first non-playback migration: the
 * only things that changed below are the import source (`lib/tesserafin-sdk` instead of `@jellyfin/sdk`)
 * and which `useApi()` field is read (`reefinApi` instead of `api`) - `getSystemApi(x).
 * getSystemStorage(options)` is identical in both SDKs.
 */
const fetchSystemStorage = async (
    api: TesserafinApi,
    options?: AxiosRequestConfig
) => {
    const response = await getSystemApi(api).getSystemStorage(options);
    return response.data;
};

const getSystemStorageQuery = (api?: TesserafinApi) =>
    queryOptions({
        queryKey: ['SystemStorage'],
        queryFn: ({ signal }) => fetchSystemStorage(api!, { signal }),
        enabled: !!api,
        refetchOnWindowFocus: false
    });

export const useSystemStorage = () => {
    const { reefinApi } = useApi();
    return useQuery(getSystemStorageQuery(reefinApi));
};
