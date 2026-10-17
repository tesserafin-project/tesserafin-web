import type { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';
import { getImageApi } from '@jellyfin/sdk/lib/utils/api/image-api';
import React, { type FC, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';

import layoutManager from 'components/layoutManager';
import { useApi } from 'hooks/useApi';
import globalize from 'lib/globalize';
import { ErrorState, LoadingState, MediaCard, MediaShelf } from 'ui';

import { useSearchItems } from '../api/useSearchItems';
import {
    getRowImageAspect,
    toSearchCardProps,
    type ImageUrlBuilder
} from '../utils/searchCardProps';
import { useSearchCardActions } from './searchCardActions';

import './searchresults.scss';

const STATE_KEY = 'searchResultsState';
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

    // TV remotes and keyboards send play/menu/record as `command` events on the focused card.
    useEffect(() => {
        const container = element.current;
        if (!container || !data) return;
        const onCommand = (event: Event) => {
            const target = event.target as HTMLElement;
            const card = target.closest<HTMLElement>(
                '[data-rf-slot="media-card"]'
            );
            const shelf = card?.closest<HTMLElement>(
                '[data-rf-slot="media-shelf"]'
            );
            const section = data[Number(shelf?.dataset.row)];
            if (!card?.parentElement || !section) return;
            const index = Array.prototype.indexOf.call(
                card.parentElement.children,
                card
            );
            const command = (event as CustomEvent<{ command: string }>).detail
                .command;
            if (runCommand(command, section.items, index, card)) {
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

    return (
        <div
            ref={element}
            className='searchResults padded-top padded-bottom-page'
            onClickCapture={rememberPosition}
        >
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
                        density='compact'
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
                                actions={getActions(
                                    section.items,
                                    index,
                                    options
                                )}
                                onContextMenu={(event) =>
                                    onContextMenu(section.items, index, event)
                                }
                            />
                        ))}
                    </MediaShelf>
                );
            })}
        </div>
    );
};

export default SearchResults;
