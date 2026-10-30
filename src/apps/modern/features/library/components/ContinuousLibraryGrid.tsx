import React, {
    type CSSProperties,
    type FC,
    type FocusEvent,
    type ReactNode,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';

import { plainCardNavigation } from 'apps/modern/utils/mediaCardNavigation';
import { useApi } from 'hooks/useApi';
import globalize from 'lib/globalize';
import { LoadingState, MediaCard, MediaGrid } from 'ui';

import { useLibraryItemPages } from '../api/useLibraryItemPages';
import type { LibraryItemsParams } from '../api/useLibraryItems';
import type { LibraryViewMode } from '../constants/librarySections';
import type { LibraryDensity } from '../utils/density';
import type { LibraryCardAspect } from '../utils/libraryRecipe';
import {
    forgetLibraryPosition,
    libraryOwner,
    libraryReturnKey,
    readLibraryPosition,
    rememberLibraryPosition
} from '../utils/libraryReturnPosition';
import {
    continuousPageSize,
    expandRows,
    type LibraryGeometry,
    mountedSegments,
    OVERSCAN_ROWS,
    pageStarts,
    PRELOAD_ROWS,
    rowCount,
    rowPitch,
    type RowRange,
    rowsInView,
    UNMEASURED_CARDS
} from '../utils/libraryWindow';
import { type ImageApiClient, toMediaCardProps } from '../utils/mediaCardProps';
import { classifyLibraryFailure } from '../utils/libraryAccess';
import { LibraryItemsEmpty, LibraryItemsFailure } from './LibraryItemsGrid';

const CARD = 'a[data-rf-slot="media-card"][href]';
/** Where a `?page=` target lands below the top of the viewport. */
const LEGACY_LINK_OFFSET = 96;

/** Where an old `?page=N` link starts. A new `request` moves a grid already mounted. */
export interface LegacyStart {
    index: number;
    request: number;
}

export interface ContinuousLibraryGridProps {
    params: Omit<LibraryItemsParams, 'startIndex' | 'limit'>;
    /** Identifies the result set: library and filters. The parent remounts this grid when it changes. */
    context: string;
    pageSize: number;
    /** A remembered return position takes precedence over this when the grid mounts. */
    legacyStart?: LegacyStart;
    viewMode: LibraryViewMode;
    density: LibraryDensity;
    cardAspect: LibraryCardAspect;
    apiClient: ImageApiClient | undefined;
    label: string;
    onResetFilters?: () => void;
}

/**
 * Browse without page controls. The grid's height stands for the whole result set while only the
 * rows near the viewport are mounted and only the pages they touch are requested, so the cost of a
 * position does not depend on its depth.
 */
export const ContinuousLibraryGrid: FC<ContinuousLibraryGridProps> = ({
    params,
    context,
    pageSize,
    legacyStart,
    viewMode,
    density,
    cardAspect,
    apiClient,
    label,
    onResetFilters
}) => {
    const { user } = useApi();
    const location = useLocation();
    const navigate = useNavigate();
    const navigation = useNavigationType();
    const limit = continuousPageSize(pageSize);
    const owner = libraryOwner(user?.ServerId ?? '', user?.Id ?? '');
    const returnKey = libraryReturnKey(context, location.key);

    const root = useRef<HTMLDivElement>(null);
    const [saved] = useState(() =>
        navigation === 'POP' ? readLibraryPosition(owner, returnKey) : undefined
    );
    /** While set, the window follows this target instead of a scroll position not yet restored. */
    const pendingTarget = useRef<
        | { index: number; offset: number; href?: string; takeFocus?: boolean }
        | undefined
    >(
        saved ??
            (legacyStart
                ? { index: legacyStart.index, offset: LEGACY_LINK_OFFSET }
                : undefined)
    );
    const [anchorIndex, setAnchorIndex] = useState(
        pendingTarget.current?.index ?? 0
    );

    const [geometry, setGeometry] = useState<LibraryGeometry>();
    const [windowRows, setWindowRows] = useState<RowRange>();
    const [pinnedIndex, setPinnedIndex] = useState<number>();
    const [knownTotal, setKnownTotal] = useState(saved?.total);
    const [, rerunRestore] = useState(0);
    const [returnMissing, setReturnMissing] = useState(false);

    const pinnedRow =
        geometry && pinnedIndex !== undefined
            ? Math.floor(pinnedIndex / geometry.columns)
            : undefined;

    const starts = useMemo(() => {
        if (!geometry || !windowRows || knownTotal === undefined) {
            return pageStarts(anchorIndex, anchorIndex, limit);
        }
        const { columns } = geometry;
        const wanted = expandRows(
            windowRows,
            PRELOAD_ROWS,
            knownTotal,
            columns
        );
        const all = pageStarts(
            wanted.first * columns,
            Math.min(knownTotal - 1, (wanted.last + 1) * columns - 1),
            limit
        );
        // The focused row stays mounted, so its page has to stay observed.
        if (pinnedIndex !== undefined) {
            const pinned = Math.floor(pinnedIndex / limit) * limit;
            if (!all.includes(pinned)) all.push(pinned);
        }
        return all;
    }, [anchorIndex, geometry, knownTotal, limit, pinnedIndex, windowRows]);

    const { pages, observers, cachedPages } = useLibraryItemPages(
        params,
        limit,
        starts
    );
    const pageAt = (start: number) => pages[starts.indexOf(start)];

    // The newest answer wins: a library can change while it is being browsed.
    let freshest = -1;
    let responseTotal: number | undefined;
    pages.forEach((page) => {
        if (page?.isSuccess && page.dataUpdatedAt > freshest) {
            freshest = page.dataUpdatedAt;
            responseTotal = page.data?.TotalRecordCount ?? 0;
        }
    });
    if (responseTotal !== undefined && responseTotal !== knownTotal) {
        setKnownTotal(responseTotal);
    }
    const total = responseTotal ?? knownTotal;

    // An old link or a shrunken library can point past the end; the last page is the nearest one.
    if (
        total &&
        pendingTarget.current &&
        pendingTarget.current.index >= total
    ) {
        pendingTarget.current.index = total - 1;
    }
    if (total && anchorIndex >= total) {
        setAnchorIndex(total - 1);
    }

    const { items, repeatedRows, shortPages } = useMemo(() => {
        const byIndex = new Map<number, ReturnType<typeof toMediaCardProps>>();
        const seen = new Set<string>();
        let repeated = 0;
        let short = 0;
        pages.forEach((page, position) => {
            const answered = page?.data?.Items;
            if (!answered) return;
            const expected = Math.min(
                limit,
                (page.data?.TotalRecordCount ?? 0) - starts[position]
            );
            if (answered.length < expected) short += 1;
            answered.forEach((item, offset) => {
                const card = toMediaCardProps(item, apiClient, cardAspect);
                // The server's order is total, so this needs a library that changed between two
                // requests, or an older server. Each item keeps its server index: the slot stays
                // empty so that every later item keeps its place, and the count stays readable
                // on the grid so that no proof can pass with an omission hidden here.
                if (!card.href) return;
                if (seen.has(card.href)) {
                    repeated += 1;
                    return;
                }
                seen.add(card.href);
                byIndex.set(starts[position] + offset, card);
            });
        });
        return { items: byIndex, repeatedRows: repeated, shortPages: short };
        // `useQueries` returns a new array each render; these two say when its content changed.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        apiClient,
        cardAspect,
        limit,
        starts.join(),
        pages.map((page) => page?.dataUpdatedAt).join()
    ]);

    // The target's own page answered without it, as when the item left the end of a shorter page:
    // settle on the nearest item before it rather than wait for one that is not coming.
    const settling = pendingTarget.current;
    if (settling && !items.has(settling.index)) {
        const page = pageAt(Math.floor(settling.index / limit) * limit);
        if (page?.isSuccess) {
            const earlier = [...items.keys()].filter(
                (index) => index < settling.index
            );
            if (earlier.length) {
                settling.index = Math.max(...earlier);
            } else {
                pendingTarget.current = undefined;
                forgetLibraryPosition(returnKey);
            }
        }
    }

    const indexByHref = useMemo(() => {
        const map = new Map<string, number>();
        for (const [index, card] of items) map.set(card.href!, index);
        return map;
    }, [items]);

    const updateWindow = useCallback(() => {
        const element = root.current;
        if (!element || !geometry || !total) return;
        const target = pendingTarget.current;
        const rows = target
            ? (() => {
                  const row = Math.floor(target.index / geometry.columns);
                  return { first: row, last: row };
              })()
            : rowsInView(
                  -element.getBoundingClientRect().top,
                  window.innerHeight,
                  geometry,
                  total
              );
        const next = expandRows(rows, OVERSCAN_ROWS, total, geometry.columns);
        setWindowRows((current) =>
            current?.first === next.first && current.last === next.last
                ? current
                : next
        );
        // Focus left the grid without another element taking it: nothing to keep mounted.
        if (!element.contains(document.activeElement)) {
            setPinnedIndex(undefined);
        }
    }, [geometry, total]);

    const previousGeometry = useRef<LibraryGeometry>();
    const viewAnchor = useRef<{ index: number; offset: number }>();
    const captureViewAnchor = useCallback(() => {
        const element = root.current;
        const before = previousGeometry.current;
        if (
            !element ||
            !before ||
            pendingTarget.current ||
            viewAnchor.current
        ) {
            return;
        }
        const box = element.getBoundingClientRect();
        const pitch = rowPitch(before);
        const row = Math.max(0, Math.floor(-box.top / pitch));
        viewAnchor.current = {
            index: row * before.columns,
            offset: box.top + row * pitch
        };
    }, []);

    // Measuring happens before paint so that an unmeasured grid is never seen.
    const measure = useCallback(() => {
        const element = root.current;
        const grid = element?.querySelector<HTMLElement>(
            '[data-rf-slot="media-grid"]'
        );
        const card = element?.querySelector<HTMLElement>(CARD);
        if (!element || !grid || !card) return;
        const style = getComputedStyle(grid);
        const columns = Math.max(
            1,
            style.gridTemplateColumns.split(' ').filter(Boolean).length
        );
        const rowGap = Number.parseFloat(style.rowGap) || 0;
        element.style.removeProperty('--rf-library-row-height');
        const cards = element.querySelectorAll<HTMLElement>(CARD);
        let rowHeight = 0;
        cards.forEach((node) => {
            rowHeight = Math.max(rowHeight, node.offsetHeight);
        });
        if (!rowHeight) return;
        element.style.setProperty('--rf-library-row-height', `${rowHeight}px`);
        const known = previousGeometry.current;
        if (
            known?.columns === columns &&
            known.rowHeight === rowHeight &&
            known.rowGap === rowGap
        ) {
            return;
        }
        captureViewAnchor();
        setGeometry({ columns, rowHeight, rowGap });
    }, [captureViewAnchor]);

    const hasResults = !!total && items.size > 0;
    useLayoutEffect(() => {
        if (hasResults && !geometry) measure();
    }, [geometry, hasResults, measure]);

    // A card taller than the row (a row without a subtitle measured first) grows every row.
    useLayoutEffect(() => {
        if (!geometry) return;
        let tallest = geometry.rowHeight;
        root.current?.querySelectorAll<HTMLElement>(CARD).forEach((node) => {
            tallest = Math.max(tallest, node.offsetHeight);
        });
        if (tallest > geometry.rowHeight) {
            captureViewAnchor();
            setGeometry({ ...geometry, rowHeight: tallest });
        }
    }, [captureViewAnchor, geometry, items, windowRows]);

    // Keep the same item in view when a resize, a view switch or a new row height moves every row.
    // Read before the new geometry commits: a shorter document clamps the scroll position as it
    // lays out, and from then on the old position can no longer be read back.
    useLayoutEffect(() => {
        const element = root.current;
        if (!element || !geometry) return;
        previousGeometry.current = geometry;
        const anchor = viewAnchor.current;
        viewAnchor.current = undefined;
        if (anchor && !pendingTarget.current) {
            const box = element.getBoundingClientRect();
            const row = Math.floor(anchor.index / geometry.columns);
            window.scrollTo({
                top:
                    box.top +
                    window.scrollY +
                    row * rowPitch(geometry) -
                    anchor.offset,
                behavior: 'instant'
            });
        }
        updateWindow();
    }, [geometry, updateWindow]);

    // Same cards, other shape: the same measuring a resize gets, before paint.
    const measuredViewMode = useRef(viewMode);
    useLayoutEffect(() => {
        if (measuredViewMode.current === viewMode) return;
        measuredViewMode.current = viewMode;
        measure();
    }, [measure, viewMode]);

    // A `?page=N` reached while mounted: follow it now, before the parent drops it from the URL.
    const handledLegacyRequest = useRef(legacyStart?.request);
    useLayoutEffect(() => {
        if (
            !legacyStart ||
            legacyStart.request === handledLegacyRequest.current
        ) {
            return;
        }
        handledLegacyRequest.current = legacyStart.request;
        pendingTarget.current = {
            index: legacyStart.index,
            offset: LEGACY_LINK_OFFSET
        };
        setAnchorIndex(legacyStart.index);
        rerunRestore((count) => count + 1);
        updateWindow();
    }, [legacyStart, updateWindow]);

    useEffect(() => {
        let frame = 0;
        const onScroll = () => {
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                updateWindow();
            });
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onScroll);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', onScroll);
        };
    }, [updateWindow]);

    const lastWidth = useRef<number>();
    useEffect(() => {
        const element = root.current;
        // Old TV browsers lack it; the window's resize event still covers them.
        if (!element || !hasResults || typeof ResizeObserver === 'undefined') {
            return;
        }
        const observer = new ResizeObserver(() => {
            const width = element.getBoundingClientRect().width;
            if (width === lastWidth.current) return;
            lastWidth.current = width;
            measure();
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, [hasResults, measure]);

    // Restore once the target's row is really there: the scroll first, then the focus.
    const targetIndex = pendingTarget.current?.index;
    const targetLoaded = targetIndex !== undefined && items.has(targetIndex);
    useLayoutEffect(() => {
        const target = pendingTarget.current;
        const element = root.current;
        if (!target || !targetLoaded || !element || !geometry || !windowRows) {
            return;
        }
        const row = Math.floor(target.index / geometry.columns);
        if (row < windowRows.first || row > windowRows.last) return;
        pendingTarget.current = undefined;
        forgetLibraryPosition(returnKey);
        const top = element.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({
            top: top + row * rowPitch(geometry) - target.offset,
            behavior: 'instant'
        });
        if (target.takeFocus) {
            cardAtIndex(element, items.get(target.index)?.href)?.focus({
                preventScroll: true
            });
        } else if (target.href) {
            const opened = cardAtIndex(element, target.href);
            // Removed, or no longer the viewer's to see: the item now at that place takes the focus.
            if (!opened) setReturnMissing(true);
            (
                opened ?? cardAtIndex(element, items.get(target.index)?.href)
            )?.focus({
                preventScroll: true
            });
        }
        updateWindow();
    }, [geometry, items, returnKey, targetLoaded, updateWindow, windowRows]);

    useEffect(() => {
        if (!returnMissing) return;
        const dismiss = () => setReturnMissing(false);
        const types = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
        for (const type of types) {
            window.addEventListener(type, dismiss, { passive: true });
        }
        return () => {
            for (const type of types) {
                window.removeEventListener(type, dismiss);
            }
        };
    }, [returnMissing]);

    // If the viewer starts doing something while data arrives, recovery loses ownership.
    useEffect(() => {
        const cancel = () => {
            if (!pendingTarget.current) return;
            pendingTarget.current = undefined;
            forgetLibraryPosition(returnKey);
            updateWindow();
        };
        const types = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
        for (const type of types) {
            window.addEventListener(type, cancel, {
                capture: true,
                passive: true
            });
        }
        return () => {
            for (const type of types) {
                window.removeEventListener(type, cancel, true);
            }
        };
    }, [returnKey, updateWindow]);

    useEffect(() => {
        const element = root.current;
        if (!element || !user?.Id || !user.ServerId) return;
        const remember = (event: MouseEvent) => {
            const target = plainCardNavigation(event, element);
            if (!target) return;
            const index = indexByHref.get(target.href);
            if (index !== undefined && total !== undefined) {
                rememberLibraryPosition(owner, returnKey, {
                    index,
                    href: target.href,
                    offset: target.card.getBoundingClientRect().top,
                    total
                });
            }
            // Native hash changes have no unique history key and look like POP.
            event.preventDefault();
            navigate(target.href.slice(1));
        };
        element.addEventListener('click', remember);
        return () => element.removeEventListener('click', remember);
    }, [
        indexByHref,
        navigate,
        owner,
        returnKey,
        total,
        user?.Id,
        user?.ServerId
    ]);

    // The focused card left the results when its page refreshed (removed, or no longer this viewer's).
    // Its element is gone and focus with it: the item now at that place takes over.
    const focusedHref = useRef<string>();
    useLayoutEffect(() => {
        const href = focusedHref.current;
        if (!href || !total || indexByHref.has(href)) return;
        if (pinnedIndex === undefined) return;
        const pinnedPage = pageAt(Math.floor(pinnedIndex / limit) * limit);
        // Absent only because its page is still on its way proves nothing.
        if (!pinnedPage?.isSuccess || pinnedPage.isFetching) return;
        focusedHref.current = undefined;
        if (
            document.activeElement &&
            document.activeElement !== document.body
        ) {
            return;
        }
        setReturnMissing(true);
        const index = Math.min(pinnedIndex, total - 1);
        const card = cardAtIndex(root.current, items.get(index)?.href);
        if (card) {
            card.focus({ preventScroll: true });
            return;
        }
        pendingTarget.current = {
            index,
            offset: LEGACY_LINK_OFFSET,
            takeFocus: true
        };
        setPinnedIndex(undefined);
        setAnchorIndex(index);
        rerunRestore((count) => count + 1);
        updateWindow();
        // biome-ignore lint/correctness/useExhaustiveDependencies: `pageAt` reads the pages `items` follows
    }, [indexByHref, items, limit, pinnedIndex, total, updateWindow]);

    /** A retry or a load-more that had focus hands it to the first card it brought in. */
    const focusedLoader = useRef<number>();
    useLayoutEffect(() => {
        const start = focusedLoader.current;
        if (start === undefined || !items.has(start)) return;
        focusedLoader.current = undefined;
        if (
            document.activeElement &&
            document.activeElement !== document.body
        ) {
            return;
        }
        cardAtIndex(root.current, items.get(start)?.href)?.focus();
    }, [items]);

    const onFocus = useCallback(
        (event: FocusEvent<HTMLDivElement>) => {
            const target = event.target as HTMLElement;
            const loader = target.dataset.rfPageStart;
            if (loader !== undefined) {
                focusedLoader.current = Number(loader);
                setPinnedIndex(Number(loader));
                return;
            }
            focusedLoader.current = undefined;
            const href = target.closest(CARD)?.getAttribute('href');
            const index = href ? indexByHref.get(href) : undefined;
            focusedHref.current = href ?? undefined;
            if (index !== undefined) setPinnedIndex(index);
        },
        [indexByHref]
    );

    /**
     * After scrolling away, the focused row is all that is mounted of its neighbourhood. Bring it
     * back before the key acts, as the browser would for a fully rendered list, so that Tab reaches
     * the real next card rather than the first card of the distant window.
     */
    const onKeyDownCapture = useCallback(() => {
        const element = root.current;
        if (
            !element ||
            !geometry ||
            pinnedRow === undefined ||
            !windowRows ||
            (pinnedRow >= windowRows.first && pinnedRow <= windowRows.last)
        ) {
            return;
        }
        const top = element.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({
            top:
                top +
                pinnedRow * rowPitch(geometry) -
                (window.innerHeight - geometry.rowHeight) / 2,
            behavior: 'instant'
        });
        flushSync(updateWindow);
    }, [geometry, pinnedRow, updateWindow, windowRows]);

    const loadedAt = (start: number) => pageAt(start)?.isSuccess;

    // Refused: what was cached belongs to access this viewer no longer has, so none of it stays on
    // screen, and a return in progress ends here.
    const refused = pages.find(
        (page) =>
            page?.isError &&
            classifyLibraryFailure(page.error) === 'access-denied'
    );
    if (refused) {
        if (pendingTarget.current) {
            pendingTarget.current = undefined;
            forgetLibraryPosition(returnKey);
        }
        return (
            <>
                {observers}
                <LibraryItemsFailure
                    error={refused.error}
                    onRetry={() => void refused.refetch()}
                />
            </>
        );
    }

    if (total === 0) {
        // Nothing left to return to, and no item will ever settle the target.
        if (pendingTarget.current) {
            pendingTarget.current = undefined;
            forgetLibraryPosition(returnKey);
        }
        return (
            <>
                {observers}
                <LibraryItemsEmpty onResetFilters={onResetFilters} />
            </>
        );
    }
    if (total === undefined || (!hasResults && !geometry)) {
        const failed = pages.find((page) => page?.isError);
        if (failed) {
            return (
                <>
                    {observers}
                    <LibraryItemsFailure
                        error={failed.error}
                        onRetry={() => void failed.refetch()}
                    />
                </>
            );
        }
        return (
            <>
                {observers}
                <LoadingState variant='grid' />
            </>
        );
    }

    // Mounted before it has anything to say, or a screen reader would not announce it. Same position
    // in both returns below, or the grid after it would remount and take the focus with it.
    const statusLine = (
        <p role='status' className='rf-library-view__order-note'>
            {returnMissing &&
                globalize.translate('MessageLibraryReturnItemMissing')}
        </p>
    );

    // As on the paged grid: same cards, same DOM, one column in list mode.
    const minItemWidth =
        (viewMode === 'list' && '100%') ||
        (cardAspect === 'backdrop' && '16rem') ||
        undefined;
    const gridClass =
        viewMode === 'list' ? 'rf-library-view__grid--list' : undefined;
    if (!geometry || !windowRows) {
        // One frame's worth of cards to measure. The layout effects replace it before paint.
        const first = Math.floor(anchorIndex / limit) * limit;
        const measuring = [...items.entries()]
            .filter(([index]) => index >= first)
            .slice(0, UNMEASURED_CARDS)
            .map(([, card]) => <MediaCard key={card.href} {...card} />);
        return (
            <>
                {observers}
                {statusLine}
                <div ref={root} className='rf-library-continuous'>
                    <MediaGrid
                        density={density}
                        aria-label={label}
                        className={gridClass}
                        minItemWidth={minItemWidth}
                    >
                        {measuring}
                    </MediaGrid>
                </div>
            </>
        );
    }

    const { columns } = geometry;
    const pitch = rowPitch(geometry);
    const rows = rowCount(total, columns);
    const segments = mountedSegments(windowRows, pinnedRow);
    const renderSlot = (index: number): ReactNode => {
        const card = items.get(index);
        if (card) return <MediaCard key={card.href} {...card} />;
        const start = Math.floor(index / limit) * limit;
        const page = pageAt(start);
        // The first empty slot of an unanswered page holds its action, in reading order.
        if (index === start && !loadedAt(start)) {
            return (
                <div
                    key={`loader-${start}`}
                    className='rf-library-continuous__placeholder'
                >
                    {page?.isError && (
                        <p role='alert'>
                            {globalize.translate('ErrorDefault')}
                        </p>
                    )}
                    <button
                        type='button'
                        className='rf-library-view__density-toggle'
                        data-rf-page-start={start}
                        onClick={() => void page?.refetch()}
                    >
                        {globalize.translate('LoadMoreItems')}
                    </button>
                </div>
            );
        }
        return (
            <div
                key={`slot-${index}`}
                className='rf-library-continuous__placeholder'
                aria-hidden='true'
            />
        );
    };

    // One flat list: a card keeps its identity, and so its focus, as the window moves around it.
    const slots: ReactNode[] = [];
    segments.forEach((segment, position) => {
        const end = Math.min(total, (segment.last + 1) * columns);
        for (let index = segment.first * columns; index < end; index++) {
            slots.push(renderSlot(index));
        }
        const next = segments[position + 1];
        if (next) {
            slots.push(
                <div
                    key='gap'
                    aria-hidden='true'
                    className='rf-library-continuous__gap'
                    style={{
                        height: `${
                            (next.first - segment.last - 1) * pitch -
                            geometry.rowGap
                        }px`
                    }}
                />
            );
        }
    });

    const lastRow = segments[segments.length - 1].last;
    const style = {
        '--rf-library-row-height': `${geometry.rowHeight}px`,
        paddingTop: `${segments[0].first * pitch}px`,
        paddingBottom: `${Math.max(0, rows - 1 - lastRow) * pitch}px`
    } as CSSProperties;

    return (
        <>
            {observers}
            {statusLine}
            {/* Listens for what happens inside; every interactive element in it is a real link or button. */}
            {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: delegated focus tracking */}
            {/* biome-ignore lint/a11y/noStaticElementInteractions: delegated focus tracking */}
            <div
                ref={root}
                className='rf-library-continuous'
                style={style}
                data-rf-total={total}
                data-rf-repeated-rows={repeatedRows}
                data-rf-short-pages={shortPages}
                data-rf-cached-pages={cachedPages}
                onFocus={onFocus}
                onKeyDownCapture={onKeyDownCapture}
            >
                <MediaGrid
                    density={density}
                    aria-label={label}
                    className={gridClass}
                    minItemWidth={minItemWidth}
                >
                    {slots}
                </MediaGrid>
            </div>
        </>
    );
};

const cardAtIndex = (root: HTMLElement | null, href: string | undefined) =>
    href
        ? [...(root?.querySelectorAll<HTMLElement>(CARD) ?? [])].find(
              (node) => node.getAttribute('href') === href
          )
        : undefined;

export default ContinuousLibraryGrid;
