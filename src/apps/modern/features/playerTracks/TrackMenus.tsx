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
import type { RepeatMode } from '@jellyfin/sdk/lib/generated-client/models/repeat-mode';

import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';
import {
    type TrackStream,
    trackMenuItem
} from 'components/playback/trackMenuItem';
import globalize from 'lib/globalize';
import { getKeyName } from 'scripts/keyboardNavigation';

import {
    type Choice,
    type PlayerSettings,
    REPEAT_MODES,
    readSettings,
    setAspectRatio,
    setMaxBitrate,
    setPlaybackRate,
    setRepeatMode
} from './playerSettings';
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
import { toggleStats } from 'apps/modern/features/playerPanels/playerStats';
import {
    showSubtitleOffset,
    syncSubtitleOffset
} from 'apps/modern/features/playerPanels/subtitleOffset';
import './trackMenus.scss';

type SettingKind = 'aspectratio' | 'playbackrate' | 'quality' | 'repeatmode';
type MenuKind = 'audio' | 'subtitles' | 'secondary' | 'settings' | SettingKind;

/** A submenu's parent, which Escape or Back returns to; the parent's row for it is keyed by the submenu's kind. */
const PARENT: Partial<Record<MenuKind, MenuKind>> = {
    secondary: 'subtitles',
    aspectratio: 'settings',
    playbackrate: 'settings',
    quality: 'settings',
    repeatmode: 'settings'
};

interface OpenMenu {
    kind: MenuKind;
    /** The trigger that opened it, which gets the focus back. */
    opener: HTMLButtonElement;
    /** The playback the menu was opened for. Its commands act on that one or on nothing. */
    ref: PlaybackRef;
    /** The settings menu's snapshot, read for `ref`. */
    settings?: PlayerSettings;
    /** The row to focus on showing, when coming back from its submenu. */
    focus?: string;
}

interface Row {
    /** A track index, -1 for Off, a setting's value, or a submenu or action; also the row's `data-track`. */
    key: string;
    name: string;
    secondaryText?: string;
    asideText?: string;
    /** Set on a choice; a row without it is a submenu or an action. */
    checked?: boolean;
    submenu?: boolean;
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
        key: String(OFF),
        name: globalize.translate('Off'),
        checked: current === OFF,
        onSelect: () => onSelect(OFF)
    };
}

function choiceRow<T extends string | number>(
    choice: Choice<T>,
    onSelect: (value: T) => void
): Row {
    return {
        key: String(choice.id),
        name: choice.name,
        checked: choice.selected,
        onSelect: () => onSelect(choice.id)
    };
}

interface MenuProps {
    title: string;
    rows: Row[];
    opener: HTMLElement;
    focus?: string;
    /** Escape, a remote's Back: to the parent menu, or closed. */
    onBack: () => void;
    onClose: (restoreFocus: boolean) => void;
}

/** One open menu: a list of choices over a backdrop, anchored to its trigger outside the TV layout. */
const TrackMenu: FC<MenuProps> = ({
    title,
    rows,
    opener,
    focus,
    onBack,
    onClose
}) => {
    const panelRef = useRef<HTMLDivElement>(null);
    const selectionRef = useRef<{ title: string; focus?: string }>();
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

    useLayoutEffect(() => {
        const panel = panelRef.current;
        if (!panel) return;
        const previous = selectionRef.current;
        selectionRef.current = { title, focus };
        // A stream update can remove the focused row. Recover before the next
        // key, but preserve a live row or focus deliberately moved elsewhere.
        if (
            previous?.title === title &&
            previous?.focus === focus &&
            document.activeElement !== document.body
        )
            return;
        const items = [
            ...panel.querySelectorAll<HTMLElement>('[role^="menuitem"]')
        ];
        focusManager.focus(
            items.find((item) => item.dataset.track === focus) ??
                items.find(
                    (item) => item.getAttribute('aria-checked') === 'true'
                ) ??
                items[0] ??
                panel
        );
    }, [title, focus, rows]);

    useEffect(() => {
        const panel = panelRef.current;
        if (!panel) return;
        // A remote's Back, or Backspace on a VIDAA TV, arrives as a `back` command.
        const onCommand = (e: Event) => {
            if ((e as CustomEvent).detail?.command === 'back') {
                e.preventDefault();
                e.stopPropagation();
                onBack();
            }
        };
        panel.addEventListener('command', onCommand);
        return () => panel.removeEventListener('command', onCommand);
    }, [onBack]);

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
                onBack();
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
                tabIndex={-1}
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
                            data-track={row.key}
                            type='button'
                            className='rf-track-menu__item'
                            {...(row.checked == null
                                ? {
                                      role: 'menuitem',
                                      'aria-haspopup': row.submenu
                                          ? 'menu'
                                          : undefined
                                  }
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

function settingsRows(
    s: PlayerSettings,
    open: (kind: SettingKind) => void,
    act: (action: 'suboffset' | 'stats') => void
): Row[] {
    const submenu = (
        kind: SettingKind,
        name: string,
        asideText: string | null | undefined
    ): Row => ({
        key: kind,
        name: globalize.translate(name),
        asideText: asideText ?? undefined,
        submenu: true,
        onSelect: () => open(kind)
    });
    const selectedName = (c: Choice<string | number>[]) =>
        c.find((x) => x.selected)?.name;
    const rows: Row[] = [];
    if (s.aspectRatio) {
        rows.push(
            submenu('aspectratio', 'AspectRatio', selectedName(s.aspectRatio))
        );
    }
    if (s.playbackRate) {
        rows.push(
            submenu(
                'playbackrate',
                'PlaybackRate',
                selectedName(s.playbackRate)
            )
        );
    }
    if (s.quality) {
        rows.push(submenu('quality', 'Quality', s.quality.summary));
    }
    if (s.repeatMode) {
        rows.push(
            submenu('repeatmode', 'RepeatMode', repeatName(s.repeatMode))
        );
    }
    if (s.subtitleOffset) {
        rows.push({
            key: 'suboffset',
            name: globalize.translate('SubtitleOffset'),
            onSelect: () => act('suboffset')
        });
    }
    rows.push({
        key: 'stats',
        name: globalize.translate('PlaybackData'),
        onSelect: () => act('stats')
    });
    return rows;
}

function repeatName(mode: string): string {
    return globalize.translate(mode === 'RepeatNone' ? 'None' : mode);
}

/** The choices of a setting submenu, from the snapshot the settings menu read. */
function settingChoices(
    kind: SettingKind,
    s: PlayerSettings
): Choice<string | number>[] {
    switch (kind) {
        case 'aspectratio':
            return s.aspectRatio ?? [];
        case 'playbackrate':
            return s.playbackRate ?? [];
        case 'quality':
            return s.quality?.choices ?? [];
        case 'repeatmode':
            return REPEAT_MODES.map((mode) => ({
                id: mode,
                name: repeatName(mode),
                selected: mode === s.repeatMode
            }));
    }
}

/** Sends a setting submenu's choice, unless it is the one already in effect. */
function applySetting(
    kind: SettingKind,
    settings: PlayerSettings,
    value: number | string
): void {
    const { ref } = settings;
    if (value === settingChoices(kind, settings).find((c) => c.selected)?.id) {
        return;
    }
    if (kind === 'aspectratio') setAspectRatio(ref, value as string);
    else if (kind === 'playbackrate') setPlaybackRate(ref, value as number);
    else if (kind === 'quality') setMaxBitrate(ref, value as number);
    else setRepeatMode(ref, value as RepeatMode);
}

function rowsFor(
    menu: OpenMenu,
    tracks: PlayerTracks,
    choose: (value: number | string) => void,
    open: (kind: MenuKind) => void,
    act: (action: 'suboffset' | 'stats') => void
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
                              submenu: true,
                              onSelect: () => open('secondary')
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
        case 'settings':
            return menu.settings ? settingsRows(menu.settings, open, act) : [];
        default:
            return menu.settings
                ? settingChoices(menu.kind, menu.settings).map((c) =>
                      choiceRow(c, choose)
                  )
                : [];
    }
}

const TITLES: Record<MenuKind, string> = {
    audio: 'Audio',
    subtitles: 'Subtitles',
    secondary: 'SecondarySubtitles',
    settings: 'Settings',
    aspectratio: 'AspectRatio',
    playbackrate: 'PlaybackRate',
    quality: 'Quality',
    repeatmode: 'RepeatMode'
};

/**
 * The player's audio, subtitle and settings buttons and their menus (DEBT-WEB-2, DEBT-WEB-3).
 *
 * Rendered by the video route, so it is part of that route's React tree; the buttons are portalled
 * into the slots the legacy controller lends (`TrackMenuHost`) so they sit in its button row, and an
 * open menu is portalled to the body, above the OSD and outside its backdrop-filter, which would
 * otherwise become the containing block of a fixed panel.
 */
const TrackMenus: FC = () => {
    const host = useSyncExternalStore(subscribeTrackMenuHost, getTrackMenuHost);
    const [tracks, setTracks] = useState(readTracks);
    const [menu, setMenu] = useState<OpenMenu | null>(null);
    const menuRef = useRef(menu);
    menuRef.current = menu;
    // Bumped by every open: a settings snapshot that arrives after another menu was opened, or
    // after a second click, is not shown.
    const openCount = useRef(0);

    useEffect(() => {
        setTracks(readTracks());
        return subscribeTracks(() => setTracks(readTracks()));
    }, [host]);

    const close = useCallback(
        (restoreFocus: boolean) => {
            const opener = menuRef.current?.opener;
            setMenu(null);
            const target = opener?.isConnected
                ? opener
                : host?.settingsSlot.querySelector<HTMLElement>(
                      '[data-track-menu="settings"]'
                  );
            if (restoreFocus && target?.isConnected) focusManager.focus(target);
        },
        [host]
    );

    const back = useCallback(() => {
        const current = menuRef.current;
        const parent = current && PARENT[current.kind];
        if (parent) setMenu({ ...current, kind: parent, focus: current.kind });
        else close(true);
    }, [close]);

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

    // Read again on open: the engine announces a new stream but not a track switch on the same one.
    const open =
        (kind: 'audio' | 'subtitles') =>
        (e: React.MouseEvent<HTMLButtonElement>) => {
            openCount.current += 1;
            const fresh = readTracks();
            if (!fresh) return;
            setTracks(fresh);
            setMenu({ kind, opener: e.currentTarget, ref: fresh.ref });
        };

    // The snapshot waits on the server (the user's transcoding permission). readSettings drops it
    // if the playback changed meanwhile; this drops it if another menu was opened since.
    const openSettings = (e: React.MouseEvent<HTMLButtonElement>) => {
        const opener = e.currentTarget;
        openCount.current += 1;
        const request = openCount.current;
        void readSettings().then((settings) => {
            if (settings && request === openCount.current) {
                setMenu({
                    kind: 'settings',
                    opener,
                    ref: settings.ref,
                    settings
                });
            }
        });
    };

    const choose = (value: number | string) => {
        if (!menu) return;
        const { kind, ref, settings } = menu;
        switch (kind) {
            case 'audio':
                if (value !== tracks.audioIndex) setAudio(ref, value as number);
                break;
            case 'subtitles':
                if (
                    value !== tracks.subtitleIndex &&
                    setSubtitles(ref, value as number)
                ) {
                    syncSubtitleOffset(true);
                }
                break;
            case 'secondary':
                if (
                    value !== tracks.secondary?.index &&
                    setSecondarySubtitles(ref, value as number)
                ) {
                    syncSubtitleOffset(true);
                }
                break;
            case 'settings':
                break;
            default:
                if (settings) applySetting(kind, settings, value);
        }
        close(true);
    };

    const act = (action: 'suboffset' | 'stats') => {
        if (!menu) return;
        const { ref } = menu;
        close(true);
        if (action === 'stats') {
            if (isCurrent(ref)) toggleStats();
        } else {
            showSubtitleOffset(ref);
        }
    };

    const trigger = (
        kind: 'audio' | 'subtitles' | 'settings',
        icon: string,
        onClick: (e: React.MouseEvent<HTMLButtonElement>) => void,
        size = 'xlargePaperIconButton'
    ) => {
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
                onClick={onClick}
            >
                <span
                    className={`${size} material-icons ${icon}`}
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
                        trigger(
                            'subtitles',
                            'closed_caption',
                            open('subtitles')
                        )}
                    {tracks.audio.length > 1 &&
                        trigger('audio', 'audiotrack', open('audio'))}
                </>,
                host.slot
            )}
            {createPortal(
                trigger(
                    'settings',
                    'settings',
                    openSettings,
                    'largePaperIconButton'
                ),
                host.settingsSlot
            )}
            {menu &&
                createPortal(
                    <TrackMenu
                        title={globalize.translate(TITLES[menu.kind])}
                        rows={rowsFor(
                            menu,
                            tracks,
                            choose,
                            (kind) =>
                                setMenu({ ...menu, kind, focus: undefined }),
                            act
                        )}
                        opener={menu.opener}
                        focus={menu.focus}
                        onBack={back}
                        onClose={close}
                    />,
                    document.body
                )}
        </>
    );
};

export default TrackMenus;
