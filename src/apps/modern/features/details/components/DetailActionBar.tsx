import React, { useEffect, useRef, useState, type FC } from 'react';

import itemContextMenu from 'components/itemContextMenu';
import { appHost } from 'components/apphost';
import { AppFeature } from 'constants/appFeature';
import globalize from 'lib/globalize';
import PlayedButton from 'elements/emby-playstatebutton/PlayedButton';
import FavoriteButton from 'elements/emby-ratingbutton/FavoriteButton';

import type { DetailItem, DetailUser } from '../adapters/itemDetailsApi';
import type { DetailActionName } from '../constants/sections';
import type { ItemActions } from '../hooks/useItemActions';
import { contextMenuOptions } from '../hooks/useItemActions';
import {
    canCancelSeriesTimer,
    canCancelTimer,
    canMarkPlayed,
    canPlayTrailer,
    canRate,
    canSplitVersions,
    playbackGates
} from '../utils/itemPredicates';

interface ActionButtonProps {
    name: DetailActionName;
    label: string;
    onClick: () => void;
}

/**
 * One principal action.
 *
 * `data-detail-action` names the action the way the frozen contract names it. Like
 * `data-detail-section` it is a characterization hook, not a theming surface. The accessible name
 * is the translated label, so every control has a meaningful name — Phase 9's requirement, and one
 * the legacy icon-only buttons met only through `title`.
 */
const ActionButton: FC<ActionButtonProps> = ({ name, label, onClick }) => (
    <button
        type='button'
        className='rf-item-details__action'
        data-detail-action={name}
        title={label}
        aria-label={label}
        onClick={onClick}
    >
        {label}
    </button>
);

interface DetailActionBarProps {
    item: DetailItem;
    user: DetailUser;
    actions: ItemActions;
    /** True when the collection's children contain nothing playable. */
    suppressPlayback?: boolean;
}

/**
 * The action bar.
 *
 * Every control here is outside the theme contract (RFC-0007 §6.1) and stays that way. The order is
 * the frozen order; the gates are the frozen gates.
 */
const DetailActionBar: FC<DetailActionBarProps> = ({
    item,
    user,
    actions,
    suppressPlayback
}) => {
    const gates = playbackGates(item);
    const canPlay = gates.canPlay && !suppressPlayback;
    const canShuffle = gates.canShuffle && !suppressPlayback;

    const moreCommandsRef = useRef<HTMLDivElement>(null);
    const [hasCommands, setHasCommands] = useState(false);

    /**
     * The context menu is offered only when it has commands.
     *
     * Runs ONCE per item. The legacy route ran `getCommands` twice — `MAY CHANGE` #6 releases that,
     * and delta D13 records the change.
     */
    useEffect(() => {
        let cancelled = false;
        void itemContextMenu
            .getCommands(contextMenuOptions(item, user))
            .then((commands: unknown[]) => {
                if (!cancelled) setHasCommands(commands.length > 0);
            })
            .catch(() => {
                if (!cancelled) setHasCommands(false);
            });
        return () => {
            cancelled = true;
        };
    }, [item, user]);

    const userData = (item.UserData ?? {}) as {
        Played?: boolean;
        IsFavorite?: boolean;
    };

    const canDownload =
        item.Type === 'Book' &&
        item.CanDownload === true &&
        appHost.supports(AppFeature.FileDownload);

    return (
        <div className='rf-item-details__actions' ref={moreCommandsRef}>
            {canPlay ? (
                <ActionButton
                    name='btnPlay'
                    label={globalize.translate(
                        gates.isResumable ? 'ButtonResume' : 'Play'
                    )}
                    onClick={actions.play}
                />
            ) : null}
            {canPlay && gates.isResumable ? (
                <ActionButton
                    name='btnReplay'
                    label={globalize.translate('PlayFromBeginning')}
                    onClick={actions.replay}
                />
            ) : null}
            {canPlay && gates.canInstantMix ? (
                <ActionButton
                    name='btnInstantMix'
                    label={globalize.translate('InstantMix')}
                    onClick={actions.instantMix}
                />
            ) : null}
            {canShuffle ? (
                <ActionButton
                    name='btnShuffle'
                    label={globalize.translate('Shuffle')}
                    onClick={actions.shuffle}
                />
            ) : null}
            {canPlayTrailer(item) ? (
                <ActionButton
                    name='btnPlayTrailer'
                    label={globalize.translate('ButtonTrailer')}
                    onClick={actions.playTrailer}
                />
            ) : null}
            {canCancelTimer(item, user) ? (
                <ActionButton
                    name='btnCancelTimer'
                    label={globalize.translate('StopRecording')}
                    onClick={actions.cancelTimer}
                />
            ) : null}
            {canCancelSeriesTimer(item, user) ? (
                <ActionButton
                    name='btnCancelSeriesTimer'
                    label={globalize.translate('CancelSeries')}
                    onClick={actions.cancelSeriesTimer}
                />
            ) : null}
            {canDownload ? (
                <ActionButton
                    name='btnDownload'
                    label={globalize.translate('Download')}
                    onClick={actions.downloadItem}
                />
            ) : null}
            {canMarkPlayed(item) ? (
                <span
                    className='rf-item-details__user-data'
                    data-detail-action='btnPlaystate'
                >
                    <PlayedButton
                        isPlayed={userData.Played}
                        itemId={item.Id}
                        itemType={item.Type}
                    />
                </span>
            ) : null}
            {canRate(item) ? (
                <span
                    className='rf-item-details__user-data'
                    data-detail-action='btnUserRating'
                >
                    <FavoriteButton
                        isFavorite={userData.IsFavorite}
                        itemId={item.Id}
                    />
                </span>
            ) : null}
            {canSplitVersions(item, user) ? (
                <ActionButton
                    name='btnSplitVersions'
                    label={globalize.translate('ButtonSplit')}
                    onClick={actions.splitVersions}
                />
            ) : null}
            {hasCommands ? (
                <ActionButton
                    name='btnMoreCommands'
                    label={globalize.translate('ButtonMore')}
                    onClick={() => {
                        if (moreCommandsRef.current) {
                            actions.showContextMenu(moreCommandsRef.current);
                        }
                    }}
                />
            ) : null}
        </div>
    );
};

export default DetailActionBar;
