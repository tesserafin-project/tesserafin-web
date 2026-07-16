import CloseIcon from '@mui/icons-material/Close';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { isAxiosError } from 'axios';
import React, { useCallback, useEffect, useState } from 'react';

import Toast from 'apps/dashboard/components/Toast';
import { usePlaybackSessionDetail } from 'apps/dashboard/features/playback/api/usePlaybackSessionDetail';
import { QUERY_KEY as SESSIONS_LIST_QUERY_KEY } from 'apps/dashboard/features/playback/api/usePlaybackSessions';
import type { MediaSourceSnapshot, ReasonCode } from 'apps/dashboard/features/playback/api/types';
import DiagnosticTimeline from 'apps/dashboard/features/playback/components/DiagnosticTimeline';
import DivergenceBadge from 'apps/dashboard/features/playback/components/DivergenceBadge';
import NoDiagnosticNotice from 'apps/dashboard/features/playback/components/NoDiagnosticNotice';
import PlaybackMethodChip from 'apps/dashboard/features/playback/components/PlaybackMethodChip';
import ReasonTree from 'apps/dashboard/features/playback/components/ReasonTree';
import { formatOutputSpec } from 'apps/dashboard/features/playback/utils/formatOutputSpec';
import { formatReasonCode } from 'apps/dashboard/features/playback/utils/formatReasonCode';
import globalize from 'lib/globalize';
import { queryClient } from 'utils/query/queryClient';

interface DiagnosticDrawerProps {
    /** The session to show detail for. `undefined` closes/hides the drawer. */
    sessionId: string | undefined
    onClose: () => void
}

const ReasonCodeChips = ({ codes }: { codes: ReasonCode[] }) => (
    codes.length > 0 ? (
        <Stack direction='row' spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            {codes.map(code => (
                <Chip key={code} size='small' variant='outlined' label={formatReasonCode(code)} />
            ))}
        </Stack>
    ) : (
        <Typography color='text.secondary' variant='body2'>—</Typography>
    )
);

const SourceSnapshotSummary = ({ source }: { source: MediaSourceSnapshot }) => (
    <Box sx={{ paddingY: 1 }}>
        <Typography fontWeight='bold'>
            {source.Container.toUpperCase()} · {source.Protocol}
        </Typography>
        <Typography variant='body2' color='text.secondary'>
            {source.VideoStreams.length} {globalize.translate('Video')} · {source.AudioStreams.length} {globalize.translate('Audio')} · {source.SubtitleStreams.length} {globalize.translate('Subtitle')}
            {source.Bitrate ? ` · ${source.Bitrate.toLocaleString()} bps` : ''}
        </Typography>
    </Box>
);

interface SectionProps {
    title: string
    children: React.ReactNode
}

const Section = ({ title, children }: SectionProps) => (
    <Box>
        <Typography variant='h2' sx={{ marginBottom: 1 }}>{title}</Typography>
        {children}
        <Divider sx={{ marginTop: 2 }} />
    </Box>
);

/**
 * Detail panel for a single playback session (design doc §5.3), opened from a row in
 * `routes/playback/diagnostics.tsx` without navigation. Sections follow the PR92 §5 wireframe
 * order: Decision (always available, legacy-derived) → Source → Reasoning → Timeline (always
 * available) → Comparison. Source/Reasoning/Comparison are omitted in favor of a single
 * `NoDiagnosticNotice` when no shadow diagnostic was retained for this session (design doc §2.3):
 * that is the nominal state on a default Reefin instance, not an error.
 */
const DiagnosticDrawer = ({ sessionId, onClose }: DiagnosticDrawerProps) => {
    const open = !!sessionId;
    const { data: detail, isPending, isError, error } = usePlaybackSessionDetail(sessionId);
    const [ isNotFoundToastOpen, setIsNotFoundToastOpen ] = useState(false);

    const isNotFound = isError && isAxiosError(error) && error.response?.status === 404;

    useEffect(() => {
        if (isNotFound) {
            onClose();
            setIsNotFoundToastOpen(true);
            void queryClient.invalidateQueries({ queryKey: [ SESSIONS_LIST_QUERY_KEY ] });
        }
    }, [ isNotFound, onClose ]);

    const onNotFoundToastClose = useCallback(() => {
        setIsNotFoundToastOpen(false);
    }, []);

    // Nullable fields arrive as `undefined`, never a literal `null`, because the server omits
    // null properties from the JSON payload (JsonIgnoreCondition.WhenWritingNull) — checked with
    // plain truthiness here, not `=== null`.
    const hasDiagnostic = !!detail && (!!detail.Reasoning || !!detail.Comparison || !!detail.SourceSnapshot?.length);

    return (
        <>
            <Drawer anchor='right' open={open} onClose={onClose}>
                <Box sx={{ width: { xs: '100vw', sm: 480 }, padding: 3 }} role='presentation'>
                    <Stack direction='row' alignItems='center' justifyContent='space-between' sx={{ marginBottom: 2 }}>
                        <Typography variant='h1'>{globalize.translate('HeaderPlaybackDiagnostics')}</Typography>
                        <IconButton
                            aria-label={globalize.translate('ButtonClose')}
                            title={globalize.translate('ButtonClose')}
                            onClick={onClose}
                        >
                            <CloseIcon />
                        </IconButton>
                    </Stack>

                    {isPending && (
                        <Stack spacing={2}>
                            <Skeleton variant='text' height={40} />
                            <Skeleton variant='rounded' height={80} />
                            <Skeleton variant='rounded' height={120} />
                        </Stack>
                    )}

                    {!isPending && isError && !isNotFound && (
                        <Alert severity='error'>{globalize.translate('PlaybackDiagnosticDetailLoadError')}</Alert>
                    )}

                    {!isPending && !isError && detail && (
                        <Stack spacing={2}>
                            <Section title={globalize.translate('HeaderPlaybackDecision')}>
                                <Stack spacing={1}>
                                    <PlaybackMethodChip method={detail.Method} />
                                    <Typography variant='body2'>{formatOutputSpec(detail.Output)}</Typography>
                                    <Typography variant='subtitle2'>{globalize.translate('LabelTransforms')}</Typography>
                                    {detail.Transforms.length > 0 ? (
                                        <Stack direction='row' spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                                            {detail.Transforms.map(transform => (
                                                <Chip key={transform} size='small' label={globalize.translate(`TransformKind.${transform}`)} />
                                            ))}
                                        </Stack>
                                    ) : (
                                        <Typography color='text.secondary' variant='body2'>—</Typography>
                                    )}
                                    <Typography variant='subtitle2'>{globalize.translate('LabelReasons')}</Typography>
                                    <ReasonCodeChips codes={detail.Reasons} />
                                </Stack>
                            </Section>

                            {!hasDiagnostic && <NoDiagnosticNotice />}

                            {hasDiagnostic && !!detail.SourceSnapshot?.length && (
                                <Section title={globalize.translate('LabelSource')}>
                                    <Stack divider={<Divider />}>
                                        {detail.SourceSnapshot.map(source => (
                                            <SourceSnapshotSummary key={source.MediaSourceId} source={source} />
                                        ))}
                                    </Stack>
                                </Section>
                            )}

                            {hasDiagnostic && !!detail.Reasoning && (
                                <Section title={globalize.translate('HeaderPlaybackReasoning')}>
                                    <ReasonTree root={detail.Reasoning} />
                                </Section>
                            )}

                            <Section title={globalize.translate('HeaderPlaybackTimeline')}>
                                <DiagnosticTimeline entries={detail.Timeline} />
                            </Section>

                            {hasDiagnostic && !!detail.Comparison && (
                                <Section title={globalize.translate('HeaderPlaybackComparison')}>
                                    <Stack spacing={1}>
                                        <Stack direction='row' spacing={1} alignItems='center'>
                                            <Typography variant='body2'>{globalize.translate('LabelDivergence')}</Typography>
                                            <DivergenceBadge divergenceClass={detail.Comparison.DivergenceClass} />
                                        </Stack>
                                        <Stack direction='row' spacing={1} alignItems='center'>
                                            <Typography variant='body2'>{globalize.translate('LabelLegacyMethod')}</Typography>
                                            <PlaybackMethodChip method={detail.Comparison.LegacyMethod} />
                                        </Stack>
                                        <Typography variant='subtitle2'>{globalize.translate('LabelReasons')}</Typography>
                                        <ReasonCodeChips codes={detail.Comparison.LegacyReasons} />
                                    </Stack>
                                </Section>
                            )}
                        </Stack>
                    )}
                </Box>
            </Drawer>
            <Toast
                open={isNotFoundToastOpen}
                onClose={onNotFoundToastClose}
                message={globalize.translate('PlaybackDiagnosticSessionNotFound')}
            />
        </>
    );
};

export default DiagnosticDrawer;
