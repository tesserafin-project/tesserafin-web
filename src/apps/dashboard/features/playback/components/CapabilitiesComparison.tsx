import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import React, { useMemo } from 'react';

import globalize from 'lib/globalize';
import { buildClientCapabilities } from 'scripts/reefinPlaybackCapabilities';
import type { ClientCapabilities } from '../api/types';
import type { CapabilitySetDiff } from '../utils/compareClientCapabilities';
import { compareClientCapabilities } from '../utils/compareClientCapabilities';

interface CapabilitiesComparisonProps {
    /**
     * The session's server-reconstructed capabilities
     * (`PlaybackDiagnosticDetail.Capabilities`, non-null - the caller gates on that). For a
     * legacy `PlaybackInfo`-originated session, this is what
     * `ClientCapabilitiesMapper`/`DlnaPlaybackAdapter` derived server-side from the client's real
     * `DeviceProfile` (design doc §1.2.A) - a genuine reconstruction, not an echo.
     */
    reconstructed: ClientCapabilities;
}

type SetDiffCategory =
    | 'videoCodecs'
    | 'audioCodecs'
    | 'subtitleFormats'
    | 'directPlayContainers'
    | 'outputContainers';

const CAPABILITY_ROWS: Array<{
    key: SetDiffCategory;
    labelKey: string;
}> = [
    { key: 'videoCodecs', labelKey: 'LabelVideoCodec' },
    { key: 'audioCodecs', labelKey: 'LabelAudioCodec' },
    { key: 'subtitleFormats', labelKey: 'LabelFormat' },
    {
        key: 'directPlayContainers',
        labelKey: 'LabelCapabilitiesDirectPlayContainers'
    },
    { key: 'outputContainers', labelKey: 'LabelCapabilitiesOutputContainers' }
];

const ChipList = ({
    values,
    color
}: {
    values: string[];
    color: 'default' | 'warning';
}) =>
    values.length > 0 ? (
        <Stack direction='row' spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            {values.map((value) => (
                <Chip key={value} size='small' color={color} label={value} />
            ))}
        </Stack>
    ) : (
        <Typography color='text.secondary' variant='body2'>
            —
        </Typography>
    );

interface CapabilityDiffRowProps {
    label: string;
    diff: CapabilitySetDiff;
}

/**
 * One capability category's divergence: what the server-reconstructed reading has that the
 * native declaration doesn't (`onlyInReconstructed`, the interesting direction - see
 * `compareClientCapabilities()`'s doc comment) and vice-versa. Both lists shown, since either
 * direction is a real fidelity gap worth an admin's attention.
 */
const CapabilityDiffRow = ({ label, diff }: CapabilityDiffRowProps) => {
    const hasDivergence =
        diff.onlyInNative.length > 0 || diff.onlyInReconstructed.length > 0;

    return (
        <Stack spacing={0.5}>
            <Stack direction='row' spacing={1} alignItems='center'>
                <Typography variant='subtitle2'>{label}</Typography>
                {!hasDivergence && (
                    <Chip
                        size='small'
                        color='success'
                        variant='outlined'
                        label={globalize.translate(
                            'LabelCapabilitiesNoDivergence'
                        )}
                    />
                )}
            </Stack>
            {hasDivergence && (
                <Stack spacing={0.5} sx={{ paddingLeft: 1 }}>
                    <Typography variant='caption' color='text.secondary'>
                        {globalize.translate('LabelCapabilitiesNativeOnly')}
                    </Typography>
                    <ChipList values={diff.onlyInNative} color='default' />
                    <Typography variant='caption' color='text.secondary'>
                        {globalize.translate(
                            'LabelCapabilitiesReconstructedOnly'
                        )}
                    </Typography>
                    <ChipList
                        values={diff.onlyInReconstructed}
                        color='warning'
                    />
                </Stack>
            )}
        </Stack>
    );
};

/**
 * Renders the declaration-fidelity comparison PR116c adds to the diagnostics drawer (design doc
 * §3 PR116c): the native `ClientCapabilities` declaration `reefinPlaybackCapabilities.ts` (PR116a)
 * would build, against `PlaybackDiagnosticDetail.Capabilities` - what the server actually
 * reconstructed for *this* session from its real `DeviceProfile`.
 *
 * Scoping note, load-bearing for reading this component honestly (see PR116c report for the full
 * reasoning): the native side is always computed in the CURRENT admin browser, not the browser
 * that produced this session. The design doc's PR116c section imagined joining a PR116b shadow
 * session to its paired legacy session via a correlation id to compare same-browser values; PR116b
 * as shipped never transmits one (`playbackSessionShadow.ts` only `console.debug`-logs
 * `DecisionVersion`/`Method`, never persisting an id the admin API can look up). Even if it did,
 * `PlaybackDiagnosticDetail.Capabilities` is *always* a DeviceProfile-reconstruction on the server
 * (confirmed by reading `ShadowPlaybackSessionPlanner`/`ReverseDlnaAdapter`/`PlaybackSessionsController`
 * server-side: a native `/Playback/Sessions` call is round-tripped native→DeviceProfile→
 * reconstructed before being stored, so even a correlated shadow session's stored `Capabilities`
 * would be a reconstruction, not the raw native payload) - there is no server-visible source of a
 * genuine native declaration to correlate against. This component's native side is therefore a
 * structural reference ("what would a compliant native client declare"), a real signal only when
 * the admin happens to be viewing a session their own browser produced, not a verified per-session
 * comparison in general. `PlaybackCapabilitiesComparisonNote` below says this in the UI too.
 */
const CapabilitiesComparison = ({
    reconstructed
}: CapabilitiesComparisonProps) => {
    const comparison = useMemo(() => {
        const native = buildClientCapabilities();
        return compareClientCapabilities(native, reconstructed);
    }, [reconstructed]);

    return (
        <Stack spacing={2}>
            <Alert severity='info'>
                {globalize.translate('PlaybackCapabilitiesComparisonNote')}
            </Alert>
            <Stack spacing={2}>
                {CAPABILITY_ROWS.map(({ key, labelKey }) => (
                    <CapabilityDiffRow
                        key={key}
                        label={globalize.translate(labelKey)}
                        diff={comparison[key]}
                    />
                ))}
            </Stack>
            <Stack direction='row' spacing={2}>
                <Typography variant='body2'>
                    {globalize.translate('LabelCapabilitiesSupportsHls')}
                    {': '}
                    {comparison.supportsHls.matches
                        ? globalize.translate('LabelCapabilitiesNoDivergence')
                        : globalize.translate(
                              'LabelCapabilitiesDivergenceDetail',
                              String(comparison.supportsHls.native),
                              String(comparison.supportsHls.reconstructed)
                          )}
                </Typography>
                <Typography variant='body2'>
                    {globalize.translate('LabelCapabilitiesSupportsDash')}
                    {': '}
                    {comparison.supportsDash.matches
                        ? globalize.translate('LabelCapabilitiesNoDivergence')
                        : globalize.translate(
                              'LabelCapabilitiesDivergenceDetail',
                              String(comparison.supportsDash.native),
                              String(comparison.supportsDash.reconstructed)
                          )}
                </Typography>
            </Stack>
        </Stack>
    );
};

export default CapabilitiesComparison;
