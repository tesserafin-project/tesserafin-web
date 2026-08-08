import React, { type FC } from 'react';
import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import { PersonKind } from '@jellyfin/sdk/lib/generated-client/models/person-kind';

import ItemDetailsMetadataList from 'components/itemDetails/ItemDetailsMetadataList';

import type { DetailItem } from '../adapters/itemDetailsApi';
import { inferContext } from '../utils/itemPredicates';

/** The six metadata lists, in the frozen order. */
const METADATA_TYPES = [
    PersonKind.Author,
    PersonKind.Creator,
    PersonKind.Director,
    PersonKind.Writer,
    BaseItemKind.Studio,
    BaseItemKind.Genre
];

/**
 * The six metadata lists — as ordinary React children.
 *
 * This is the reason #129 exists. The legacy route created a NESTED REACT ROOT per list, each with
 * its own `QueryClientProvider` / `ApiProvider` / `UserSettingsProvider` / `WebConfigProvider` /
 * theme provider stack, and each therefore invisible to `PresentationContext`. Six roots per render
 * become zero: the same component, mounted as a descendant of the application root. Delta D1, and
 * `SUSPECT` #6 (one `getCurrentUser` per root) dissolves with it.
 *
 * The container is always rendered, even when every list is empty — the frozen fixture records
 * `itemDetailsGroup` as present for all 24 classes.
 */
const MetadataLists: FC<{ item: DetailItem }> = ({ item }) => {
    const context = inferContext(item) ?? '';

    return (
        <>
            {METADATA_TYPES.map((type) => (
                <ItemDetailsMetadataList
                    key={type}
                    type={type}
                    item={item as never}
                    context={context}
                />
            ))}
        </>
    );
};

export default MetadataLists;
