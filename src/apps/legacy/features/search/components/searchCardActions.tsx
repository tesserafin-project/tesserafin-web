import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import { useQueryClient } from '@tanstack/react-query';
import React, { type MouseEvent, useCallback } from 'react';

import itemHelper from 'components/itemHelper';
import layoutManager from 'components/layoutManager';
import { playbackManager } from 'components/playback/playbackmanager';
import recordingHelper from 'components/recordingcreator/recordinghelper';
import {
    useToggleFavoriteMutation,
    useTogglePlayedMutation
} from 'hooks/useFetchItems';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import globalize from 'lib/globalize';
import type { MediaCardAction } from 'ui';

import type { SearchCardOptions } from '../types';

/**
 * What a search result card can DO (DEBT-WEB-1), kept to what the `emby-itemscontainer` /
 * `itemShortcuts` / `cardBuilder` overlay offered on the same card:
 *
 * - desktop: Play from the saved position, Mark watched, Favourite, More — the hover overlay;
 * - mobile: Play on a video, or More where the section asked for it (Live TV) — the corner button;
 * - TV: nothing drawn; the remote's play/menu/record commands act on the focused card;
 * - everywhere: the context menu (right click, long press) opens the item menu.
 *
 * Multi-select is not carried over: it is driven by the `.card` DOM of the old builder and no
 * other `MediaCard` surface offers it either.
 */

const icon = (path: string) => (
    <svg viewBox='0 0 24 24' aria-hidden='true' focusable='false'>
        <path d={path} />
    </svg>
);
const PLAY = icon('M8 5v14l11-7z');
const CHECK = icon('M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z');
const FAVORITE = icon(
    'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'
);
const MORE = icon(
    'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z'
);

const playableId = (item: BaseItemDto) =>
    item.Type === 'Program' || item.Type === 'LiveTvProgram'
        ? item.ChannelId
        : item.Id;

const play = (item: BaseItemDto) => {
    if (!playbackManager.canPlay(item)) {
        console.warn('Unable to play item', item);
        return;
    }
    playbackManager.play({
        ids: [playableId(item)],
        startPositionTicks: item.UserData?.PlaybackPositionTicks || 0,
        serverId: item.ServerId
    });
};

/** "Play/queue all from here": the row from this card on, as the old row did. */
const playRowFrom = (row: BaseItemDto[], index: number, queue: boolean) => {
    const serverId = row[index]?.ServerId;
    if (queue) {
        playbackManager.queue({
            ids: row.slice(index).map((item) => item.Id),
            serverId
        });
    } else {
        playbackManager.play({
            ids: row.map((item) => item.Id),
            serverId,
            startIndex: index
        });
    }
};

/** Played on mobile only where `cardBuilder` drew its corner Play button. */
const hasMobilePlay = (item: BaseItemDto, options: SearchCardOptions) =>
    !options.overlayMoreButton &&
    item.MediaType === 'Video' &&
    !item.IsPlaceHolder &&
    (item.LocationType !== 'Virtual' ||
        !item.MediaType ||
        item.Type === 'Program') &&
    item.Type !== 'Person';

export const useSearchCardActions = () => {
    const queryClient = useQueryClient();
    const { mutateAsync: togglePlayed } = useTogglePlayedMutation();
    const { mutateAsync: toggleFavorite } = useToggleFavoriteMutation();

    const refresh = useCallback(
        () => queryClient.invalidateQueries({ queryKey: ['Search'] }),
        [queryClient]
    );

    /** The item menu, on the FULL item (a search row only carries a few fields), as before. */
    const showMenu = useCallback(
        (row: BaseItemDto[], index: number, positionTo?: HTMLElement) => {
            const { Id: id, ServerId: serverId } = row[index];
            const apiClient = serverId
                ? ServerConnections.getApiClient(serverId)
                : undefined;
            if (!apiClient || !id) return;
            Promise.all([
                import('components/itemContextMenu'),
                apiClient.getItem(apiClient.getCurrentUserId(), id),
                apiClient.getCurrentUser()
            ])
                .then(([{ default: itemContextMenu }, item, user]) =>
                    itemContextMenu.show({
                        item,
                        user,
                        positionTo,
                        play: true,
                        queue: true,
                        playAllFromHere:
                            item.Type === 'Season' || !item.IsFolder,
                        queueAllFromHere: !item.IsFolder
                    })
                )
                .then(
                    (result: {
                        command?: string;
                        updated?: boolean;
                        deleted?: boolean;
                    }) => {
                        if (result.command === 'playallfromhere') {
                            playRowFrom(row, index, false);
                        } else if (result.command === 'queueallfromhere') {
                            playRowFrom(row, index, true);
                        } else if (result.updated || result.deleted) {
                            void refresh();
                        }
                    }
                )
                .catch(() => {
                    /* dismissed */
                });
        },
        [refresh]
    );

    const getActions = useCallback(
        (
            row: BaseItemDto[],
            index: number,
            options: SearchCardOptions
        ): MediaCardAction[] => {
            const item = row[index];
            const actions: MediaCardAction[] = [];
            const more: MediaCardAction = {
                id: 'menu',
                label: globalize.translate('ButtonMore'),
                icon: MORE,
                onClick: (event) => showMenu(row, index, event.currentTarget)
            };

            if (layoutManager.tv) return actions;

            if (layoutManager.mobile) {
                if (hasMobilePlay(item, options)) {
                    actions.push({
                        id: 'play',
                        label: globalize.translate('Play'),
                        icon: PLAY,
                        onClick: () => play(item)
                    });
                }
                if (options.overlayMoreButton) actions.push(more);
                return actions;
            }

            if (playbackManager.canPlay(item)) {
                actions.push({
                    id: 'resume',
                    label: globalize.translate('Play'),
                    icon: PLAY,
                    primary: true,
                    onClick: () => play(item)
                });
            }
            const userData = item.UserData;
            if (itemHelper.canMarkPlayed(item) && item.Id) {
                const played = !!userData?.Played;
                let label = globalize.translate('MarkPlayed');
                if (played) {
                    label = globalize.translate(
                        item.Type === 'AudioBook' ? 'Played' : 'Watched'
                    );
                }
                actions.push({
                    id: 'played',
                    label,
                    icon: CHECK,
                    pressed: played,
                    onClick: () =>
                        void togglePlayed({
                            itemId: item.Id!,
                            isPlayed: played
                        }).then(refresh)
                });
            }
            if (itemHelper.canRate(item) && item.Id) {
                const favorite = !!userData?.IsFavorite;
                actions.push({
                    id: 'favorite',
                    label: globalize.translate(
                        favorite ? 'Favorite' : 'AddToFavorites'
                    ),
                    icon: FAVORITE,
                    pressed: favorite,
                    onClick: () =>
                        void toggleFavorite({
                            itemId: item.Id!,
                            isFavorite: favorite
                        }).then(refresh)
                });
            }
            actions.push(more);
            return actions;
        },
        [refresh, showMenu, toggleFavorite, togglePlayed]
    );

    const onContextMenu = useCallback(
        (row: BaseItemDto[], index: number, event: MouseEvent<HTMLElement>) => {
            event.preventDefault();
            showMenu(row, index, event.currentTarget);
        },
        [showMenu]
    );

    /** The remote/keyboard commands `itemShortcuts` answered on a focused card. */
    const runCommand = useCallback(
        (
            command: string,
            row: BaseItemDto[],
            index: number,
            target: HTMLElement
        ): boolean => {
            const item = row[index];
            switch (command) {
                case 'play':
                case 'resume':
                    play(item);
                    return true;
                case 'menu':
                    showMenu(row, index, target);
                    return true;
                case 'record':
                    if (
                        item.Type === 'Program' ||
                        item.TimerId ||
                        item.SeriesTimerId
                    ) {
                        recordingHelper.toggleRecording(
                            item.ServerId,
                            item.Type === 'Program' ? item.Id : null,
                            item.TimerId,
                            item.SeriesTimerId
                        );
                    }
                    return true;
                default:
                    return false;
            }
        },
        [showMenu]
    );

    return { getActions, onContextMenu, runCommand };
};
