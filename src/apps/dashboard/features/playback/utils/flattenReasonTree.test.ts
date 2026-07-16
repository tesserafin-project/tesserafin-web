import { describe, expect, it } from 'vitest';

import type { ReasonNode } from '../api/types';
import {
    flattenVisibleReasonTree,
    getChildPath,
    getReasonTreeKeyAction,
    isReasonTreeNavigationKey,
    ROOT_PATH
} from './flattenReasonTree';

const leaf = (code: ReasonNode['Code']): ReasonNode => ({
    Code: code,
    Outcome: 'Accepted',
    Subject: { Kind: 'Method', StreamIndex: null, SourceId: null },
    Detail: null,
    Children: []
});

const tree: ReasonNode = {
    ...leaf('MethodChosen'),
    Children: [
        { ...leaf('VideoRangeTypeNotSupported'), Children: [] },
        {
            ...leaf('TonemapRequired'),
            Children: [{ ...leaf('VideoCodecNotSupported'), Children: [] }]
        }
    ]
};

describe('flattenVisibleReasonTree()', () => {
    it('returns every node in depth-first order when nothing is collapsed', () => {
        const result = flattenVisibleReasonTree(tree, () => false);

        expect(result.map((item) => item.path)).toEqual([
            '0',
            '0.0',
            '0.1',
            '0.1.0'
        ]);
        expect(result.map((item) => item.node.Code)).toEqual([
            'MethodChosen',
            'VideoRangeTypeNotSupported',
            'TonemapRequired',
            'VideoCodecNotSupported'
        ]);
    });

    it('excludes descendants of a collapsed node but keeps the node itself', () => {
        const result = flattenVisibleReasonTree(tree, (path) => path === '0.1');

        expect(result.map((item) => item.path)).toEqual(['0', '0.0', '0.1']);
    });

    it('collapsing the root hides every descendant', () => {
        const result = flattenVisibleReasonTree(
            tree,
            (path) => path === ROOT_PATH
        );

        expect(result.map((item) => item.path)).toEqual(['0']);
    });

    it("reports each item's parentPath for ArrowLeft-to-parent navigation", () => {
        const result = flattenVisibleReasonTree(tree, () => false);
        const byPath = new Map(result.map((item) => [item.path, item]));

        expect(byPath.get('0')?.parentPath).toBeNull();
        expect(byPath.get('0.1')?.parentPath).toBe('0');
        expect(byPath.get('0.1.0')?.parentPath).toBe('0.1');
    });

    it('reports depth for aria-level', () => {
        const result = flattenVisibleReasonTree(tree, () => false);
        const byPath = new Map(result.map((item) => [item.path, item]));

        expect(byPath.get('0')?.depth).toBe(0);
        expect(byPath.get('0.1')?.depth).toBe(1);
        expect(byPath.get('0.1.0')?.depth).toBe(2);
    });
});

describe('getChildPath()', () => {
    it('joins the parent path and index with a dot', () => {
        expect(getChildPath('0', 2)).toBe('0.2');
        expect(getChildPath('0.1', 0)).toBe('0.1.0');
    });
});

describe('isReasonTreeNavigationKey()', () => {
    it('recognizes the WAI-ARIA Tree View navigation keys', () => {
        for (const key of [
            'ArrowDown',
            'ArrowUp',
            'ArrowRight',
            'ArrowLeft',
            'Home',
            'End'
        ]) {
            expect(isReasonTreeNavigationKey(key)).toBe(true);
        }
    });

    it('rejects everything else', () => {
        expect(isReasonTreeNavigationKey('a')).toBe(false);
        expect(isReasonTreeNavigationKey('Enter')).toBe(false);
        expect(isReasonTreeNavigationKey('Tab')).toBe(false);
    });
});

describe('getReasonTreeKeyAction()', () => {
    const allExpanded = flattenVisibleReasonTree(tree, () => false);
    const withOneCollapsed = flattenVisibleReasonTree(
        tree,
        (path) => path === '0.1'
    );

    it('ArrowDown/ArrowUp move focus to the next/previous visible item', () => {
        expect(
            getReasonTreeKeyAction('ArrowDown', allExpanded, 0, () => false)
        ).toEqual({ type: 'focus', path: '0.0' });
        expect(
            getReasonTreeKeyAction('ArrowUp', allExpanded, 2, () => false)
        ).toEqual({ type: 'focus', path: '0.0' });
    });

    it('ArrowDown/ArrowUp do nothing past the ends of the list', () => {
        const lastIndex = allExpanded.length - 1;
        expect(
            getReasonTreeKeyAction(
                'ArrowDown',
                allExpanded,
                lastIndex,
                () => false
            )
        ).toBeUndefined();
        expect(
            getReasonTreeKeyAction('ArrowUp', allExpanded, 0, () => false)
        ).toBeUndefined();
    });

    it('ArrowRight on a collapsed branch expands it without moving focus', () => {
        const collapsedIndex = withOneCollapsed.findIndex(
            (item) => item.path === '0.1'
        );
        expect(
            getReasonTreeKeyAction(
                'ArrowRight',
                withOneCollapsed,
                collapsedIndex,
                (path) => path === '0.1'
            )
        ).toEqual({ type: 'toggle', path: '0.1', expand: true });
    });

    it('ArrowRight on an expanded branch moves focus to its first child', () => {
        expect(
            getReasonTreeKeyAction('ArrowRight', allExpanded, 0, () => false)
        ).toEqual({ type: 'focus', path: '0.0' });
    });

    it('ArrowRight on a leaf does nothing', () => {
        const leafIndex = allExpanded.findIndex((item) => item.path === '0.0');
        expect(
            getReasonTreeKeyAction(
                'ArrowRight',
                allExpanded,
                leafIndex,
                () => false
            )
        ).toBeUndefined();
    });

    it('ArrowLeft on an expanded branch collapses it without moving focus', () => {
        const branchIndex = allExpanded.findIndex(
            (item) => item.path === '0.1'
        );
        expect(
            getReasonTreeKeyAction(
                'ArrowLeft',
                allExpanded,
                branchIndex,
                () => false
            )
        ).toEqual({ type: 'toggle', path: '0.1', expand: false });
    });

    it('ArrowLeft on a leaf or collapsed branch moves focus to its parent', () => {
        const leafIndex = allExpanded.findIndex(
            (item) => item.path === '0.1.0'
        );
        expect(
            getReasonTreeKeyAction(
                'ArrowLeft',
                allExpanded,
                leafIndex,
                () => false
            )
        ).toEqual({ type: 'focus', path: '0.1' });
    });

    it('ArrowLeft on an already-collapsed root does nothing (no parent to move to)', () => {
        const isCollapsed = (path: string) => path === ROOT_PATH;
        const rootCollapsed = flattenVisibleReasonTree(tree, isCollapsed);
        expect(
            getReasonTreeKeyAction('ArrowLeft', rootCollapsed, 0, isCollapsed)
        ).toBeUndefined();
    });

    it('Home/End jump to the first/last visible item', () => {
        expect(
            getReasonTreeKeyAction('Home', allExpanded, 2, () => false)
        ).toEqual({ type: 'focus', path: '0' });
        expect(
            getReasonTreeKeyAction('End', allExpanded, 0, () => false)
        ).toEqual({ type: 'focus', path: '0.1.0' });
    });

    it('returns undefined for an out-of-range current index', () => {
        expect(
            getReasonTreeKeyAction('ArrowDown', allExpanded, -1, () => false)
        ).toBeUndefined();
    });
});
