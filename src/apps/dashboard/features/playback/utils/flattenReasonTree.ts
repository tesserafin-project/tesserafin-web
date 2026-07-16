import type { ReasonNode } from '../api/types';

/** Path of a `ReasonTree` node relative to the root, e.g. `'0'`, `'0.1'`, `'0.1.2'` — used as both
 * a stable React key and the identity roving tabindex/keyboard navigation operates on. */
export const ROOT_PATH = '0';

export const getChildPath = (parentPath: string, index: number): string =>
    `${parentPath}.${index}`;

export interface FlatReasonTreeItem {
    path: string;
    node: ReasonNode;
    depth: number;
    parentPath: string | null;
}

/**
 * Flattens a `ReasonNode` tree into the ordered list of nodes that are actually visible given
 * which ancestor paths are collapsed — the same list a sighted user can see, and therefore the
 * list ArrowUp/ArrowDown/Home/End should navigate over (WAI-ARIA Tree View pattern). Pure and
 * independent of rendering: `ReasonTree`'s keyboard handler uses this to compute navigation
 * targets without querying the DOM, so a node's real visibility (its own render tree, not just a
 * CSS visibility trick) always matches what this function reports.
 */
export const flattenVisibleReasonTree = (
    root: ReasonNode,
    isCollapsed: (path: string) => boolean,
    rootPath: string = ROOT_PATH
): FlatReasonTreeItem[] => {
    const items: FlatReasonTreeItem[] = [];

    const visit = (
        node: ReasonNode,
        path: string,
        depth: number,
        parentPath: string | null
    ) => {
        items.push({ path, node, depth, parentPath });

        if (node.Children.length > 0 && !isCollapsed(path)) {
            node.Children.forEach((child, index) => {
                visit(child, getChildPath(path, index), depth + 1, path);
            });
        }
    };

    visit(root, rootPath, 0, null);

    return items;
};

/** A keyboard-driven outcome for the WAI-ARIA Tree View pattern: either move the roving-tabindex
 * focus, or expand/collapse the current node. */
export type ReasonTreeKeyAction =
    | { type: 'focus'; path: string }
    | { type: 'toggle'; path: string; expand: boolean };

const NAVIGATION_KEYS = new Set([
    'ArrowDown',
    'ArrowUp',
    'ArrowRight',
    'ArrowLeft',
    'Home',
    'End'
]);

export const isReasonTreeNavigationKey = (key: string): boolean =>
    NAVIGATION_KEYS.has(key);

const getArrowRightAction = (
    current: FlatReasonTreeItem,
    flat: FlatReasonTreeItem[],
    currentIndex: number,
    isCollapsed: (path: string) => boolean
): ReasonTreeKeyAction | undefined => {
    if (current.node.Children.length === 0) {
        return undefined;
    }
    if (isCollapsed(current.path)) {
        return { type: 'toggle', path: current.path, expand: true };
    }
    const next = flat[currentIndex + 1];
    return next?.parentPath === current.path
        ? { type: 'focus', path: next.path }
        : undefined;
};

const getArrowLeftAction = (
    current: FlatReasonTreeItem,
    isCollapsed: (path: string) => boolean
): ReasonTreeKeyAction | undefined => {
    if (current.node.Children.length > 0 && !isCollapsed(current.path)) {
        return { type: 'toggle', path: current.path, expand: false };
    }
    return current.parentPath
        ? { type: 'focus', path: current.parentPath }
        : undefined;
};

/**
 * Computes what a navigation key should do, per the WAI-ARIA Tree View keyboard interaction
 * model (https://www.w3.org/WAI/ARIA/apg/patterns/treeview/): Up/Down move between visible
 * items, Right opens a closed node (or steps into its first child if already open), Left closes
 * an open node (or steps to its parent if already closed/a leaf), Home/End jump to the first/last
 * visible item. Pure and independent of React so `ReasonTree`'s `onKeyDown` handler stays a thin
 * dispatcher (kept out of it originally to reduce that handler's cognitive complexity).
 */
export const getReasonTreeKeyAction = (
    key: string,
    flat: FlatReasonTreeItem[],
    currentIndex: number,
    isCollapsed: (path: string) => boolean
): ReasonTreeKeyAction | undefined => {
    const current = flat[currentIndex];
    if (!current) {
        return undefined;
    }

    switch (key) {
        case 'ArrowDown':
            return flat[currentIndex + 1]
                ? { type: 'focus', path: flat[currentIndex + 1].path }
                : undefined;
        case 'ArrowUp':
            return flat[currentIndex - 1]
                ? { type: 'focus', path: flat[currentIndex - 1].path }
                : undefined;
        case 'ArrowRight':
            return getArrowRightAction(
                current,
                flat,
                currentIndex,
                isCollapsed
            );
        case 'ArrowLeft':
            return getArrowLeftAction(current, isCollapsed);
        case 'Home':
            return flat[0] ? { type: 'focus', path: flat[0].path } : undefined;
        case 'End':
            return flat.length > 0
                ? { type: 'focus', path: flat[flat.length - 1].path }
                : undefined;
        default:
            return undefined;
    }
};
