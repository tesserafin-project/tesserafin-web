import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';

/**
 * What a section asks of its cards. The subset of the legacy `CardOptions` the search sections set,
 * read by `utils/searchCardProps.ts`; `shape` left unset picks the row's shape from its artwork.
 */
export interface SearchCardOptions {
    shape?: 'portrait' | 'square' | 'backdrop';
    showTitle?: boolean;
    showYear?: boolean;
    showParentTitle?: boolean;
    showParentTitleOrTitle?: boolean;
    preferThumb?: boolean;
    inheritThumb?: boolean;
    coverImage?: boolean;
    overlayMoreButton?: boolean;
    showAirTime?: boolean;
    showAirDateTime?: boolean;
    showChannelName?: boolean;
}

export interface Section {
    title: string;
    items: BaseItemDto[];
    cardOptions?: SearchCardOptions;
}
