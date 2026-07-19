/**
 * The live signals behind Reefin Glass's interaction profiles (RFC-0005 §7.2, issue #18), as
 * specified in `docs/reefin/design-glass-interaction-profiles.md` §4.
 *
 * Each profile is derived from an **observable, reversible** platform signal — never from a stored
 * preference — so turning the underlying condition off restores the previous presentation with no
 * further action:
 *
 *   - `reducedTransparency` ← `matchMedia('(prefers-reduced-transparency: reduce)')`
 *   - `reducedMotion`       ← `matchMedia('(prefers-reduced-motion: reduce)')`
 *   - `lowPower`            ← `matchMedia('(update: slow)')` OR a discharging battery at or below
 *                             {@link LOW_BATTERY_THRESHOLD}
 *   - `remote`              ← the {@link TV_LAYOUT_CLASS} class on `<html>`, watched for changes
 *
 * This module owns subscription and teardown only; it resolves nothing and applies nothing. What a
 * given profile *means* lives in `src/ui/tokens/profiles.ts` as concrete token partials, and
 * reaches the page through `src/ui/tokens/projectTokens.ts`.
 *
 * ## Why `remote` reads the DOM instead of importing `layoutManager`
 *
 * `components/layoutManager` is the authority on the TV layout, but importing it here would pull
 * `apphost` — and through it `globalize`, `datetime` and the rest of the legacy boot chain — into
 * the theme path, which is main-bundle and initialises early. Coupling the design system to that
 * graph is a cost with no matching benefit, and it makes this module untestable in isolation.
 *
 * Instead the signal reads the thing `layoutManager` *publishes*: it writes `layout-<mode>` onto
 * `document.documentElement` on every mode change, and `.layout-tv` is already a long-standing
 * public contract that `src/styles/site.scss` and much of the legacy CSS style against. Watching
 * the class is watching the same state, one level down, with a `MutationObserver` in place of the
 * `modechange` event — and it is strictly more robust, since it also catches a layout applied
 * before this subscription started.
 *
 * ## Teardown
 *
 * Every listener registered here is removed by the returned unsubscribe function: the media
 * queries, the mutation observer, and the two battery listeners — which attach asynchronously,
 * after `navigator.getBattery()` resolves, and so can land *after* teardown has already run. That
 * race is handled explicitly below rather than left to chance: a battery event firing against a
 * torn-down subscription would push profile state onto an unmounted consumer.
 */

import type { ActiveProfiles } from '../ui/tokens/profiles';

/**
 * Discharging at or below 20% counts as low power. Matches the level at which the major mobile
 * platforms offer their own battery-saver prompt, so Reefin flattens its compositing at roughly the
 * moment the user is already being told the device is conserving energy.
 */
const LOW_BATTERY_THRESHOLD = 0.2;

/** `(update: slow)` reports a display that cannot repaint quickly — e-ink, low-end TV panels. */
const SLOW_UPDATE_QUERY = '(update: slow)';
const REDUCED_TRANSPARENCY_QUERY = '(prefers-reduced-transparency: reduce)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * The class `components/layoutManager` puts on `<html>` for the TV layout (`LayoutMode.Tv`). See
 * the module comment for why the class is read rather than the manager imported.
 */
export const TV_LAYOUT_CLASS = 'layout-tv';

interface BatteryLike {
    charging: boolean;
    level: number;
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
}

type NavigatorWithBattery = Navigator & {
    getBattery?: () => Promise<BatteryLike>;
};

/**
 * Subscribes to every profile signal and invokes `onChange` with the full {@link ActiveProfiles}
 * set — on subscription, and again on each change.
 *
 * `onChange` always receives the complete state rather than a diff, so a consumer never has to
 * remember which signal moved: re-resolving from the whole set is what makes the profiles
 * cumulative (`remote` + `lowPower` is a real, distinct state) instead of last-writer-wins.
 *
 * @returns An unsubscribe function. Idempotent, and safe to call before the battery probe settles.
 */
export const subscribeToProfileSignals = (
    onChange: (active: ActiveProfiles) => void
): (() => void) => {
    // A page can be rendered without `matchMedia` (jsdom without a stub, very old WebViews). Every
    // signal is an *enhancement*: absent one, the profile is simply never active, and Glass renders
    // exactly as its stylesheet declares.
    const query = (text: string): MediaQueryList | undefined =>
        typeof window.matchMedia === 'function'
            ? window.matchMedia(text)
            : undefined;

    const reducedTransparency = query(REDUCED_TRANSPARENCY_QUERY);
    const reducedMotion = query(REDUCED_MOTION_QUERY);
    const slowUpdate = query(SLOW_UPDATE_QUERY);

    let battery: BatteryLike | undefined;
    let torndown = false;

    const isLowPower = (): boolean => {
        if (slowUpdate?.matches) {
            return true;
        }
        return battery
            ? !battery.charging && battery.level <= LOW_BATTERY_THRESHOLD
            : false;
    };

    const emit = (): void => {
        if (torndown) {
            return;
        }
        onChange({
            remote: document.documentElement.classList.contains(
                TV_LAYOUT_CLASS
            ),
            lowPower: isLowPower(),
            reducedTransparency: Boolean(reducedTransparency?.matches),
            reducedMotion: Boolean(reducedMotion?.matches)
        });
    };

    // Safari < 14 exposes only the deprecated `addListener`. Feature-detect rather than assume, so
    // the profiles degrade to "never active" instead of throwing during theme setup.
    const listenTo = (list: MediaQueryList | undefined): (() => void) => {
        if (!list) {
            return () => undefined;
        }
        if (typeof list.addEventListener === 'function') {
            list.addEventListener('change', emit);
            return () => list.removeEventListener('change', emit);
        }
        list.addListener(emit);
        return () => list.removeListener(emit);
    };

    const unlisten = [
        listenTo(reducedTransparency),
        listenTo(reducedMotion),
        listenTo(slowUpdate)
    ];

    // Layout changes arrive as a class swap on `<html>`. Scoped to the `class` attribute of that
    // one element (no subtree, no character data), so the observer cannot become a general-purpose
    // DOM firehose as the app grows.
    if (typeof MutationObserver === 'function') {
        const observer = new MutationObserver(emit);
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class']
        });
        unlisten.push(() => observer.disconnect());
    }

    const navigatorWithBattery = navigator as NavigatorWithBattery;
    if (typeof navigatorWithBattery.getBattery === 'function') {
        void navigatorWithBattery
            .getBattery()
            .then((probed) => {
                // The probe can resolve after teardown. Attaching listeners here would leak them —
                // the unsubscribe function has already run and cannot remove what does not yet
                // exist — so bail instead, leaving nothing attached.
                if (torndown) {
                    return;
                }
                battery = probed;
                probed.addEventListener('levelchange', emit);
                probed.addEventListener('chargingchange', emit);
                unlisten.push(() => {
                    probed.removeEventListener('levelchange', emit);
                    probed.removeEventListener('chargingchange', emit);
                });
                emit();
            })
            .catch(() => {
                // A rejected battery probe (permissions policy, insecure context) means the signal
                // is unavailable, not that the device is low on power. `isLowPower()` keeps
                // reporting `(update: slow)` alone.
            });
    }

    emit();

    return () => {
        torndown = true;
        for (const off of unlisten.splice(0)) {
            off();
        }
    };
};
