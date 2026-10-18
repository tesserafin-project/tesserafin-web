/**
 * The subtitle offset, as the React panel and the G/H keys need it (DEBT-WEB-4).
 *
 * The offset applies to one playback: the engine resets it, and its "show the offset" flag, on a
 * new play request and on a subtitle track switch. So the panel's state names the playback it was
 * opened for, every command checks that playback is still the player's, and the panel closes
 * when it is not - or when the track on can no longer be shifted (an embedded or SSA one).
 *
 * The offset the viewer sees is kept here, not read back from the player: the player applies a
 * new offset after a 100 ms debounce, so reading it right after a change returns the old one
 * (pressing H three times quickly used to move it by one step).
 */
import { playbackManager } from 'components/playback/playbackmanager';

import {
    type PlaybackRef,
    currentRef,
    isCurrent
} from 'apps/modern/features/playerTracks/playerTracks';

/** Seconds. The old slider's range and step; a typed value is clamped and rounded to them. */
export const OFFSET_MIN = -30;
export const OFFSET_MAX = 30;
export const OFFSET_STEP = 0.1;

export function clampOffset(value: number): number {
    const stepped = Math.round(value / OFFSET_STEP) * OFFSET_STEP;
    return +Math.min(OFFSET_MAX, Math.max(OFFSET_MIN, stepped)).toFixed(1);
}

/** The first number in what the viewer typed ("2.5", "-1s", "+3"), clamped; null if there is none. */
export function parseOffset(text: string): number | null {
    const match = /[-+]?\d+\.?\d*/.exec(text);
    return match ? clampOffset(parseFloat(match[0])) : null;
}

/** "+0.5s", "0s", "-1.2s". */
export function formatOffset(value: number): string {
    return `${value > 0 ? '+' : ''}${value}s`;
}

/** The player can shift subtitles, and the track on is one it can shift (an external one). */
export function offsetAvailable(ref: PlaybackRef): boolean {
    return (
        isCurrent(ref) &&
        !!playbackManager.supportSubtitleOffset(ref.player) &&
        !!playbackManager.canHandleOffsetOnCurrentSubtitle(ref.player)
    );
}

export interface OffsetState {
    ref: PlaybackRef;
    offset: number;
    /** The viewer opened the panel for this playback (the settings menu's Subtitle offset). */
    open: boolean;
    /** Shown while the player's controls are, or since a G/H press; the panel also shows while focused. */
    revealed: boolean;
}

let state: OffsetState | null = null;
const listeners = new Set<() => void>();

function set(next: OffsetState | null): void {
    state = next;
    for (const listener of listeners) listener();
}

export function getOffsetState(): OffsetState | null {
    return state;
}

export function subscribeOffset(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function sameRef(a: PlaybackRef, b: PlaybackRef): boolean {
    return (
        a.player === b.player &&
        a.playback === b.playback &&
        a.itemId === b.itemId
    );
}

/** The state of `ref`'s playback, started from what the player holds if it is a new one. */
function stateFor(ref: PlaybackRef): OffsetState {
    if (state && sameRef(state.ref, ref)) return state;
    return {
        ref,
        offset: playbackManager.getPlayerSubtitleOffset(ref.player) || 0,
        open: false,
        revealed: false
    };
}

/** Opens the panel for `ref`. False when the offset does not apply to what it plays. */
export function showSubtitleOffset(ref: PlaybackRef): boolean {
    if (!offsetAvailable(ref)) return false;
    playbackManager.enableShowingSubtitleOffset(ref.player);
    set({ ...stateFor(ref), open: true, revealed: true });
    return true;
}

/** Closes the panel. The offset stays in effect, as the old close button left it. */
export function hideSubtitleOffset(): void {
    if (state?.open && isCurrent(state.ref)) {
        playbackManager.disableShowingSubtitleOffset(state.ref.player);
    }
    if (state) set({ ...state, open: false });
}

/** Sets the offset of `ref`'s playback. False, and nothing changed, once that is gone. */
export function setOffset(ref: PlaybackRef, value: number): boolean {
    if (!offsetAvailable(ref)) return false;
    const offset = clampOffset(value);
    playbackManager.setSubtitleOffset(offset, ref.player);
    set({ ...stateFor(ref), offset });
    return true;
}

/** G (-1) and H (+1): one step on what plays now; shows the panel if it was opened for it. */
export function nudgeSubtitleOffset(direction: 1 | -1): void {
    const ref = currentRef();
    if (!ref || !offsetAvailable(ref)) return;
    const current = stateFor(ref);
    if (setOffset(ref, current.offset + direction * OFFSET_STEP) && state) {
        set({ ...state, revealed: true });
    }
}

/** The player's controls show or hide: the panel follows them. */
export function setOffsetRevealed(revealed: boolean): void {
    if (state && state.revealed !== revealed) set({ ...state, revealed });
}

/**
 * The tracks or the playback changed. A replaced or stopped playback takes its panel with it;
 * a subtitle switch (the engine reset the offset to 0) keeps the panel at 0 if the new track can
 * be shifted, and closes it if not.
 */
export function syncSubtitleOffset(trackSwitched = false): void {
    if (!state) return;
    if (!isCurrent(state.ref)) {
        set(null);
        return;
    }
    if (!trackSwitched) return;
    if (state.open && offsetAvailable(state.ref)) {
        playbackManager.enableShowingSubtitleOffset(state.ref.player);
        set({ ...state, offset: 0 });
    } else {
        set({ ...state, offset: 0, open: false });
    }
}

/** The player view hides. */
export function resetSubtitleOffset(): void {
    set(null);
}
