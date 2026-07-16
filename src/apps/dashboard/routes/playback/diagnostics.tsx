import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import HighlightOff from '@mui/icons-material/HighlightOff';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import { useTheme } from '@mui/material/styles';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import {
    type MRT_Cell,
    type MRT_ColumnDef,
    type MRT_TableOptions,
    type MRT_Theme,
    useMaterialReactTable
} from 'material-react-table';
import React, { useCallback, useMemo, useState } from 'react';

import TablePage, {
    DEFAULT_TABLE_OPTIONS
} from 'apps/dashboard/components/table/TablePage';
import { usePlaybackSessions } from 'apps/dashboard/features/playback/api/usePlaybackSessions';
import type {
    PlaybackMethod,
    PlaybackSessionListItem
} from 'apps/dashboard/features/playback/api/types';
import DiagnosticDrawer from 'apps/dashboard/features/playback/components/DiagnosticDrawer';
import PlaybackMethodChip from 'apps/dashboard/features/playback/components/PlaybackMethodChip';
import { formatOutputSpec } from 'apps/dashboard/features/playback/utils/formatOutputSpec';
import { useLocale } from 'hooks/useLocale';
import globalize from 'lib/globalize';

/**
 * `apps/dashboard/components/table/DateTimeCell` is typed against the generic `MRT_RowData`
 * (`Record<string, any>`) default, which every *all-optional* DTO row type used elsewhere in the
 * dashboard happens to be structurally compatible with. `PlaybackSessionListItem` has required
 * properties (`Session`, `HasDiagnostic`), so it isn't — this local cell renderer is the same
 * rendering as `DateTimeCell` but typed against our actual row shape.
 */
const UpdatedAtCell = ({
    cell
}: {
    cell: MRT_Cell<PlaybackSessionListItem, unknown>;
}) => {
    const { dateFnsLocale } = useLocale();
    return format(cell.getValue<Date>(), 'Pp', { locale: dateFnsLocale });
};

const KindCell = ({
    cell
}: {
    cell: MRT_Cell<PlaybackSessionListItem, unknown>;
}) => <>{globalize.translate(cell.getValue<string>())}</>;

const MethodCell = ({
    cell
}: {
    cell: MRT_Cell<PlaybackSessionListItem, unknown>;
}) => <PlaybackMethodChip method={cell.getValue<PlaybackMethod>()} />;

const HasDiagnosticCell = ({
    cell
}: {
    cell: MRT_Cell<PlaybackSessionListItem, unknown>;
}) => {
    const hasDiagnostic = cell.getValue<boolean>();
    const label = globalize.translate(
        hasDiagnostic
            ? 'PlaybackDiagnosticAvailable'
            : 'PlaybackDiagnosticUnavailable'
    );

    return (
        <Tooltip title={label}>
            {hasDiagnostic ? (
                <CheckCircleOutline color='success' />
            ) : (
                <HighlightOff color='disabled' />
            )}
        </Tooltip>
    );
};

export const Component = () => {
    const { data, isPending, isError } = usePlaybackSessions();
    const sessions = useMemo(() => data ?? [], [data]);
    const theme = useTheme();

    // Clicking a row opens the detail drawer for that session's id, without navigation (design
    // doc §5.3) — avoids duplicating list state in a route param.
    const [selectedSessionId, setSelectedSessionId] = useState<string>();
    const onCloseDrawer = useCallback(
        () => setSelectedSessionId(undefined),
        []
    );

    // The server-side shadow mode is disabled by default (design doc §2.3): on a default Reefin
    // instance, HasDiagnostic will be false for every session. That is the expected, nominal
    // state for this page, not an error — show an explanatory banner instead of treating it as
    // one, and keep showing the table (Method/Output/Transforms/Reasons are always available,
    // derived from the legacy planner).
    const hasSessionsWithoutDiagnostic = useMemo(
        () => sessions.some((item) => !item.HasDiagnostic),
        [sessions]
    );

    const columns = useMemo<MRT_ColumnDef<PlaybackSessionListItem>[]>(
        () => [
            {
                id: 'Kind',
                accessorFn: (row) => row.Session.Kind,
                header: globalize.translate('LabelType'),
                size: 100,
                Cell: KindCell
            },
            {
                id: 'Method',
                accessorFn: (row) => row.Session.Method,
                header: globalize.translate('LabelPlayMethod'),
                size: 140,
                Cell: MethodCell
            },
            {
                id: 'Output',
                accessorFn: (row) => formatOutputSpec(row.Session.Output),
                header: globalize.translate('PlaybackData'),
                size: 260
            },
            {
                id: 'UpdatedAt',
                accessorFn: (row) => parseISO(row.Session.UpdatedAt),
                header: globalize.translate('LastActive'),
                size: 160,
                Cell: UpdatedAtCell,
                filterVariant: 'datetime-range'
            },
            {
                id: 'HasDiagnostic',
                accessorFn: (row) => row.HasDiagnostic,
                header: globalize.translate(
                    'HeaderPlaybackDiagnosticAvailable'
                ),
                size: 120,
                filterVariant: 'checkbox',
                Cell: HasDiagnosticCell
            }
        ],
        []
    );

    // NOTE: We need to provide a custom theme due to a MRT bug causing the initial theme to always be used
    // https://github.com/KevinVandy/material-react-table/issues/1429
    const mrtTheme = useMemo<Partial<MRT_Theme>>(
        () => ({
            baseBackgroundColor: theme.palette.background.paper
        }),
        [theme]
    );

    const mrTable = useMaterialReactTable<PlaybackSessionListItem>({
        // DEFAULT_TABLE_OPTIONS is typed against the generic MRT_RowData default; every other
        // consumer's row type happens to be all-optional (@jellyfin/sdk DTOs) and so is
        // structurally compatible both ways. PlaybackSessionListItem has required properties
        // (Session, HasDiagnostic), which breaks that incidental compatibility for unrelated,
        // unset options like columnVirtualizerOptions. The cast is safe: DEFAULT_TABLE_OPTIONS
        // itself only sets row-type-agnostic options (column pinning/resizing, sticky
        // header/footer, container sx).
        ...(DEFAULT_TABLE_OPTIONS as Partial<
            MRT_TableOptions<PlaybackSessionListItem>
        >),
        mrtTheme,

        columns,
        data: sessions,

        muiTableBodyRowProps: ({ row }) => ({
            onClick: () => setSelectedSessionId(row.original.Session.Id),
            sx: { cursor: 'pointer' }
        }),

        initialState: {
            density: 'compact',
            pagination: {
                pageIndex: 0,
                pageSize: 25
            }
        },
        state: {
            isLoading: isPending
        },

        // Neutral empty state (design doc §5.4): no active playback sessions is not an error.
        renderEmptyRowsFallback: () => (
            <Box sx={{ padding: 2, textAlign: 'center', width: '100%' }}>
                {globalize.translate('PlaybackDiagnosticsEmpty')}
            </Box>
        )
    });

    const notice = !isPending && hasSessionsWithoutDiagnostic && (
        <Alert severity='info' sx={{ marginBottom: 2 }}>
            {globalize.translate('PlaybackDiagnosticsShadowModeDisabled')}
        </Alert>
    );

    return (
        <>
            <TablePage
                id='playbackDiagnosticsPage'
                title={globalize.translate('HeaderPlaybackDiagnostics')}
                className='mainAnimatedPage type-interior'
                table={mrTable}
                isError={isError}
                errorMessage={globalize.translate(
                    'PlaybackDiagnosticsLoadError'
                )}
                notice={notice}
            />
            <DiagnosticDrawer
                sessionId={selectedSessionId}
                onClose={onCloseDrawer}
            />
        </>
    );
};

Component.displayName = 'PlaybackDiagnosticsPage';
