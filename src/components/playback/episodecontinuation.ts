import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';

export const episodePlaybackFields = {
    IsVirtualUnaired: false,
    IsMissing: false,
    Fields: ['Chapters', 'Trickplay']
};

// The server's cursor is inclusive and its total is relative to that cursor.
// One of the 26 DTOs is the anchor, leaving at most 25 new episodes per request.
const continuationLimit = 26;

interface EpisodePageQuery {
    UserId: string;
    limit: number;
    startItemId: string;
    IsVirtualUnaired: boolean;
    IsMissing: boolean;
    Fields: string[];
}

interface EpisodeContinuationOptions {
    apiClient: {
        getEpisodes: (
            seriesId: string,
            query: EpisodePageQuery
        ) => Promise<{ Items: BaseItemDto[]; TotalRecordCount: number }>;
    };
    userId: string;
    seriesId: string;
    lastEpisodeId: string;
    isCurrentAccount: () => boolean;
    expandParts: (items: BaseItemDto[]) => Promise<BaseItemDto[]>;
}

export function createEpisodeContinuation({
    apiClient,
    userId,
    seriesId,
    lastEpisodeId,
    isCurrentAccount,
    expandParts
}: EpisodeContinuationOptions) {
    let anchor = lastEpisodeId;

    return async function loadPage(queuedItems: BaseItemDto[]) {
        const exhausted = { items: [], hasMore: false };
        if (!isCurrentAccount()) return exhausted;

        const page = await apiClient.getEpisodes(seriesId, {
            ...episodePlaybackFields,
            UserId: userId,
            limit: continuationLimit,
            startItemId: anchor
        });
        if (!isCurrentAccount()) return exhausted;

        if (page.Items[0]?.Id !== anchor) {
            // The anchor was removed or is no longer visible. An offset or
            // first-page fallback could silently skip or replay episodes.
            throw new Error('Series queue anchor is unavailable');
        }

        const episodes = page.Items.slice(1);
        const seen = new Set(queuedItems.map((item) => item.Id));
        const upcoming = episodes.filter((item) => {
            if (seen.has(item.Id)) return false;
            seen.add(item.Id);
            return true;
        });

        const hasMore = page.TotalRecordCount > page.Items.length;
        if (!upcoming.length && (episodes.length || hasMore)) {
            throw new Error('Series queue did not advance');
        }

        const items = await expandParts(upcoming);
        if (!isCurrentAccount()) return exhausted;

        const lastId = episodes[episodes.length - 1]?.Id;
        if (lastId) anchor = lastId;
        return {
            items,
            hasMore
        };
    };
}
