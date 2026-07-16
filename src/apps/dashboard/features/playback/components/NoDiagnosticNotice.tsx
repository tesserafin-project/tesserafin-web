import Alert from '@mui/material/Alert';
import React from 'react';

import globalize from 'lib/globalize';

/**
 * Explains, for a single session's detail panel, why the Source/Reasoning/Comparison sections
 * are absent: no shadow diagnostic was retained (the nominal state while the server-side shadow
 * mode is disabled, design doc §2.3/§5.4) — not an error. Distinct from the list-level banner in
 * `routes/playback/diagnostics.tsx`, which explains the same thing across the whole session list.
 */
const NoDiagnosticNotice = () => (
    <Alert severity='info'>
        {globalize.translate('PlaybackDiagnosticNoticeSession')}
    </Alert>
);

export default NoDiagnosticNotice;
