import ExpandMore from '@mui/icons-material/ExpandMore';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import React, { type KeyboardEvent, createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

import globalize from 'lib/globalize';
import type { ReasonNode, ReasonOutcome, ReasonSubject } from '../api/types';
import {
    flattenVisibleReasonTree,
    getChildPath,
    getReasonTreeKeyAction,
    isReasonTreeNavigationKey,
    ROOT_PATH
} from '../utils/flattenReasonTree';
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

/**
 * Roving-tabindex/keyboard state shared by every `ReasonTreeNode` in a tree, following the
 * WAI-ARIA Authoring Practices "Tree View" pattern: exactly one node is a Tab stop at a time
 * (`activePath`), Up/Down/Left/Right/Home/End move it, and expand/collapse state is tracked here
 * (as a *collapsed*-paths set, since every node starts expanded) rather than left to each
 * `Accordion`'s own uncontrolled state, so the keyboard handler always knows what is visible.
 */
interface ReasonTreeContextValue {
    activePath: string
    isCollapsed: (path: string) => boolean
    setActivePath: (path: string) => void
    toggleCollapsed: (path: string, expanded: boolean) => void
    registerItemRef: (path: string, element: HTMLElement | null) => void
}

const ReasonTreeContext = createContext<ReasonTreeContextValue | null>(null);

const useReasonTreeContext = (): ReasonTreeContextValue => {
    const context = useContext(ReasonTreeContext);
    if (!context) {
        throw new Error('ReasonTreeNode must be rendered within a ReasonTree');
    }
    return context;
};

interface ReasonTreeNodeProps {
    node: ReasonNode
    path: string
    depth: number
}

const ReasonTreeNode = ({ node, path, depth }: ReasonTreeNodeProps) => {
    const { activePath, isCollapsed, setActivePath, toggleCollapsed, registerItemRef } = useReasonTreeContext();
    const hasChildren = node.Children.length > 0;
    const tabIndex = activePath === path ? 0 : -1;

    const setRef = useCallback((element: HTMLElement | null) => {
        registerItemRef(path, element);
    }, [ path, registerItemRef ]);

    // Clicking/tabbing to a node makes it the tree's roving tabindex focus, same as ArrowUp/Down.
    const onFocus = useCallback(() => setActivePath(path), [ path, setActivePath ]);

    const onAccordionChange = useCallback((_event: React.SyntheticEvent, isExpanded: boolean) => {
        toggleCollapsed(path, isExpanded);
    }, [ path, toggleCollapsed ]);

    if (!hasChildren) {
        return (
            <Box
                ref={setRef}
                role='treeitem'
                aria-level={depth + 1}
                tabIndex={tabIndex}
                onFocus={onFocus}
                sx={{
                    paddingY: 1,
                    outlineOffset: 2,
                    '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' }
                }}
            >
                <ReasonNodeHeader node={node} />
                {node.Detail && (
                    <Typography variant='body2' color='text.secondary' sx={{ marginTop: 0.5 }}>
                        {node.Detail}
                    </Typography>
                )}
            </Box>
        );
    }

    const expanded = !isCollapsed(path);

    return (
        <Accordion
            expanded={expanded}
            onChange={onAccordionChange}
            disableGutters
        >
            <AccordionSummary
                ref={setRef}
                expandIcon={<ExpandMore />}
                role='treeitem'
                aria-level={depth + 1}
                tabIndex={tabIndex}
                onFocus={onFocus}
            >
                <ReasonNodeHeader node={node} />
            </AccordionSummary>
            <AccordionDetails>
                {node.Detail && (
                    <Typography variant='body2' color='text.secondary' sx={{ marginBottom: 1 }}>
                        {node.Detail}
                    </Typography>
                )}
                <Stack role='group' spacing={1} sx={{ paddingLeft: 2 }}>
                    {node.Children.map((child, index) => (
                        <ReasonTreeNode
                            key={getChildPath(path, index)}
                            node={child}
                            path={getChildPath(path, index)}
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
    /** Accessible name for the `role="tree"` container (e.g. the visible section heading). */
    label: string
}

/**
 * Renders `PlaybackDiagnosticDetail.Reasoning` (design doc §5.3) as a WAI-ARIA Tree View
 * (https://www.w3.org/WAI/ARIA/apg/patterns/treeview/): `role="tree"`/`"treeitem"`/`"group"`,
 * `aria-level`, and roving tabindex with Up/Down/Left/Right/Home/End navigation. Built as a thin
 * accessibility layer *on top of* the existing `Accordion`-based rendering from PR2 rather than a
 * rewrite: `Accordion`'s own expand/collapse animation, focus ring, and `aria-expanded`
 * computation are all reused unchanged (controlled via `expanded`/`onChange` instead of
 * `defaultExpanded` so this component's keyboard handler always knows what's visible) — only
 * `role`/`tabIndex`/`aria-level` are added, which `AccordionSummary` forwards straight through to
 * its underlying `ButtonBase` and lets the caller override (verified against
 * `@mui/material/ButtonBase`'s `{...buttonProps, ...other}` merge order).
 */
const ReasonTree = ({ root, label }: ReasonTreeProps) => {
    const [ activePath, setActivePath ] = useState(ROOT_PATH);
    const [ collapsedPaths, setCollapsedPaths ] = useState<Set<string>>(() => new Set());
    const itemRefs = useRef(new Map<string, HTMLElement>());

    const isCollapsed = useCallback((path: string) => collapsedPaths.has(path), [ collapsedPaths ]);

    const toggleCollapsed = useCallback((path: string, expanded: boolean) => {
        setCollapsedPaths(previous => {
            const next = new Set(previous);
            if (expanded) {
                next.delete(path);
            } else {
                next.add(path);
            }
            return next;
        });
    }, []);

    const registerItemRef = useCallback((path: string, element: HTMLElement | null) => {
        if (element) {
            itemRefs.current.set(path, element);
        } else {
            itemRefs.current.delete(path);
        }
    }, []);

    const focusPath = useCallback((path: string) => {
        setActivePath(path);
        itemRefs.current.get(path)?.focus();
    }, []);

    const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
        if (!isReasonTreeNavigationKey(event.key)) {
            return;
        }

        const flat = flattenVisibleReasonTree(root, isCollapsed);
        const currentIndex = flat.findIndex(item => item.path === activePath);
        const action = getReasonTreeKeyAction(event.key, flat, currentIndex, isCollapsed);
        if (!action) {
            return;
        }

        event.preventDefault();
        if (action.type === 'focus') {
            focusPath(action.path);
        } else {
            toggleCollapsed(action.path, action.expand);
        }
    }, [ root, activePath, isCollapsed, toggleCollapsed, focusPath ]);

    const contextValue = useMemo<ReasonTreeContextValue>(() => ({
        activePath,
        isCollapsed,
        setActivePath,
        toggleCollapsed,
        registerItemRef
    }), [ activePath, isCollapsed, toggleCollapsed, registerItemRef ]);

    return (
        <ReasonTreeContext.Provider value={contextValue}>
            <Box role='tree' aria-label={label} onKeyDown={onKeyDown}>
                <ReasonTreeNode node={root} path={ROOT_PATH} depth={0} />
            </Box>
        </ReasonTreeContext.Provider>
    );
};

export default ReasonTree;
