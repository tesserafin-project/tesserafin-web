import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import React, { useMemo } from 'react';

import { useLocale } from 'hooks/useLocale';
import globalize from 'lib/globalize';
import type { DiagnosticTimelineEntry } from '../api/types';

interface DiagnosticTimelineProps {
    entries: DiagnosticTimelineEntry[]
}

/** Renders `PlaybackDiagnosticDetail.Timeline` — always at least one `Created` entry, even when
 * no shadow diagnostic was retained (design doc §4.3). */
const DiagnosticTimeline = ({ entries }: DiagnosticTimelineProps) => {
    const { dateFnsLocale } = useLocale();

    // The server does not document a strict ordering guarantee beyond "chronological"; sort
    // defensively rather than assuming array order.
    const sortedEntries = useMemo(
        () => [ ...entries ].sort((a, b) => a.At.localeCompare(b.At)),
        [ entries ]
    );

    return (
        <List dense disablePadding>
            {sortedEntries.map((entry, index) => (
                // Stages are not guaranteed unique (e.g. multiple `Updated` entries), so the
                // array position is included in the key.
                // eslint-disable-next-line react/no-array-index-key
                <ListItem key={`${entry.Stage}-${index}`} disableGutters>
                    <ListItemText
                        primary={globalize.translate(`DiagnosticTimelineStage.${entry.Stage}`)}
                        secondary={format(parseISO(entry.At), 'Pp', { locale: dateFnsLocale })}
                    />
                </ListItem>
            ))}
        </List>
    );
};

export default DiagnosticTimeline;
