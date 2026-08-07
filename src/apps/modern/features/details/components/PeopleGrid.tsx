import React, { type FC } from 'react';

import { MediaCard, MediaGrid } from 'ui';

import type { DetailItem } from '../adapters/itemDetailsApi';

interface PeopleGridProps {
    people: DetailItem[];
    serverId?: string;
}

/**
 * Cast and guest cast.
 *
 * Replaces `components/cardbuilder/peoplecardbuilder`, which invariant 11 forbids. The person's
 * role is the card subtitle, exactly as the people cards showed it.
 */
const PeopleGrid: FC<PeopleGridProps> = ({ people, serverId }) => (
    <MediaGrid>
        {people.map((person) => (
            <MediaCard
                key={person.Id ?? person.Name}
                title={person.Name ?? ''}
                subtitle={(person.Role as string) ?? undefined}
                imageAspect='poster'
                href={`#/details?id=${person.Id ?? ''}&serverId=${serverId ?? ''}`}
                className='itemDetailsPersonCard'
            />
        ))}
    </MediaGrid>
);

export default PeopleGrid;
