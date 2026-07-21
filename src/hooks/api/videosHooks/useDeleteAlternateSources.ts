import type { VideoApiDeleteAlternateSourcesRequest } from '@jellyfin/sdk/lib/generated-client/api/video-api';
import { getVideoApi } from '@jellyfin/sdk/lib/utils/api/video-api';
import { useMutation } from '@tanstack/react-query';
import { type TesserafinApiContext, useApi } from 'hooks/useApi';

const deleteAlternateSources = async (
    apiContext: TesserafinApiContext,
    params: VideoApiDeleteAlternateSourcesRequest
) => {
    const { api } = apiContext;

    if (!api)
        throw new Error('[deleteAlternateSources] No API instance available');

    const response = await getVideoApi(api).deleteAlternateSources(params);
    return response.data;
};

export const useDeleteAlternateSources = () => {
    const apiContext = useApi();
    return useMutation({
        mutationFn: (params: VideoApiDeleteAlternateSourcesRequest) =>
            deleteAlternateSources(apiContext, params)
    });
};
