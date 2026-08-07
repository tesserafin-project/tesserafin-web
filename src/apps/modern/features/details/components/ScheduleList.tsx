import React, { type FC } from 'react';

import datetime from 'scripts/datetime';

import type { DetailItem } from '../adapters/itemDetailsApi';

/**
 * A programme schedule — the series-timer schedule and the upcoming-on-TV list.
 *
 * Replaces `components/listview`'s `getListViewHtml` string composition. Server order is preserved;
 * nothing here sorts.
 */
const ScheduleList: FC<{ items: DetailItem[] }> = ({ items }) => (
    <ul className='rf-item-details__list'>
        {items.map((entry) => (
            <li key={entry.Id} data-id={entry.Id}>
                <span>{entry.Name}</span>
                {entry.StartDate ? (
                    <time dateTime={entry.StartDate as string}>
                        {datetime.toLocaleString(
                            datetime.parseISO8601Date(entry.StartDate)
                        )}
                    </time>
                ) : null}
            </li>
        ))}
    </ul>
);

export default ScheduleList;
