import React, {
    type FC,
    type KeyboardEvent,
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    useSyncExternalStore
} from 'react';
import { createPortal } from 'react-dom';

import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';
import {
    type TrackStream,
    trackMenuItem
} from 'components/playback/trackMenuItem';
import globalize from 'lib/globalize';
import { getKeyName } from 'scripts/keyboardNavigation';

import {
    type PlaybackRef,
    type PlayerTracks,
    getTrackMenuHost,
    isCurrent,
    readTracks,
    setAudio,
    setSecondarySubtitles,
    setSubtitles,
    subscribeTrackMenuHost,
    subscribeTracks
} from './playerTracks';
import './trackMenus.scss';

type MenuKind = 'audio' | 'subtitles' | 'secondary';

interface OpenMenu {
    kind: MenuKind;
    /** The trigger that opened it, which gets the focus back. */
    opener: HTMLButtonElement;
    /** The playback the menu was opened for. Its commands act on that one or on nothing. */
    ref: PlaybackRef;
}

interface Row {
    key: string;
    name: string;
    secondaryText?: string;
    asideText?: string;
    checked?: boolean;
    onSelect: () => void;
}

const OFF = -1;

function trackRow(
    stream: TrackStream,
    current: number | null,
    onSelect: (index: number) => void
): Row {
    return {
        key: String(stream.Index),
        ...trackMenuItem(
            stream,
            globalize.getCurrentLocale(),
            globalize.translate
        ),
        checked: stream.Index === current,
        onSelect: () => onSelect(stream.Index)
    };
}

function offRow(current: number, onSelect: (index: number) => void): Row {
    return {
        key: 'off',
        name: globalize.translate('Off'),
        checked: current === OFF,
        onSelect: () => onSelect(OFF)
    };
}

interface MenuProps {
    title: string;
    rows: Row[];
    opener: HTMLElement;
    onClose: (restoreFocus: boolean) => void;
}

/** One open menu: a list of choices over a backdrop, anchored to its trigger outside the TV layout. */
const TrackMenu: FC<MenuProps> = ({ title, rows, opener, onClose }) => {
    const panelRef = useRef<HTMLDivElement>(null);
    const titleId = useId();
    const tv = layoutManager.tv;

    useLayoutEffect(() => {
        const panel = panelRef.current;
        if (!panel || tv) return;
        // Above its trigger, centred on it, kept inside the window.
        const anchor = opener.getBoundingClientRect();
        const width = panel.offsetWidth;
        const height = panel.offsetHeight;
        const left = Math.min(
            Math.max(anchor.left + anchor.width / 2 - width / 2, 10),
            window.innerWidth - width - 10
        );
        panel.style.left = `${Math.max(left, 10)}px`;
        panel.style.top = `${Math.max(anchor.top - height - 8, 10)}px`;
    }, [opener, rows.length, title, tv]);

    useEffect(() => {
        const panel = panelRef.current;
        if (!panel) return;
        const items = [
            ...panel.querySelectorAll<HTMLElement>('[role^="menuitem"]')
        ];
        focusManager.focus(
            items.find(
                (item) => item.getAttribute('aria-checked') === 'true'
            ) ?? items[0]
        );

        // A remote's Back, or Backspace on a VIDAA TV, arrives as a `back` command.
        const onCommand = (e: Event) => {
            if ((e as CustomEvent).detail?.command === 'back') {
                e.preventDefault();
                e.stopPropagation();
                onClose(true);
            }
        };
        panel.addEventListener('command', onCommand);
        return () => panel.removeEventListener('command', onCommand);
    }, [title, onClose]);

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        const key = getKeyName(e.nativeEvent);
        const items = [
            ...(panelRef.current?.querySelectorAll<HTMLElement>(
                '[role^="menuitem"]'
            ) ?? [])
        ];
        const at = items.indexOf(document.activeElement as HTMLElement);
        let next: HTMLElement | undefined;

        switch (key) {
            case 'Escape':
            case 'Back':
                onClose(true);
                break;
            case 'ArrowDown':
            case 'Down':
                next = items[(at + 1) % items.length];
                break;
            case 'ArrowUp':
            case 'Up':
                next = items[(at - 1 + items.length) % items.length];
                break;
            case 'Home':
                next = items[0];
                break;
            case 'End':
                next = items[items.length - 1];
                break;
            case 'ArrowLeft':
            case 'ArrowRight':
            case 'Tab':
                // Nothing beside the list to go to; the player behind must not see these either.
                break;
            default:
                return;
        }

        // Handled here: neither the player's shortcuts nor the app's key-to-command layer act on it.
        e.preventDefault();
        e.stopPropagation();
        if (next) focusManager.focus(next);
    };

    return (
        <div
            className={`rf-track-menu${tv ? ' rf-track-menu--tv' : ''}${
                layoutManager.mobile ? ' rf-track-menu--touch' : ''
            }`}
        >
            <button
                type='button'
                className='rf-track-menu__backdrop'
                tabIndex={-1}
                aria-label={globalize.translate('ButtonBack')}
                onClick={() => onClose(true)}
            />
            <div
                ref={panelRef}
                className='rf-track-menu__panel'
                data-rf-slot='track-menu'
                role='menu'
                aria-labelledby={titleId}
                onKeyDown={onKeyDown}
            >
                <h2 id={titleId} className='rf-track-menu__title'>
                    {title}
                </h2>
                <div className='rf-track-menu__list'>
                    {rows.map((row) => (
                        <button
                            key={row.key}
                            type='button'
                            className='rf-track-menu__item'
                            {...(row.checked == null
                                ? { role: 'menuitem', 'aria-haspopup': 'menu' }
                                : {
                                      role: 'menuitemradio',
                                      'aria-checked': row.checked
                                  })}
                            onClick={row.onSelect}
                        >
                            <span
                                className='rf-track-menu__check material-icons check'
                                aria-hidden='true'
                            />
                            <span className='rf-track-menu__text'>
                                <span className='rf-track-menu__name'>
                                    {row.name}
                                </span>
                                {row.secondaryText && (
                                    <span className='rf-track-menu__secondary'>
                                        {row.secondaryText}
                                    </span>
                                )}
                            </span>
                            {row.asideText && (
                                <span className='rf-track-menu__aside'>
                                    {row.asideText}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

function rowsFor(
    menu: OpenMenu,
    tracks: PlayerTracks,
    choose: (index: number) => void,
    showSecondary: () => void
): Row[] {
    switch (menu.kind) {
        case 'audio':
            return tracks.audio.map((s) =>
                trackRow(s, tracks.audioIndex, choose)
            );
        case 'subtitles':
            return [
                ...(tracks.secondary
                    ? [
                          {
                              key: 'secondary',
                              name: globalize.translate('SecondarySubtitles'),
                              onSelect: showSecondary
                          }
                      ]
                    : []),
                offRow(tracks.subtitleIndex, choose),
                ...tracks.subtitles.map((s) =>
                    trackRow(s, tracks.subtitleIndex, choose)
                )
            ];
        case 'secondary': {
            const index = tracks.secondary?.index ?? OFF;
            return [
                offRow(index, choose),
                ...(tracks.secondary?.tracks ?? []).map((s) =>
                    trackRow(s, index, choose)
                )
            ];
        }
    }
}

const TITLES: Record<MenuKind, string> = {
    audio: 'Audio',
    subtitles: 'Subtitles',
    secondary: 'SecondarySubtitles'
};

/**
 * The player's audio and subtitle buttons and their menus (DEBT-WEB-2).
 *
 * Rendered by the video route, so it is part of that route's React tree; the buttons are portalled
 * into the slot the legacy controller lends (`TrackMenuHost`) so they sit in its button row, and an
 * open menu is portalled to the body, above the OSD and outside its backdrop-filter, which would
 * otherwise become the containing block of a fixed panel.
 */
const TrackMenus: FC = () => {
    const host = useSyncExternalStore(subscribeTrackMenuHost, getTrackMenuHost);
    const [tracks, setTracks] = useState(readTracks);
    const [menu, setMenu] = useState<OpenMenu | null>(null);
    const menuRef = useRef(menu);
    menuRef.current = menu;

    useEffect(() => {
        setTracks(readTracks());
        return subscribeTracks(() => setTracks(readTracks()));
    }, [host]);

    const close = useCallback((restoreFocus: boolean) => {
        const opener = menuRef.current?.opener;
        setMenu(null);
        if (restoreFocus && opener?.isConnected) focusManager.focus(opener);
    }, []);

    // The playback it was opened for is gone (stopped, or replaced from here or another device),
    // or the player view is hiding: the menu goes with it.
    useEffect(() => {
        if (menu && (!host || !tracks || !isCurrent(menu.ref))) close(false);
    }, [menu, tracks, host, close]);

    const isOpen = menu != null;
    useEffect(() => {
        if (!host || !isOpen) return;
        host.onMenuOpenChange(true);
        return () => host.onMenuOpenChange(false);
    }, [host, isOpen]);

    if (!host || !tracks) return null;

    const open = (kind: MenuKind) => (e: React.MouseEvent<HTMLButtonElement>) =>
        setMenu({ kind, opener: e.currentTarget, ref: tracks.ref });

    const choose = (index: number) => {
        if (!menu) return;
        const { kind, ref } = menu;
        if (kind === 'audio') {
            if (index !== tracks.audioIndex) setAudio(ref, index);
        } else if (kind === 'subtitles') {
            if (index !== tracks.subtitleIndex && setSubtitles(ref, index)) {
                host.onSubtitlesChanged();
            }
        } else if (
            index !== tracks.secondary?.index &&
            setSecondarySubtitles(ref, index)
        ) {
            host.onSubtitlesChanged();
        }
        close(true);
    };

    const trigger = (kind: 'audio' | 'subtitles', icon: string) => {
        const label = globalize.translate(TITLES[kind]);
        return (
            <button
                type='button'
                className='paper-icon-button-light autoSize'
                title={label}
                aria-label={label}
                aria-haspopup='menu'
                aria-expanded={menu?.opener.dataset.trackMenu === kind}
                data-track-menu={kind}
                onClick={open(kind)}
            >
                <span
                    className={`xlargePaperIconButton material-icons ${icon}`}
                    aria-hidden='true'
                />
            </button>
        );
    };

    return (
        <>
            {createPortal(
                <>
                    {tracks.subtitles.length > 0 &&
                        trigger('subtitles', 'closed_caption')}
                    {tracks.audio.length > 1 && trigger('audio', 'audiotrack')}
                </>,
                host.slot
            )}
            {menu &&
                createPortal(
                    <TrackMenu
                        title={globalize.translate(TITLES[menu.kind])}
                        rows={rowsFor(menu, tracks, choose, () =>
                            setMenu({ ...menu, kind: 'secondary' })
                        )}
                        opener={menu.opener}
                        onClose={close}
                    />,
                    document.body
                )}
        </>
    );
};

export default TrackMenus;
