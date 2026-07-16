import Chip from '@mui/material/Chip';
import React, { useMemo } from 'react';

import globalize from 'lib/globalize';
import type { DivergenceClass } from '../api/types';
import getDivergenceClassColor from '../utils/getDivergenceClassColor';

interface DivergenceBadgeProps {
    divergenceClass: DivergenceClass;
}

/** Renders a `DiagnosticComparison.DivergenceClass` value as a colored chip, same pattern as
 * `PlaybackMethodChip`/`LogLevelChip`. */
const DivergenceBadge = ({ divergenceClass }: DivergenceBadgeProps) => {
    const label = useMemo(
        () => globalize.translate(`DivergenceClass.${divergenceClass}`),
        [divergenceClass]
    );

    return (
        <Chip
            size='small'
            color={getDivergenceClassColor(divergenceClass)}
            label={label}
            title={label}
        />
    );
};

export default DivergenceBadge;
