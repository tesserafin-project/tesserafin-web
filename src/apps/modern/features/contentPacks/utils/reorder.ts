/**
 * Move one entry of an ordering by one position (#138 §7).
 *
 * Pure and total: an out-of-range index, or a move that would leave the array, returns the SAME
 * array reference. The caller uses that identity to decide there is nothing to persist — which is
 * what stops a keypress on a disabled first/last control from issuing a reorder that would rewrite
 * the whole ordering to exactly what it already was.
 *
 * Every id is kept, exactly once, in one array: the server's reorder operation is "here is the
 * complete ordering", so a helper that could drop or duplicate an id would corrupt the ordering of
 * packs it was never asked about.
 */
const swap = <T>(items: T[], a: number, b: number): T[] => {
    const next = [...items];
    [next[a], next[b]] = [next[b], next[a]];
    return next;
};

export const moveUp = <T>(items: T[], index: number): T[] =>
    index <= 0 || index >= items.length ? items : swap(items, index, index - 1);

export const moveDown = <T>(items: T[], index: number): T[] =>
    index < 0 || index >= items.length - 1
        ? items
        : swap(items, index, index + 1);
