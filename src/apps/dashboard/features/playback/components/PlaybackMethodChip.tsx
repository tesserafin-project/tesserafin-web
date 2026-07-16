import Chip from '@mui/material/Chip';
import React, { useMemo } from 'react';

import globalize from 'lib/globalize';
import type { PlaybackMethod } from '../api/types';
import getPlaybackMethodColor from '../utils/getPlaybackMethodColor';

interface PlaybackMethodChipProps {
    method: PlaybackMethod;
}

const PlaybackMethodChip = ({ method }: PlaybackMethodChipProps) => {
    const label = useMemo(
        () => globalize.translate(`PlaybackMethod.${method}`),
        [method]
    );

    return (
        <Chip
            size='small'
            color={getPlaybackMethodColor(method)}
            label={label}
            title={label}
        />
    );
};

export default PlaybackMethodChip;
