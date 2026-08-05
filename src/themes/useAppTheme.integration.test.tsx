// @vitest-environment jsdom
import {
    type SupportedColorScheme,
    ThemeProvider,
    useColorScheme
} from '@mui/material/styles';
import { useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventType } from 'constants/eventType';
import Events from 'utils/events';

import {
    __resetColorSchemeCacheForTests,
    ensureColorSchemeLoaded
} from './colorSchemeCache';
import { getThemeEntry } from './registry';
import { ThemeStorageManager } from './themeStorageManager';
import { useAppTheme } from './useAppTheme';

/**
 * Mirrors `RootAppRouter.tsx`'s `ColorSchemeSync`: actively re-applies `themeId` as MUI's color
 * scheme from inside the `<ThemeProvider>` it configures. See `useAppTheme.ts`'s `AppTheme` doc for
 * why the `RootAppRouter.tsx` (event-driven) path needs this in addition to `ThemeStorageManager`.
 */
function ColorSchemeSync({ themeId }: { themeId: string }) {
    const { setColorScheme } = useColorScheme();

    useEffect(() => {
        setColorScheme(themeId as SupportedColorScheme);
    }, [themeId, setColorScheme]);

    return null;
}

function Probe({ onColorScheme }: { onColorScheme: (id: string) => void }) {
    const { colorScheme } = useColorScheme();
    useEffect(() => {
        if (colorScheme) onColorScheme(colorScheme);
    }, [colorScheme, onColorScheme]);
    return null;
}

function Harness({ onColorScheme }: { onColorScheme: (id: string) => void }) {
    const { theme, activeThemeId } = useAppTheme();
    return (
        <ThemeProvider
            theme={theme}
            defaultMode='dark'
            storageManager={ThemeStorageManager}
        >
            <ColorSchemeSync themeId={activeThemeId} />
            <Probe onColorScheme={onColorScheme} />
        </ThemeProvider>
    );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
        root = createRoot(container);
    });
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-rf-theme');
    document.documentElement.removeAttribute('data-rf-mode');
    document.documentElement.removeAttribute('data-rf-profile');
    document.documentElement.removeAttribute('data-rf-reduced-motion');
    document.documentElement.style.cssText = '';
    __resetColorSchemeCacheForTests();
    vi.restoreAllMocks();
});

/** Lets React finish the load → rebuild → re-apply chain the lazy themes go through. */
const settle = async () => {
    for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {
            await Promise.resolve();
        });
    }
};

describe('useAppTheme() driven by the legacy THEME_CHANGE bus (RootAppRouter.tsx path)', () => {
    it('applies the default theme on mount, tagging data-theme/data-rf-theme/data-rf-mode', async () => {
        const seen: string[] = [];
        const onColorScheme = (id: string) => seen.push(id);

        await act(async () => {
            root.render(<Harness onColorScheme={onColorScheme} />);
        });

        expect(document.documentElement.getAttribute('data-theme')).toBe(
            'official.classic'
        );
        expect(document.documentElement.getAttribute('data-rf-theme')).toBe(
            'official.classic'
        );
        expect(document.documentElement.getAttribute('data-rf-mode')).toBe(
            'dark'
        );
        expect(seen).toContain('official.classic');
    });

    it('applies a lazily-loaded theme once its color scheme finishes loading, self-healing the first setColorScheme() MUI drops', async () => {
        const seen: string[] = [];
        const onColorScheme = (id: string) => seen.push(id);

        await act(async () => {
            root.render(<Harness onColorScheme={onColorScheme} />);
        });

        // Simulate scripts/themeManager.js switching the theme (e.g. from displaySettings.js).
        // "appletv"'s color scheme is NOT yet loaded at this point, exercising the exact race
        // useAppTheme.ts's AppTheme.activeThemeId doc describes.
        await act(async () => {
            Events.trigger(document, EventType.THEME_CHANGE, ['appletv']);
        });

        // Wait for the actual dynamic import() to resolve (this is the same cache useAppTheme.ts
        // reads from), then give React a few more flushes so the resulting re-render — theme
        // rebuild -> new setColorScheme identity -> ColorSchemeSync's effect retry — settles.
        await act(async () => {
            await ensureColorSchemeLoaded('appletv');
        });
        for (let i = 0; i < 5; i++) {
            // eslint-disable-next-line no-await-in-loop
            await act(async () => {
                await Promise.resolve();
            });
        }

        expect(document.documentElement.getAttribute('data-theme')).toBe(
            'appletv'
        );
        expect(document.documentElement.getAttribute('data-rf-theme')).toBe(
            'appletv'
        );
        expect(document.documentElement.getAttribute('data-rf-mode')).toBe(
            'light'
        );
        expect(seen[seen.length - 1]).toBe('appletv');
    });
});

/**
 * Issue #18 G18b-1: Tesserafin Glass became user-selectable, which makes two previously unreachable
 * states reachable for a *saved* preference — a theme whose lazy chunk fails to arrive, and a theme
 * id that is no longer in the registry. Both must land on Classic rather than leave `<html>` tagged
 * with a palette that never loaded.
 */
describe('useAppTheme() falling back when the requested theme cannot render', () => {
    it('applies Glass normally when its chunk loads', async () => {
        await act(async () => {
            root.render(<Harness onColorScheme={() => undefined} />);
        });

        await act(async () => {
            Events.trigger(document, EventType.THEME_CHANGE, [
                'official.glass'
            ]);
        });
        await act(async () => {
            await ensureColorSchemeLoaded('official.glass');
        });
        await settle();

        expect(document.documentElement.getAttribute('data-rf-theme')).toBe(
            'official.glass'
        );
        expect(document.documentElement.getAttribute('data-rf-mode')).toBe(
            'dark'
        );
    });

    it('falls back to Classic when the Glass chunk fails to load', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const glass = getThemeEntry('official.glass');
        vi.spyOn(glass!, 'loadColorScheme').mockRejectedValue(
            new Error('ChunkLoadError: Loading chunk failed')
        );

        await act(async () => {
            root.render(<Harness onColorScheme={() => undefined} />);
        });

        await act(async () => {
            Events.trigger(document, EventType.THEME_CHANGE, [
                'official.glass'
            ]);
        });
        await settle();

        // The requested theme is unrenderable, so the *active* theme — and therefore everything
        // derived from it — must be Classic, not a half-applied Glass.
        expect(document.documentElement.getAttribute('data-rf-theme')).toBe(
            'official.classic'
        );
        expect(document.documentElement.getAttribute('data-rf-mode')).toBe(
            'dark'
        );
        // Glass's profiles are gated on the active theme, so the fallback must also have kept them
        // off — a broken Glass must not leave the document carrying Glass's projection.
        expect(
            document.documentElement.getAttribute('data-rf-profile')
        ).toBeNull();
    });

    it('falls back to Classic for a theme id that is not in the registry', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        await act(async () => {
            root.render(<Harness onColorScheme={() => undefined} />);
        });

        await act(async () => {
            Events.trigger(document, EventType.THEME_CHANGE, [
                'official.removed-in-a-later-build'
            ]);
        });
        await settle();

        expect(document.documentElement.getAttribute('data-rf-theme')).toBe(
            'official.classic'
        );
    });
});

/**
 * Proves the listener ledger balances across a real theme change driven the way the picker drives
 * it (the `THEME_CHANGE` bus). `interactionProfileSignals.test.ts` proves `unsubscribe()` removes
 * every listener it added; this proves `useAppTheme` → `useInteractionProfiles` actually *calls*
 * that teardown when the user switches away from Glass, which is the path G18b-1 opened up.
 */
describe('useAppTheme() listener hygiene across a theme change', () => {
    it('removes every media-query listener it added when leaving Glass for Classic', async () => {
        const added: string[] = [];
        const removed: string[] = [];

        // The three queries `interactionProfileSignals.ts` subscribes to. Counting is scoped to
        // them because MUI's own color-scheme provider also calls `matchMedia` on this stub, and
        // an inflated ledger would make the balance assertion below meaningless.
        const PROFILE_QUERIES = [
            '(prefers-reduced-transparency: reduce)',
            '(prefers-reduced-motion: reduce)',
            '(update: slow)'
        ];
        const record = (into: string[], media: string) => {
            if (PROFILE_QUERIES.includes(media)) into.push(media);
        };

        vi.stubGlobal(
            'matchMedia',
            vi.fn((media: string) => ({
                matches: false,
                media,
                addEventListener: (_type: string, _fn: () => void) =>
                    record(added, media),
                removeEventListener: (_type: string, _fn: () => void) =>
                    record(removed, media),
                // MUI's `useCurrentColorScheme` still uses the deprecated API; the profile signals
                // prefer `addEventListener` and so never reach these.
                addListener: () => undefined,
                removeListener: () => undefined
            }))
        );

        await act(async () => {
            root.render(<Harness onColorScheme={() => undefined} />);
        });

        await act(async () => {
            Events.trigger(document, EventType.THEME_CHANGE, [
                'official.glass'
            ]);
        });
        await act(async () => {
            await ensureColorSchemeLoaded('official.glass');
        });
        await settle();

        // Glass is active, so the profile signals must actually be subscribed — otherwise the
        // teardown assertion below would pass vacuously.
        expect(added.length).toBeGreaterThan(0);
        expect(removed).toHaveLength(0);

        await act(async () => {
            Events.trigger(document, EventType.THEME_CHANGE, [
                'official.classic'
            ]);
        });
        await settle();

        expect(document.documentElement.getAttribute('data-rf-theme')).toBe(
            'official.classic'
        );
        // Same media queries, same count: nothing left attached to the document.
        expect(removed.sort()).toEqual(added.sort());
        // And nothing of Glass's projection survives on `<html>`.
        expect(
            document.documentElement.getAttribute('data-rf-profile')
        ).toBeNull();
        expect(document.documentElement.style.cssText).toBe('');
    });
});
