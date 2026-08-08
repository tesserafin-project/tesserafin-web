import React, { type FC } from 'react';

import datetime from 'scripts/datetime';
import { MediaCard, MediaGrid } from 'ui';

import { scaledImageUrl, type DetailItem } from '../adapters/itemDetailsApi';

interface SceneGridProps {
    item: DetailItem;
    chapters: DetailItem[];
}

/**
 * Chapter cards.
 *
 * Replaces `components/cardbuilder/chaptercardbuilder`. The chapter image URL still comes from
 * `getScaledImageUrl`, which is why that member stays in the read inventory for the classes that
 * carry chapters.
 */
const SceneGrid: FC<SceneGridProps> = ({ item, chapters }) => (
    <MediaGrid minItemWidth='260px'>
        {chapters.map((chapter, index) => (
            <MediaCard
                key={`${chapter.Name}-${index}`}
                title={(chapter.Name as string) ?? ''}
                subtitle={datetime.getDisplayRunningTime(
                    chapter.StartPositionTicks as number
                )}
                imageAspect='backdrop'
                imageUrl={
                    chapter.ImageTag
                        ? scaledImageUrl(item, {
                              type: 'Chapter',
                              tag: chapter.ImageTag,
                              maxWidth: 400,
                              imageIndex: index
                          })
                        : undefined
                }
                className='itemDetailsSceneCard'
            />
        ))}
    </MediaGrid>
);

export default SceneGrid;
