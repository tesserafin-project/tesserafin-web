import ExpandMore from '@mui/icons-material/ExpandMore';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import React from 'react';

import globalize from 'lib/globalize';
import type { ReasonNode, ReasonOutcome, ReasonSubject } from '../api/types';
import { formatReasonCode } from '../utils/formatReasonCode';

const getOutcomeColor = (outcome: ReasonOutcome) => {
    switch (outcome) {
        case 'Chosen':
            return 'success';
        case 'Accepted':
            return 'info';
        case 'Rejected':
            return 'default';
    }
};

/** `ReasonSubject.StreamIndex`/`SourceId` are nullable on the wire and arrive as `undefined`
 * (design doc PR1 note: `JsonIgnoreCondition.WhenWritingNull`), not a literal `null` — checked
 * with plain truthiness rather than `=== null` throughout this component. */
const formatSubject = (subject: ReasonSubject): string => {
    const kindLabel = globalize.translate(`ReasonSubjectKind.${subject.Kind}`);
    // Deliberate loose `!= null`: catches both a literal `null` and the `undefined` the server
    // actually sends for an omitted property (see file-level note above) in one check.
    if (subject.StreamIndex != null) {
        return `${kindLabel} #${subject.StreamIndex}`;
    }
    if (subject.SourceId) {
        return `${kindLabel} (${subject.SourceId})`;
    }
    return kindLabel;
};

interface ReasonNodeHeaderProps {
    node: ReasonNode
}

const ReasonNodeHeader = ({ node }: ReasonNodeHeaderProps) => (
    <Stack direction='row' spacing={1} alignItems='center' sx={{ flexWrap: 'wrap' }}>
        <Chip size='small' color={getOutcomeColor(node.Outcome)} label={globalize.translate(`ReasonOutcome.${node.Outcome}`)} />
        <Typography component='span'>{formatReasonCode(node.Code)}</Typography>
        <Typography component='span' color='text.secondary' variant='body2'>
            {formatSubject(node.Subject)}
        </Typography>
    </Stack>
);

interface ReasonTreeNodeProps {
    node: ReasonNode
    /** 0-based depth, used only to give nested accordions distinct MUI keys/testids. */
    depth: number
}

const ReasonTreeNode = ({ node, depth }: ReasonTreeNodeProps) => {
    const hasChildren = node.Children.length > 0;

    if (!hasChildren) {
        return (
            <Box sx={{ paddingY: 1 }}>
                <ReasonNodeHeader node={node} />
                {node.Detail && (
                    <Typography variant='body2' color='text.secondary' sx={{ marginTop: 0.5 }}>
                        {node.Detail}
                    </Typography>
                )}
            </Box>
        );
    }

    return (
        <Accordion
            defaultExpanded
            disableGutters
            data-depth={depth}
        >
            <AccordionSummary expandIcon={<ExpandMore />}>
                <ReasonNodeHeader node={node} />
            </AccordionSummary>
            <AccordionDetails>
                {node.Detail && (
                    <Typography variant='body2' color='text.secondary' sx={{ marginBottom: 1 }}>
                        {node.Detail}
                    </Typography>
                )}
                <Stack spacing={1} sx={{ paddingLeft: 2 }}>
                    {node.Children.map((child, index) => (
                        <ReasonTreeNode
                            // ReasonNode has no stable identifier of its own; Code + position is
                            // the best available key within a single render of a given parent.
                            // eslint-disable-next-line react/no-array-index-key
                            key={`${child.Code}-${index}`}
                            node={child}
                            depth={depth + 1}
                        />
                    ))}
                </Stack>
            </AccordionDetails>
        </Accordion>
    );
};

interface ReasonTreeProps {
    root: ReasonNode
}

/**
 * Renders `PlaybackDiagnosticDetail.Reasoning` (design doc §5.3): a recursive breakdown of why
 * the engine accepted/rejected/chose each option. Depth in the normative PR91 §5 example is 3-4
 * levels, so nested MUI `Accordion`s (already used elsewhere in the dashboard, e.g.
 * `PluginRevisions.tsx`) are used instead of a dedicated tree-view library — `AccordionSummary`
 * is a native `<button>`-backed disclosure widget, so Tab/Enter/Space and `aria-expanded` work
 * without extra wiring. This covers "basic keyboard accessibility"; a full ARIA treeview
 * (roving tabindex, arrow-key navigation) is left to PR3 per the design doc's own plan (§6).
 */
const ReasonTree = ({ root }: ReasonTreeProps) => (
    <ReasonTreeNode node={root} depth={0} />
);

export default ReasonTree;
