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
import { LibraryItemsEmpty, LibraryItemsFailure } from './LibraryItemsGrid';

const CARD = 'a[data-rf-slot="media-card"][href]';
/** Where a `?page=` target lands below the top of the viewport. */
const LEGACY_LINK_OFFSET = 96;

export interface ContinuousLibraryGridProps {
    params: Omit<LibraryItemsParams, 'startIndex' | 'limit'>;
    /** Identifies the result set: library and filters. The parent remounts this grid when it changes. */
    context: string;
    pageSize: number;
    /** Where an old `?page=N` link starts. A remembered return position takes precedence. */
    legacyStartIndex?: number;
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
    legacyStartIndex,
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
        { index: number; offset: number; href?: string } | undefined
    >(
        saved ??
            (legacyStartIndex
                ? { index: legacyStartIndex, offset: LEGACY_LINK_OFFSET }
                : undefined)
    );
    const [anchorIndex, setAnchorIndex] = useState(
        pendingTarget.current?.index ?? 0
    );

    const [geometry, setGeometry] = useState<LibraryGeometry>();
    const [windowRows, setWindowRows] = useState<RowRange>();
    const [pinnedIndex, setPinnedIndex] = useState<number>();
    const [knownTotal, setKnownTotal] = useState(saved?.total);

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

    const { pages, observers } = useLibraryItemPages(params, limit, starts);
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
    if (total && anchorIndex >= total) {
        const last = total - 1;
        setAnchorIndex(last);
        if (pendingTarget.current) pendingTarget.current.index = last;
    }

    const items = useMemo(() => {
        const byIndex = new Map<number, ReturnType<typeof toMediaCardProps>>();
        const seen = new Set<string>();
        pages.forEach((page, position) => {
            page?.data?.Items?.forEach((item, offset) => {
                const card = toMediaCardProps(item, apiClient, cardAspect);
                // Without a unique server sort key a row can recur across a boundary. The slot
                // stays empty so that every later item keeps its computed place.
                if (card.href && !seen.has(card.href)) {
                    seen.add(card.href);
                    byIndex.set(starts[position] + offset, card);
                }
            });
        });
        return byIndex;
        // `useQueries` returns a new array each render; these two say when its content changed.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        apiClient,
        cardAspect,
        starts.join(),
        pages.map((page) => page?.dataUpdatedAt).join()
    ]);
    const indexByHref = useMemo(() => {
        const map = new Map<string, number>();
        items.forEach((card, index) => map.set(card.href!, index));
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
        setGeometry((current) =>
            current?.columns === columns &&
            current.rowHeight === rowHeight &&
            current.rowGap === rowGap
                ? current
                : { columns, rowHeight, rowGap }
        );
    }, []);

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
            setGeometry({ ...geometry, rowHeight: tallest });
        }
    }, [geometry, items, windowRows]);

    // Keep the same item in view when a resize or a new row height moves every row.
    const viewAnchor = useRef<{ index: number; offset: number }>();
    const previousPitch = useRef<string>();
    useLayoutEffect(() => {
        const element = root.current;
        if (!element || !geometry) return;
        const signature = `${geometry.columns}:${rowPitch(geometry)}`;
        const moved =
            previousPitch.current !== undefined &&
            previousPitch.current !== signature;
        previousPitch.current = signature;
        const anchor = viewAnchor.current;
        if (moved && anchor && !pendingTarget.current) {
            const top = element.getBoundingClientRect().top + window.scrollY;
            const row = Math.floor(anchor.index / geometry.columns);
            window.scrollTo({
                top: top + row * rowPitch(geometry) - anchor.offset,
                behavior: 'instant'
            });
        }
        updateWindow();
    }, [geometry, updateWindow]);

    useEffect(() => {
        let frame = 0;
        const element = root.current;
        const onScroll = () => {
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                if (element && geometry && !pendingTarget.current) {
                    const box = element.getBoundingClientRect();
                    const pitch = rowPitch(geometry);
                    const row = Math.max(0, Math.floor(-box.top / pitch));
                    viewAnchor.current = {
                        index: row * geometry.columns,
                        offset: box.top + row * pitch
                    };
                }
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
    }, [geometry, updateWindow]);

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
        if (target.href) {
            const card =
                [...element.querySelectorAll<HTMLElement>(CARD)].find(
                    (node) => node.getAttribute('href') === target.href
                ) ?? cardAtIndex(element, items.get(target.index)?.href);
            card?.focus({ preventScroll: true });
        }
        updateWindow();
    }, [geometry, items, returnKey, targetLoaded, updateWindow, windowRows]);

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

    if (total === 0) {
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

    const minItemWidth = cardAspect === 'backdrop' ? '16rem' : undefined;
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
                <div ref={root} className='rf-library-continuous'>
                    <MediaGrid
                        density={density}
                        aria-label={label}
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
            <div
                ref={root}
                className='rf-library-continuous'
                style={style}
                data-rf-total={total}
                onFocus={onFocus}
                onKeyDownCapture={onKeyDownCapture}
            >
                <MediaGrid
                    density={density}
                    aria-label={label}
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
