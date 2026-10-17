import type { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';
import { getImageApi } from '@jellyfin/sdk/lib/utils/api/image-api';
import React, { type FC, useEffect, useMemo, useRef } from 'react';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import { Link } from 'react-router-dom';

import layoutManager from 'components/layoutManager';
import { useApi } from 'hooks/useApi';
import globalize from 'lib/globalize';
import browser from 'scripts/browser';
import {
    ErrorState,
    LoadingState,
    MediaCard,
    MediaShelf,
    usePresentation
} from 'ui';

import { useSearchItems } from '../api/useSearchItems';
import {
    getRowImageAspect,
    toSearchCardProps,
    type ImageUrlBuilder
} from '../utils/searchCardProps';
import { useSearchCardActions } from './searchCardActions';
import { SearchSelectionBar, useSearchSelection } from './searchSelection';

import './searchresults.scss';

const STATE_KEY = 'searchResultsState';
const LONG_PRESS_MS = 550;

/** The card under `target`, and its row and position, from the rendered shelves. */
const locateCard = (
    target: EventTarget | null,
    rows?: { items: BaseItemDto[] }[]
) => {
    const card = (target as HTMLElement | null)?.closest?.<HTMLElement>(
        '[data-rf-slot="media-card"]'
    );
    const shelf = card?.closest<HTMLElement>('[data-rf-slot="media-shelf"]');
    const section = rows?.[Number(shelf?.dataset.row)];
    if (!card?.parentElement || !section) return undefined;
    const index = Array.prototype.indexOf.call(
        card.parentElement.children,
        card
    );
    return { card, items: section.items, index, item: section.items[index] };
};
const MAX_SAVED = 20;

interface SavedPosition {
    y: number;
    rows: Record<string, number>;
}

/** Saved positions, one per search: query AND scope, so another search or library starts fresh. */
const readSaved = (): Record<string, SavedPosition> => {
    try {
        return JSON.parse(sessionStorage.getItem(STATE_KEY) || '{}');
    } catch {
        return {};
    }
};

interface SearchResultsProps {
    parentId?: string;
    collectionType?: CollectionType;
    query?: string;
}

/*
 * React component to display search result rows for global search and library view search
 */
const SearchResults: FC<SearchResultsProps> = ({
    parentId,
    collectionType,
    query
}) => {
    const { data, isPending, isError, refetch } = useSearchItems(
        parentId,
        collectionType,
        query?.trim()
    );
    const { api } = useApi();
    const { getActions, onContextMenu, runCommand } = useSearchCardActions();
    const selection = useSearchSelection();
    const density = usePresentation().page.home.shelfDensity;
    // As before: multi-select on desktop and mobile layouts, not on TV.
    const canSelect = !layoutManager.tv;
    // The click a mouse release sends right after a long press must not also open the card: only
    // that card's click, and only just after. A touch long press sends `contextmenu` and no click,
    // so a plain flag would eat the viewer's next tap.
    const swallowClick = useRef<{ id: string; until: number } | null>(null);
    const element = useRef<HTMLDivElement>(null);
    const scrollers = useRef<Record<string, HTMLDivElement | null>>({});
    const stateKey = `${parentId ?? ''}|${collectionType ?? ''}|${query ?? ''}`;

    const imageUrl = useMemo<ImageUrlBuilder | undefined>(
        () =>
            api &&
            ((itemId, imageType, tag) =>
                getImageApi(api).getItemImageUrlById(
                    itemId,
                    imageType as Parameters<
                        ReturnType<typeof getImageApi>['getItemImageUrlById']
                    >[1],
                    { quality: 96, tag }
                )),
        [api]
    );

    // Coming back from a result lands where the viewer left the list — page AND each row — not at
    // the top. Taken when a result is opened (the next page may scroll to the top before this one
    // unmounts), restored a frame after mount, past the page's own `viewshow` scroll reset.
    useEffect(() => {
        if (!data?.length) return;
        const saved = readSaved()[stateKey];
        if (!saved) return;
        const frame = requestAnimationFrame(() => {
            window.scrollTo(0, saved.y);
            for (const [title, x] of Object.entries(saved.rows)) {
                const scroller = scrollers.current[title];
                if (scroller) scroller.scrollLeft = x;
            }
        });
        return () => cancelAnimationFrame(frame);
    }, [data, stateKey]);

    const rememberPosition = () => {
        const rows: Record<string, number> = {};
        for (const [title, scroller] of Object.entries(scrollers.current)) {
            if (scroller?.scrollLeft) rows[title] = scroller.scrollLeft;
        }
        const saved = readSaved();
        delete saved[stateKey];
        saved[stateKey] = { y: window.scrollY, rows };
        const keys = Object.keys(saved);
        for (const key of keys.slice(0, Math.max(0, keys.length - MAX_SAVED))) {
            delete saved[key];
        }
        try {
            sessionStorage.setItem(STATE_KEY, JSON.stringify(saved));
        } catch {
            /* storage unavailable: nothing to restore later */
        }
    };

    const { cancel: cancelSelection, start: startSelection } = selection;
    // Read through a ref by the long-press listener, so a refetch landing mid-press does not
    // re-install it and drop the pending timer.
    const dataRef = useRef(data);
    dataRef.current = data;
    const hasResults = !!data?.length;
    // A selection belongs to one search: another query or scope ends it.
    useEffect(() => cancelSelection, [stateKey, cancelSelection]);

    // Long press, touch or mouse, starts selecting with the pressed card, as the old rows did.
    useEffect(() => {
        const container = element.current;
        if (!container || !hasResults || !canSelect) return;
        let timer: number | undefined;
        let origin = { x: 0, y: 0 };
        const clear = () => {
            window.clearTimeout(timer);
            timer = undefined;
        };
        const onDown = (event: PointerEvent) => {
            const id = locateCard(event.target, dataRef.current)?.item.Id;
            if (!id || event.button > 0) return;
            origin = { x: event.clientX, y: event.clientY };
            clear();
            timer = window.setTimeout(() => {
                timer = undefined;
                swallowClick.current = { id, until: Date.now() + 700 };
                startSelection(id);
            }, LONG_PRESS_MS);
        };
        const onMove = (event: PointerEvent) => {
            if (
                timer &&
                (Math.abs(event.clientX - origin.x) >= 5 ||
                    Math.abs(event.clientY - origin.y) >= 5)
            ) {
                clear();
            }
        };
        container.addEventListener('pointerdown', onDown);
        container.addEventListener('pointermove', onMove);
        container.addEventListener('pointerup', clear);
        container.addEventListener('pointercancel', clear);
        container.addEventListener('pointerleave', clear);
        return () => {
            clear();
            container.removeEventListener('pointerdown', onDown);
            container.removeEventListener('pointermove', onMove);
            container.removeEventListener('pointerup', clear);
            container.removeEventListener('pointercancel', clear);
            container.removeEventListener('pointerleave', clear);
        };
    }, [hasResults, canSelect, startSelection]);

    // TV remotes and keyboards send play/menu/record as `command` events on the focused card.
    useEffect(() => {
        const container = element.current;
        if (!container || !data) return;
        const onCommand = (event: Event) => {
            const found = locateCard(event.target, data);
            if (!found) return;
            const command = (event as CustomEvent<{ command: string }>).detail
                .command;
            if (runCommand(command, found.items, found.index, found.card)) {
                event.preventDefault();
                event.stopPropagation();
            }
        };
        container.addEventListener('command', onCommand);
        return () => container.removeEventListener('command', onCommand);
    }, [data, runCommand]);

    if (isPending) {
        return (
            <div className='searchResults padded-left padded-right padded-top'>
                <LoadingState
                    variant='shelf'
                    label={globalize.translate('Loading')}
                />
            </div>
        );
    }

    if (isError) {
        return (
            <div className='searchResults padded-left padded-right padded-top'>
                <ErrorState
                    title={globalize.translate('HeaderError')}
                    message={globalize.translate('ErrorDefault')}
                    retryLabel={globalize.translate('Retry')}
                    onRetry={() => void refetch()}
                />
            </div>
        );
    }

    if (!data?.length) {
        return (
            <div className='noItemsMessage centerMessage'>
                {globalize.translate('SearchResultsEmpty', query)}
                {collectionType && (
                    <div>
                        <Link
                            className='emby-button'
                            to={`/search?query=${encodeURIComponent(query || '')}`}
                        >
                            {globalize.translate('RetryWithGlobalSearch')}
                        </Link>
                    </div>
                )}
            </div>
        );
    }

    const allIds = data.flatMap((section) =>
        section.items.map((item) => item.Id).filter((id): id is string => !!id)
    );
    const selected = selection.selected;

    return (
        <div
            ref={element}
            className='searchResults padded-top padded-bottom-page'
            onClickCapture={(event) => {
                // The click that ends a long press must not also open the card.
                const swallow = swallowClick.current;
                swallowClick.current = null;
                if (
                    swallow &&
                    Date.now() < swallow.until &&
                    locateCard(event.target, data)?.item.Id === swallow.id
                ) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                if (!selected) rememberPosition();
            }}
        >
            {canSelect &&
                (selected ? (
                    <SearchSelectionBar
                        selected={selected}
                        allIds={allIds}
                        onCancel={selection.cancel}
                        onSelectAll={selection.selectAll}
                    />
                ) : (
                    <div className='searchResults-tools padded-left padded-right'>
                        <button
                            type='button'
                            className='searchResults-select'
                            onClick={() => selection.start()}
                        >
                            {globalize.translate('Select')}
                        </button>
                    </div>
                ))}
            {data.map((section, rowIndex) => {
                const options = { showTitle: true, ...section.cardOptions };
                const aspect = getRowImageAspect(section.items, options);
                const title = globalize.translate(section.title);
                return (
                    <MediaShelf
                        key={section.title}
                        id={`searchResults-${rowIndex}`}
                        className='searchResults-row padded-left padded-right'
                        title={title}
                        density={density}
                        scrollerRef={(scroller) => {
                            scrollers.current[section.title] = scroller;
                            if (scroller?.parentElement) {
                                scroller.parentElement.dataset.row =
                                    String(rowIndex);
                            }
                        }}
                    >
                        {section.items.map((item, index) => (
                            <MediaCard
                                key={item.Id}
                                {...toSearchCardProps(
                                    item,
                                    options,
                                    aspect,
                                    imageUrl,
                                    undefined,
                                    layoutManager.tv
                                )}
                                titleLines={2}
                                actions={getActions(
                                    section.items,
                                    index,
                                    options
                                )}
                                selection={
                                    selected && item.Id
                                        ? {
                                              selected: selected.includes(
                                                  item.Id
                                              ),
                                              onToggle: () =>
                                                  selection.toggle(item.Id!)
                                          }
                                        : undefined
                                }
                                onContextMenu={(event) => {
                                    // Touch: a long press selects, as before (Safari never
                                    // sends this, and has the pointer timer instead).
                                    if (browser.touch && canSelect && item.Id) {
                                        event.preventDefault();
                                        startSelection(item.Id);
                                        return;
                                    }
                                    onContextMenu(section.items, index, event);
                                }}
                            />
                        ))}
                    </MediaShelf>
                );
            })}
        </div>
    );
};

export default SearchResults;
