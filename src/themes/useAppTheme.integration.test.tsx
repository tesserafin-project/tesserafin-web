// @vitest-environment jsdom
import {
    type SupportedColorScheme,
    ThemeProvider,
    useColorScheme
} from '@mui/material/styles';
import { useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EventType } from 'constants/eventType';
import Events from 'utils/events';

import {
    __resetColorSchemeCacheForTests,
    ensureColorSchemeLoaded
} from './colorSchemeCache';
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
    __resetColorSchemeCacheForTests();
});

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
