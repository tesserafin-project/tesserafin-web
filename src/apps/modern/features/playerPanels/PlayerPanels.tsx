import React, {
    type FC,
    type KeyboardEvent,
    useEffect,
    useRef,
    useState,
    useSyncExternalStore
} from 'react';
import { createPortal } from 'react-dom';

import {
    getTrackMenuHost,
    subscribeTrackMenuHost,
    subscribeTracks,
    currentRef,
    type PlaybackRef
} from 'apps/modern/features/playerTracks/playerTracks';
import focusManager from 'components/focusManager';
import layoutManager from 'components/layoutManager';
import { EventType } from 'constants/eventType';
import globalize from 'lib/globalize';
import { getKeyName } from 'scripts/keyboardNavigation';
import Events from 'utils/events';

import {
    type StatCategory,
    type StatsReader,
    closeStats,
    createStatsReader,
    isStatsOpen,
    subscribeStats
} from './playerStats';
import {
    OFFSET_MAX,
    OFFSET_MIN,
    OFFSET_STEP,
    formatOffset,
    getOffsetState,
    hideSubtitleOffset,
    parseOffset,
    resetSubtitleOffset,
    setOffset,
    setOffsetRevealed,
    subscribeOffset,
    syncSubtitleOffset
} from './subtitleOffset';
import './playerPanels.scss';

/** The stats panel refreshes on the player's time updates, at most this often. */
const STATS_REFRESH_MS = 700;

/** What every control in a panel listens to: its keys, and whether the focus is in the panel. */
interface ControlProps {
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
    onFocus?: () => void;
    onBlur?: (e: React.FocusEvent<HTMLElement>) => void;
}

/** Closing a panel hands the focus back to the settings button that opens it. */
function focusSettingsButton(): void {
    const button = getTrackMenuHost()?.settingsSlot.querySelector('button');
    if (button?.isConnected) focusManager.focus(button);
}

function sameRef(a: PlaybackRef | null, b: PlaybackRef | null): boolean {
    return (
        !!a &&
        !!b &&
        a.player === b.player &&
        a.playback === b.playback &&
        a.itemId === b.itemId
    );
}

const CloseButton: FC<{
    onClick: () => void;
    controlProps?: ControlProps;
}> = ({ onClick, controlProps }) => (
    <button
        type='button'
        className='paper-icon-button-light rf-player-panel__close'
        title={globalize.translate('ButtonClose')}
        aria-label={globalize.translate('ButtonClose')}
        onClick={onClick}
        {...controlProps}
    >
        <span className='material-icons close' aria-hidden='true' />
    </button>
);

/**
 * Playback data. Follows whatever the player plays while open (a new film gets a new reader, so
 * the last one's late answers are dropped) and stops listening the moment it closes.
 */
export const StatsPanel: FC = () => {
    const open = useSyncExternalStore(subscribeStats, isStatsOpen);
    const [categories, setCategories] = useState<StatCategory[]>([]);
    const tv = layoutManager.tv;

    useEffect(() => {
        if (!open) return;
        let ref: PlaybackRef | null = null;
        let reader: StatsReader | null = null;
        let lastRead = 0;
        let unbindTime = () => undefined as void;

        const refresh = (force = false) => {
            const now = Date.now();
            if (!reader || (!force && now - lastRead < STATS_REFRESH_MS)) {
                return;
            }
            lastRead = now;
            const from = reader;
            void from.read().then((next) => {
                if (next && from === reader) setCategories(next);
            });
        };

        const bind = () => {
            const next = currentRef();
            if (sameRef(ref, next)) {
                refresh(true); // same playback, another track
                return;
            }
            unbindTime();
            unbindTime = () => undefined;
            ref = next;
            reader = next && createStatsReader(next);
            setCategories([]);
            if (!next) return; // between two items: wait for the next one
            const onTime = () => refresh();
            Events.on(next.player, 'timeupdate', onTime);
            unbindTime = () => Events.off(next.player, 'timeupdate', onTime);
            refresh(true);
        };

        bind();
        const unsubscribe = subscribeTracks(bind);
        return () => {
            unsubscribe();
            unbindTime();
            reader = null;
        };
    }, [open]);

    if (!open) return null;

    const close = () => {
        closeStats();
        focusSettingsButton();
    };
    const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
        if (getKeyName(e.nativeEvent) === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
        }
    };

    return (
        <section
            className={`rf-player-panel rf-player-stats${tv ? ' rf-player-stats--tv' : ''}`}
            data-rf-slot='player-stats'
            aria-label={globalize.translate('PlaybackData')}
        >
            {/* The old panel had no close button on TV either: it is closed from the settings menu. */}
            {!tv && (
                <CloseButton onClick={close} controlProps={{ onKeyDown }} />
            )}
            {categories.map((category, i) =>
                category.rows.length ? (
                    // biome-ignore lint/suspicious/noArrayIndexKey: categories have no id and keep their order
                    <dl key={i} className='rf-player-stats__category'>
                        {category.name && (
                            <div
                                className='rf-player-stats__header'
                                data-stat='header'
                            >
                                <dt>{category.name}</dt>
                                <dd>{category.subText}</dd>
                            </div>
                        )}
                        {category.rows.map((stat) => (
                            <div
                                key={stat.label}
                                className='rf-player-stats__row'
                                data-stat=''
                            >
                                <dt>{stat.label}</dt>
                                <dd>
                                    {Array.isArray(stat.value)
                                        ? stat.value.map((line) => (
                                              <span key={line}>{line}</span>
                                          ))
                                        : stat.value}
                                </dd>
                            </div>
                        ))}
                    </dl>
                ) : null
            )}
        </section>
    );
};

/**
 * The subtitle offset: a slider and a field for the seconds, over the video, shown while the
 * player's controls are (or since a G/H press, or while it has the focus).
 */
export const OffsetPanel: FC = () => {
    const state = useSyncExternalStore(subscribeOffset, getOffsetState);
    const [draft, setDraft] = useState<string | null>(null);
    const [focused, setFocused] = useState(false);
    const sliderRef = useRef<HTMLInputElement>(null);
    const panelRef = useRef<HTMLElement>(null);
    const open = !!state?.open;
    const visible = open && !!(state?.revealed || focused);
    const tv = layoutManager.tv;

    // A remote's Back arrives as a `back` command on the focused element.
    useEffect(() => {
        const panel = panelRef.current;
        if (!visible || !panel) return;
        const onCommand = (e: Event) => {
            if ((e as CustomEvent).detail?.command === 'back') {
                e.preventDefault();
                e.stopPropagation();
                hideSubtitleOffset();
                setFocused(false);
                focusSettingsButton();
            }
        };
        panel.addEventListener('command', onCommand);
        return () => panel.removeEventListener('command', onCommand);
    }, [visible]);

    // Listening only while open: a closed panel leaves nothing behind on the player or the page.
    useEffect(() => {
        if (!open) return;
        const onOsd = (_e: unknown, shown: boolean) => setOffsetRevealed(shown);
        Events.on(document, EventType.SHOW_VIDEO_OSD, onOsd);
        const unsubscribe = subscribeTracks(() => syncSubtitleOffset());
        return () => {
            Events.off(document, EventType.SHOW_VIDEO_OSD, onOsd);
            unsubscribe();
        };
    }, [open]);

    // Opened from the settings menu: the slider takes the focus, so the arrows adjust it at once.
    useEffect(() => {
        if (open && sliderRef.current) focusManager.focus(sliderRef.current);
        if (!open) setDraft(null);
    }, [open]);

    if (!state || !visible) return null;
    const { ref, offset } = state;

    const close = () => {
        hideSubtitleOffset();
        setFocused(false);
        focusSettingsButton();
    };
    const commit = () => {
        if (draft == null) return;
        const value = parseOffset(draft);
        if (value != null) setOffset(ref, value);
        setDraft(null);
    };

    // Inside the panel the player's shortcuts and the remote's arrow-to-focus layer see nothing,
    // except what moves the focus out of it (Up/Down on TV, Tab) and G/H on the slider.
    const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
        const key = getKeyName(e.nativeEvent);
        if (key === 'Escape' || key === 'Back') {
            e.preventDefault();
            e.stopPropagation();
            close();
            return;
        }
        const inField =
            e.target instanceof HTMLInputElement && e.target.type === 'text';
        if (inField) {
            if (key === 'Enter') {
                e.preventDefault();
                commit();
            }
            if (key !== 'Tab') e.stopPropagation();
            return;
        }
        if (
            [
                'ArrowLeft',
                'ArrowRight',
                'Left',
                'Right',
                'Home',
                'End',
                'PageUp',
                'PageDown'
            ].includes(key)
        ) {
            e.stopPropagation();
        }
    };

    const controlProps: ControlProps = {
        onKeyDown,
        onFocus: () => setFocused(true),
        onBlur: (e) => {
            if (!panelRef.current?.contains(e.relatedTarget as Node | null)) {
                setFocused(false);
                setDraft(null);
            }
        }
    };

    return (
        <section
            className='rf-player-panel rf-subtitle-offset'
            data-rf-slot='subtitle-offset'
            aria-label={globalize.translate('SubtitleOffset')}
            ref={panelRef}
        >
            <CloseButton onClick={close} controlProps={controlProps} />
            <input
                type='text'
                className='rf-subtitle-offset__field'
                inputMode='decimal'
                spellCheck={false}
                aria-label={globalize.translate('SubtitleOffset')}
                // A remote has nothing to type with; the slider is its control.
                tabIndex={tv ? -1 : undefined}
                readOnly={tv}
                value={draft ?? `${offset}s`}
                onChange={(e) =>
                    setDraft(e.target.value.replace(/[^-+\d.s]/g, ''))
                }
                {...controlProps}
            />
            <input
                ref={sliderRef}
                type='range'
                className='rf-subtitle-offset__slider'
                min={OFFSET_MIN}
                max={OFFSET_MAX}
                step={OFFSET_STEP}
                value={offset}
                aria-label={globalize.translate('SubtitleOffset')}
                aria-valuetext={formatOffset(offset)}
                onChange={(e) => setOffset(ref, parseFloat(e.target.value))}
                {...controlProps}
            />
        </section>
    );
};

/**
 * The player's playback data and subtitle offset panels (DEBT-WEB-4). Rendered by the video
 * route beside the menus, portalled to the body like them, and only while the player view lends
 * its host: when the view hides, both close and forget the playback they were for.
 */
const PlayerPanels: FC = () => {
    const host = useSyncExternalStore(subscribeTrackMenuHost, getTrackMenuHost);

    useEffect(() => {
        if (host) return;
        closeStats();
        resetSubtitleOffset();
    }, [host]);

    if (!host) return null;
    return createPortal(
        <>
            <StatsPanel />
            <OffsetPanel />
        </>,
        document.body
    );
};

export default PlayerPanels;
