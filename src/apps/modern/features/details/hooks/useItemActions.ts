/**
 * Every action the Item Details action bar can perform.
 *
 * Playback behaviour is APPLICATION logic. RFC-0007 §6.1 places playback controls, permission gates
 * and required warnings outside the theme contract, and Item Details carries more of each than any
 * other route — so none of this is reachable from a presentation recipe, now or after Step 2.
 *
 * The play options are built from the CURRENT track selection passed in at call time, never from a
 * value captured when the page rendered.
 */
import { useCallback } from 'react';

import confirm from 'components/confirm/confirm';
import itemContextMenu from 'components/itemContextMenu';
import { playbackManager } from 'components/playback/playbackmanager';
import { appRouter } from 'components/router/appRouter';
import { EventType } from 'constants/eventType';
import globalize from 'lib/globalize';
import { download } from 'scripts/fileDownloader';
import Dashboard from 'utils/dashboard';
import Events from 'utils/events';

import {
    fetchProgramChannel,
    getDetailsApiClient,
    itemDownloadUrl,
    type DetailItem,
    type DetailUser
} from '../adapters/itemDetailsApi';
import type { TrackSelection } from './useTrackSelection';

export interface ContextMenuOptions {
    item: DetailItem;
    open: false;
    play: false;
    playAllFromHere: false;
    queueAllFromHere: false;
    positionTo?: HTMLElement;
    cancelTimer: false;
    record: false;
    deleteItem: boolean;
    shuffle: false;
    instantMix: false;
    user: DetailUser;
    share: true;
}

/**
 * The context-menu option set, unchanged.
 *
 * `deleteItem` is gated on the ITEM's `CanDelete`, not on the user's role — `MUST PRESERVE` #7.
 */
export function contextMenuOptions(
    item: DetailItem,
    user: DetailUser,
    positionTo?: HTMLElement
): ContextMenuOptions {
    return {
        item,
        open: false,
        play: false,
        playAllFromHere: false,
        queueAllFromHere: false,
        positionTo,
        cancelTimer: false,
        record: false,
        deleteItem: item.CanDelete === true,
        shuffle: false,
        instantMix: false,
        user,
        share: true
    };
}

export interface ItemActions {
    play: () => void;
    replay: () => void;
    instantMix: () => void;
    shuffle: () => void;
    playTrailer: () => void;
    showContextMenu: (anchor: HTMLElement) => void;
    splitVersions: () => void;
    cancelTimer: () => void;
    cancelSeriesTimer: () => void;
    downloadItem: () => void;
}

interface UseItemActionsArgs {
    item: DetailItem;
    user: DetailUser;
    tracks: TrackSelection;
    serverId?: string;
    /** Re-read the item; used after a mutation that changes it. */
    refresh: () => void;
}

export function useItemActions({
    item,
    user,
    tracks,
    serverId,
    refresh
}: UseItemActionsArgs): ItemActions {
    /**
     * Play, from the CURRENT selection.
     *
     * A `Program` plays its CHANNEL, never itself — Phase 5's playback-target requirement and the
     * legacy `playCurrentItem` behaviour.
     */
    const start = useCallback(
        (startPositionTicks: number) => {
            if (item.Type === 'Program' && item.ChannelId) {
                fetchProgramChannel(item)
                    .then((channel) =>
                        playbackManager.play({ items: [channel] })
                    )
                    .catch((error: unknown) => {
                        console.error(
                            '[ItemDetails] failed to play channel',
                            error
                        );
                    });
                return;
            }

            playbackManager.play({
                items: [item],
                startPositionTicks,
                mediaSourceId: tracks.selectedSourceId,
                audioStreamIndex: tracks.selectedAudioIndex || null,
                subtitleStreamIndex: tracks.selectedSubtitleIndex
            });
        },
        [item, tracks]
    );

    const play = useCallback(() => {
        const userData = item.UserData as
            | { PlaybackPositionTicks?: number }
            | undefined;
        start(userData?.PlaybackPositionTicks ?? 0);
    }, [item, start]);

    /** Replay always starts from zero, even when a resume position exists. */
    const replay = useCallback(() => start(0), [start]);

    const instantMix = useCallback(() => {
        playbackManager.instantMix(item);
    }, [item]);

    const shuffle = useCallback(() => {
        playbackManager.shuffle(item);
    }, [item]);

    const playTrailer = useCallback(() => {
        playbackManager.playTrailers(item);
    }, [item]);

    /**
     * The context menu targets THE ITEM.
     *
     * `SUSPECT` #4: the legacy handler re-fetched using the selected MEDIA-SOURCE id as an item id,
     * so on a multi-version item the menu acted on whatever item happened to share that id. Phase 5
     * requires the actual item; delta D4.
     */
    const showContextMenu = useCallback(
        (anchor: HTMLElement) => {
            itemContextMenu
                .show(contextMenuOptions(item, user, anchor))
                .then((result: { deleted?: boolean; updated?: boolean }) => {
                    if (result.deleted) {
                        const parentId =
                            (item.SeasonId as string) ||
                            (item.SeriesId as string) ||
                            (item.ParentId as string);
                        if (parentId) {
                            appRouter.showItem(parentId, item.ServerId);
                        } else {
                            appRouter.goHome();
                        }
                    } else if (result.updated) {
                        refresh();
                    }
                })
                .catch(() => {
                    /* dismissed */
                });
        },
        [item, refresh, user]
    );

    /** Administrator-only. The confirmation is preserved. */
    const splitVersions = useCallback(() => {
        const client = getDetailsApiClient(serverId);
        confirm(
            globalize.translate('ConfirmSplitMedia'),
            globalize.translate('HeaderSplitMedia')
        )
            .then(() =>
                client.ajax({
                    type: 'DELETE',
                    url: client.getUrl(`Videos/${item.Id}/AlternateSources`)
                })
            )
            .then(() => {
                refresh();
                Events.trigger(document, EventType.REFRESH_NEEDED);
            })
            .catch((error: unknown) => {
                console.error('[ItemDetails] failed to split versions', error);
            });
    }, [item, refresh, serverId]);

    const cancelTimer = useCallback(() => {
        void import('components/recordingcreator/recordinghelper').then(
            ({ default: recordingHelper }) =>
                recordingHelper
                    .cancelTimer(
                        getDetailsApiClient(item.ServerId),
                        item.TimerId
                    )
                    .then(refresh)
        );
    }, [item, refresh]);

    const cancelSeriesTimer = useCallback(() => {
        void import('components/recordingcreator/recordinghelper').then(
            ({ default: recordingHelper }) =>
                recordingHelper
                    .cancelSeriesTimerWithConfirmation(item.Id, item.ServerId)
                    .then(() => {
                        Dashboard.navigate('livetv');
                    })
        );
    }, [item]);

    const downloadItem = useCallback(() => {
        const url = itemDownloadUrl(item);
        if (!url) return;
        download([
            {
                url,
                item,
                itemId: item.Id,
                serverId: item.ServerId,
                title: item.Name,
                filename: String(item.Path ?? '').replace(/^.*[\\/]/, '')
            }
        ]);
    }, [item]);

    return {
        play,
        replay,
        instantMix,
        shuffle,
        playTrailer,
        showContextMenu,
        splitVersions,
        cancelTimer,
        cancelSeriesTimer,
        downloadItem
    };
}
