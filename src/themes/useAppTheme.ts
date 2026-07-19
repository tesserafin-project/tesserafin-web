import type { Theme } from '@mui/material/styles';
import { useEffect, useMemo, useState } from 'react';

import { EventType } from 'constants/eventType';
import Events, { type Event } from 'utils/events';

import { ensureColorSchemeLoaded, getColorSchemes } from './colorSchemeCache';
import { getDefaultThemeEntry, getThemeEntry } from './registry';
import { useInteractionProfiles } from './useInteractionProfiles';
import { buildAppTheme } from '.';

export interface AppTheme {
    /** The MUI theme to pass to `<ThemeProvider theme>`. */
    theme: Theme;
    /**
     * The theme id this hook resolved as "active" (registry id — same string used for
     * `userSettings.theme()`, the MUI color scheme key, and `data-theme`/`data-rf-theme`).
     *
     * `<ThemeProvider>` only recognizes `theme.colorSchemes` keys it was created with. Because
     * that map now grows lazily (RFC-0005 §9.1), a `THEME_CHANGE` (or explicit id) that arrives
     * for a not-yet-loaded theme is silently dropped by MUI's `setColorScheme` — it validates
     * against the *current* theme's known schemes and only warns, it does not retry
     * (`@mui/system/cssVars/useCurrentColorScheme.js`). Callers must re-apply `activeThemeId` via
     * `useColorScheme().setColorScheme` themselves, from a component mounted *inside* the
     * `<ThemeProvider>` this hook's `theme` configures, once the id (and/or the theme it rebuilds
     * into) changes — see `utils/reactUtils.tsx`'s `CustomThemeProvider` and
     * `RootAppRouter.tsx`'s `ColorSchemeSync` for the two call sites doing exactly that. Listing
     * MUI's `setColorScheme` itself in that effect's dependency array is what makes the retry
     * happen automatically: its identity changes once the rebuilt theme includes the new scheme.
     */
    activeThemeId: string;
}

/**
 * Builds (and rebuilds, as lazily-loaded color schemes arrive) the app's MUI theme, and keeps
 * `data-rf-theme`/`data-rf-mode` on `<html>` in sync with the active theme (RFC-0005 §7.1/§9.1).
 *
 * It also drives Reefin Glass's interaction profiles via `useInteractionProfiles` — which projects
 * `data-rf-profile`, `data-rf-reduced-motion` and the profile's `--rf-*` overrides onto `<html>`,
 * and which no-ops entirely for every theme other than `official.glass` (RFC-0005 §7.2).
 *
 * ## Falling back to the default theme
 *
 * A requested theme can turn out to be unrenderable: its id may not be in the registry (a stale
 * manifest, or a preference written by an older build), or its lazily-imported chunk may fail to
 * arrive. Since issue #18's G18b-1 slice made Reefin Glass — a lazy theme — user-selectable, that
 * is a reachable state for a saved preference and not merely a theoretical one. Either way this
 * hook resolves `activeThemeId` to `getDefaultThemeEntry()` (Reefin Classic, whose scheme is
 * bundled synchronously and so is always renderable), so the app lands on a coherent theme rather
 * than tagging `<html>` with one whose palette never loaded. Because `activeThemeId` — not the
 * requested id — is what drives `data-rf-theme` and `useInteractionProfiles`, the fallback also
 * keeps Glass's profiles off when Glass itself failed to load.
 *
 * @param explicitThemeId When provided, the hook applies exactly this theme id and reacts only to
 * it changing — this is the `utils/reactUtils.tsx` legacy-view mount path, which already resolves
 * the desired id itself via `useUserTheme()` and must not also react to the imperative
 * `THEME_CHANGE` bus (that bus also carries `dashboardTheme` switches on dashboard page
 * navigation, which that call site has never followed — preserving that distinction here).
 * When omitted, the hook instead listens to the legacy `EventType.THEME_CHANGE` event on
 * `document` (`scripts/themeManager.js`) — this is the `RootAppRouter.tsx` path, which has always
 * been driven by that event bus via `ThemeStorageManager`.
 */
export function useAppTheme(explicitThemeId?: string): AppTheme {
    const [eventThemeId, setEventThemeId] = useState<string | undefined>(
        undefined
    );
    // Bumped once the active theme's color scheme finishes loading, to force a rebuild of the
    // memoized theme below — colorSchemeCache mutates its cache in place, so there is no new
    // object reference to key the memo on.
    const [loadedTick, setLoadedTick] = useState(0);

    useEffect(() => {
        if (explicitThemeId !== undefined) {
            return undefined;
        }

        const handler = (_e: Event, id: string) => setEventThemeId(id);
        Events.on(document, EventType.THEME_CHANGE, handler);
        return () => Events.off(document, EventType.THEME_CHANGE, handler);
    }, [explicitThemeId]);

    // Theme ids proven unrenderable: not in the registry, or their lazy chunk failed to load
    // (`ensureColorSchemeLoaded` resolving `false`). Requests for these resolve to the default
    // theme instead of leaving the app tagged with a palette that never arrived. The set only ever
    // grows, and the default theme's own scheme is bundled synchronously and so can never enter
    // it, which is what stops the fallback below from being able to loop.
    const [unavailableThemeIds, setUnavailableThemeIds] = useState<
        ReadonlySet<string>
    >(() => new Set());

    const requestedThemeId =
        explicitThemeId ?? eventThemeId ?? getDefaultThemeEntry().id;
    const activeThemeId = unavailableThemeIds.has(requestedThemeId)
        ? getDefaultThemeEntry().id
        : requestedThemeId;

    useEffect(() => {
        let cancelled = false;
        void ensureColorSchemeLoaded(activeThemeId).then((available) => {
            if (cancelled) {
                return;
            }
            if (!available) {
                setUnavailableThemeIds((ids) =>
                    new Set(ids).add(activeThemeId)
                );
                return;
            }
            setLoadedTick((tick) => tick + 1);
        });
        return () => {
            cancelled = true;
        };
    }, [activeThemeId]);

    useEffect(() => {
        const entry = getThemeEntry(activeThemeId);
        const root = document.documentElement;
        // `data-rf-theme` selects the generated token stylesheet, which is not always named after
        // the entry: `official.glass.light` renders `official.glass`'s tokens in its light tier.
        // See `registry.ts#tokenThemeId`.
        root.setAttribute('data-rf-theme', entry?.tokenThemeId ?? activeThemeId);
        root.setAttribute('data-rf-mode', entry?.defaultMode ?? 'dark');
    }, [activeThemeId]);

    useInteractionProfiles(activeThemeId);

    const theme = useMemo(
        () => buildAppTheme(getColorSchemes()),
        [activeThemeId, loadedTick]
    );

    return { theme, activeThemeId };
}
