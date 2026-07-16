import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { isAxiosError } from 'axios';
import React, { useCallback, useEffect, useId, useState } from 'react';

import Toast from 'apps/dashboard/components/Toast';
import { useExportFixture } from 'apps/dashboard/features/playback/api/useExportFixture';
import { usePlaybackSessionDetail } from 'apps/dashboard/features/playback/api/usePlaybackSessionDetail';
import { QUERY_KEY as SESSIONS_LIST_QUERY_KEY } from 'apps/dashboard/features/playback/api/usePlaybackSessions';
import type {
    MediaSourceSnapshot,
    PlaybackDiagnosticDetail,
    ReasonCode
} from 'apps/dashboard/features/playback/api/types';
import DiagnosticTimeline from 'apps/dashboard/features/playback/components/DiagnosticTimeline';
import DivergenceBadge from 'apps/dashboard/features/playback/components/DivergenceBadge';
import NoDiagnosticNotice from 'apps/dashboard/features/playback/components/NoDiagnosticNotice';
import PlaybackMethodChip from 'apps/dashboard/features/playback/components/PlaybackMethodChip';
import ReasonTree from 'apps/dashboard/features/playback/components/ReasonTree';
import { downloadBlob } from 'apps/dashboard/features/playback/utils/downloadBlob';
import { formatOutputSpec } from 'apps/dashboard/features/playback/utils/formatOutputSpec';
import { formatReasonCode } from 'apps/dashboard/features/playback/utils/formatReasonCode';
import globalize from 'lib/globalize';
import { queryClient } from 'utils/query/queryClient';

interface DiagnosticDrawerProps {
    /** The session to show detail for. `undefined` closes/hides the drawer. */
    sessionId: string | undefined;
    onClose: () => void;
}

/** `JSON.stringify`s the DTO the server already filtered (design doc §5.3: "JSON.stringify du DTO
 * déjà filtré côté serveur") — no re-filtering here, the response never carried
 * Path/TranscodingUrl/token/ffmpeg args in the first place. */
// navigator.clipboard.writeText can still reject (denied permission, insecure/non-HTTPS context,
// document not focused); the copy button degrades to that rejected promise, surfaced as the
// existing "failed to copy" toast.
const copyDiagnosticToClipboard = (
    detail: PlaybackDiagnosticDetail
): Promise<void> =>
    navigator.clipboard.writeText(JSON.stringify(detail, null, 2));

const exportFixtureFilename = (sessionId: string): string =>
    `playback-diagnostic-fixture-${sessionId}.json`;

const ReasonCodeChips = ({ codes }: { codes: ReasonCode[] }) =>
    codes.length > 0 ? (
        <Stack direction='row' spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            {codes.map((code) => (
                <Chip
                    key={code}
                    size='small'
                    variant='outlined'
                    label={formatReasonCode(code)}
                />
            ))}
        </Stack>
    ) : (
        <Typography color='text.secondary' variant='body2'>
            —
        </Typography>
    );

const SourceSnapshotSummary = ({ source }: { source: MediaSourceSnapshot }) => (
    <Box sx={{ paddingY: 1 }}>
        <Typography fontWeight='bold'>
            {source.Container.toUpperCase()} · {source.Protocol}
        </Typography>
        <Typography variant='body2' color='text.secondary'>
            {source.VideoStreams.length} {globalize.translate('Video')} ·{' '}
            {source.AudioStreams.length} {globalize.translate('Audio')} ·{' '}
            {source.SubtitleStreams.length} {globalize.translate('Subtitle')}
            {source.Bitrate ? ` · ${source.Bitrate.toLocaleString()} bps` : ''}
        </Typography>
    </Box>
);

interface SectionProps {
    title: string;
    children: React.ReactNode;
}

const Section = ({ title, children }: SectionProps) => (
    <Box>
        <Typography variant='h2' sx={{ marginBottom: 1 }}>
            {title}
        </Typography>
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
    const {
        data: detail,
        isPending,
        isError,
        error
    } = usePlaybackSessionDetail(sessionId);
    const exportFixture = useExportFixture();
    const titleId = useId();

    // A single Snackbar slot for every transient message this panel can show (404, copy
    // success/failure, export success/failure) — only one is ever relevant at a time.
    const [toastMessage, setToastMessage] = useState<string>();
    const onToastClose = useCallback(() => setToastMessage(undefined), []);

    const isNotFound =
        isError && isAxiosError(error) && error.response?.status === 404;

    useEffect(() => {
        if (isNotFound) {
            onClose();
            setToastMessage(
                globalize.translate('PlaybackDiagnosticSessionNotFound')
            );
            void queryClient.invalidateQueries({
                queryKey: [SESSIONS_LIST_QUERY_KEY]
            });
        }
    }, [isNotFound, onClose]);

    // Nullable fields arrive as `undefined`, never a literal `null`, because the server omits
    // null properties from the JSON payload (JsonIgnoreCondition.WhenWritingNull) — checked with
    // plain truthiness here, not `=== null`.
    const hasDiagnostic =
        !!detail &&
        (!!detail.Reasoning ||
            !!detail.Comparison ||
            !!detail.SourceSnapshot?.length);

    const onCopyDiagnostic = useCallback(() => {
        if (!detail) {
            return;
        }
        copyDiagnosticToClipboard(detail).then(
            () =>
                setToastMessage(
                    globalize.translate('PlaybackDiagnosticCopied')
                ),
            () =>
                setToastMessage(
                    globalize.translate('PlaybackDiagnosticCopyError')
                )
        );
    }, [detail]);

    const onExportFixture = useCallback(() => {
        if (!sessionId) {
            return;
        }
        exportFixture.mutate(sessionId, {
            onSuccess: (blob) =>
                downloadBlob(blob, exportFixtureFilename(sessionId)),
            onError: (mutationError) => {
                // Mirrors the server's own distinction (design doc §5.4): a 422 means "this
                // session genuinely has nothing to export" (expected, same wording as the
                // HasDiagnostic-derived notice), anything else is a generic failure. The Export
                // button is also disabled whenever `!hasDiagnostic` (see JSX below), so a 422
                // here would only happen if the session's diagnostic was dropped between the
                // detail fetch and clicking Export — a real but narrow race.
                const isDiagnosticGone =
                    isAxiosError(mutationError) &&
                    mutationError.response?.status === 422;
                setToastMessage(
                    globalize.translate(
                        isDiagnosticGone
                            ? 'PlaybackDiagnosticUnavailable'
                            : 'PlaybackDiagnosticFixtureExportError'
                    )
                );
            }
        });
    }, [sessionId, exportFixture]);

    return (
        <>
            <Drawer anchor='right' open={open} onClose={onClose}>
                <Box
                    sx={{ width: { xs: '100vw', sm: 480 }, padding: 3 }}
                    role='dialog'
                    aria-modal='true'
                    aria-labelledby={titleId}
                >
                    <Stack
                        direction='row'
                        alignItems='center'
                        justifyContent='space-between'
                        sx={{ marginBottom: 2 }}
                    >
                        <Typography id={titleId} variant='h1'>
                            {globalize.translate('HeaderPlaybackDiagnostics')}
                        </Typography>
                        {/*
                         * MUI's Drawer/Modal already auto-focuses into the dialog and traps/restores
                         * focus on close (Unstable_TrapFocus, disableAutoFocus/disableEnforceFocus/
                         * disableRestoreFocus all default to false) — autoFocus here only decides
                         * *which* element inside receives that initial focus, landing it on a
                         * predictable, always-present control rather than the dialog root. Justified
                         * inside a dialog that opens via explicit user action (WAI-ARIA Dialog pattern
                         * expects focus to move into it); same precedent as SearchFields.tsx.
                         */}
                        <IconButton
                            autoFocus
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
                        <Alert severity='error'>
                            {globalize.translate(
                                'PlaybackDiagnosticDetailLoadError'
                            )}
                        </Alert>
                    )}

                    {!isPending && !isError && detail && (
                        <Stack spacing={2}>
                            <Section
                                title={globalize.translate(
                                    'HeaderPlaybackDecision'
                                )}
                            >
                                <Stack spacing={1}>
                                    <PlaybackMethodChip
                                        method={detail.Method}
                                    />
                                    <Typography variant='body2'>
                                        {formatOutputSpec(detail.Output)}
                                    </Typography>
                                    <Typography variant='subtitle2'>
                                        {globalize.translate('LabelTransforms')}
                                    </Typography>
                                    {detail.Transforms.length > 0 ? (
                                        <Stack
                                            direction='row'
                                            spacing={1}
                                            sx={{ flexWrap: 'wrap', rowGap: 1 }}
                                        >
                                            {detail.Transforms.map(
                                                (transform) => (
                                                    <Chip
                                                        key={transform}
                                                        size='small'
                                                        label={globalize.translate(
                                                            `TransformKind.${transform}`
                                                        )}
                                                    />
                                                )
                                            )}
                                        </Stack>
                                    ) : (
                                        <Typography
                                            color='text.secondary'
                                            variant='body2'
                                        >
                                            —
                                        </Typography>
                                    )}
                                    <Typography variant='subtitle2'>
                                        {globalize.translate('LabelReasons')}
                                    </Typography>
                                    <ReasonCodeChips codes={detail.Reasons} />
                                </Stack>
                            </Section>

                            {!hasDiagnostic && <NoDiagnosticNotice />}

                            {hasDiagnostic &&
                                !!detail.SourceSnapshot?.length && (
                                    <Section
                                        title={globalize.translate(
                                            'LabelSource'
                                        )}
                                    >
                                        <Stack divider={<Divider />}>
                                            {detail.SourceSnapshot.map(
                                                (source) => (
                                                    <SourceSnapshotSummary
                                                        key={
                                                            source.MediaSourceId
                                                        }
                                                        source={source}
                                                    />
                                                )
                                            )}
                                        </Stack>
                                    </Section>
                                )}

                            {hasDiagnostic && !!detail.Reasoning && (
                                <Section
                                    title={globalize.translate(
                                        'HeaderPlaybackReasoning'
                                    )}
                                >
                                    <ReasonTree
                                        root={detail.Reasoning}
                                        label={globalize.translate(
                                            'HeaderPlaybackReasoning'
                                        )}
                                    />
                                </Section>
                            )}

                            <Section
                                title={globalize.translate(
                                    'HeaderPlaybackTimeline'
                                )}
                            >
                                <DiagnosticTimeline entries={detail.Timeline} />
                            </Section>

                            {hasDiagnostic && !!detail.Comparison && (
                                <Section
                                    title={globalize.translate(
                                        'HeaderPlaybackComparison'
                                    )}
                                >
                                    <Stack spacing={1}>
                                        <Stack
                                            direction='row'
                                            spacing={1}
                                            alignItems='center'
                                        >
                                            <Typography variant='body2'>
                                                {globalize.translate(
                                                    'LabelDivergence'
                                                )}
                                            </Typography>
                                            <DivergenceBadge
                                                divergenceClass={
                                                    detail.Comparison
                                                        .DivergenceClass
                                                }
                                            />
                                        </Stack>
                                        <Stack
                                            direction='row'
                                            spacing={1}
                                            alignItems='center'
                                        >
                                            <Typography variant='body2'>
                                                {globalize.translate(
                                                    'LabelLegacyMethod'
                                                )}
                                            </Typography>
                                            <PlaybackMethodChip
                                                method={
                                                    detail.Comparison
                                                        .LegacyMethod
                                                }
                                            />
                                        </Stack>
                                        <Typography variant='subtitle2'>
                                            {globalize.translate(
                                                'LabelReasons'
                                            )}
                                        </Typography>
                                        <ReasonCodeChips
                                            codes={
                                                detail.Comparison.LegacyReasons
                                            }
                                        />
                                    </Stack>
                                </Section>
                            )}

                            <Stack direction='row' spacing={1}>
                                <Button
                                    variant='outlined'
                                    startIcon={<ContentCopyIcon />}
                                    onClick={onCopyDiagnostic}
                                >
                                    {globalize.translate(
                                        'ButtonCopyDiagnostic'
                                    )}
                                </Button>
                                <Button
                                    variant='outlined'
                                    startIcon={<DownloadIcon />}
                                    disabled={
                                        !hasDiagnostic ||
                                        exportFixture.isPending
                                    }
                                    // Design doc §5.3: disabled whenever HasDiagnostic is false —
                                    // the server would otherwise answer with a 422 for a click
                                    // that can never succeed.
                                    title={
                                        hasDiagnostic
                                            ? undefined
                                            : globalize.translate(
                                                  'PlaybackDiagnosticUnavailable'
                                              )
                                    }
                                    onClick={onExportFixture}
                                >
                                    {globalize.translate('ButtonExportFixture')}
                                </Button>
                            </Stack>
                        </Stack>
                    )}
                </Box>
            </Drawer>
            <Toast
                open={!!toastMessage}
                onClose={onToastClose}
                message={toastMessage}
            />
        </>
    );
};

export default DiagnosticDrawer;
