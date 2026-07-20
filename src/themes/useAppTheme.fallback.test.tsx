// @vitest-environment jsdom
import { ThemeProvider } from '@mui/material/styles';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Safe fallback when a theme's chunk does not load (issue #18 / W13.8b).
 *
 * Every non-default theme is a dynamic `import()`, so it is a network resource and it can fail:
 * offline, a stale service worker after a deploy, a blocked request. What makes that failure worth
 * a dedicated test is that a theme's MUI color scheme and its `--rf-*` token stylesheet ride the
 * *same* chunk. If the app kept the requested id as active after a failed load, MUI would fall back
 * to the default scheme on its own while `data-rf-theme` still named the missing theme — and since
 * the generated token CSS has no `:root` tier, no `[data-rf-theme]` rule would match at all. Every
 * `--rf-*` property would be unset and each component would quietly render the static literal baked
 * into its own SCSS. The page would not crash; it would just stop being any theme in particular.
 *
 * `ensureColorSchemeLoaded` is mocked here rather than the network, because the contract under test
 * is precisely what `useAppTheme` does with the boolean that function returns.
 */

const ensureColorSchemeLoaded =
    vi.fn<(id: string | undefined) => Promise<boolean>>();

vi.mock('./colorSchemeCache', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./colorSchemeCache')>();
    return {
        ...actual,
        ensureColorSchemeLoaded: (id: string | undefined) =>
            ensureColorSchemeLoaded(id)
    };
});

const { useAppTheme } = await import('./useAppTheme');

function Harness({ themeId }: { themeId: string }) {
    const { theme, activeThemeId } = useAppTheme(themeId);
    return (
        <ThemeProvider theme={theme} defaultMode='dark'>
            <span data-testid='active'>{activeThemeId}</span>
        </ThemeProvider>
    );
}

let container: HTMLDivElement;
let root: Root;

const activeId = () =>
    container.querySelector('[data-testid="active"]')?.textContent;

const settle = async () => {
    for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {
            await Promise.resolve();
        });
    }
};

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
    document.documentElement.removeAttribute('data-rf-theme');
    document.documentElement.removeAttribute('data-rf-mode');
    ensureColorSchemeLoaded.mockReset();
});

describe('useAppTheme() when a theme chunk fails to load', () => {
    it('falls back to the default theme, tags and all', async () => {
        ensureColorSchemeLoaded.mockResolvedValue(false);

        await act(async () => {
            root.render(<Harness themeId='official.glass' />);
        });
        await settle();

        expect(activeId()).toBe('official.classic');
        // The decisive assertion: `data-rf-theme` must not be left naming a theme whose token
        // stylesheet never arrived, or nothing matches and every token goes unset.
        expect(document.documentElement.getAttribute('data-rf-theme')).toBe(
            'official.classic'
        );
        expect(document.documentElement.getAttribute('data-rf-mode')).toBe(
            'dark'
        );
    });

    it('falls back from Glass Light without stranding its light mode', async () => {
        ensureColorSchemeLoaded.mockResolvedValue(false);

        await act(async () => {
            root.render(<Harness themeId='official.glass.light' />);
        });
        await settle();

        expect(activeId()).toBe('official.classic');
        expect(document.documentElement.getAttribute('data-rf-theme')).toBe(
            'official.classic'
        );
        // Classic's own mode, not the failed entry's — a half-applied fallback that kept `light`
        // would select Classic's light tier for a user who asked for neither.
        expect(document.documentElement.getAttribute('data-rf-mode')).toBe(
            'dark'
        );
    });

    it('keeps a theme that does load, so the fallback is not unconditional', async () => {
        ensureColorSchemeLoaded.mockResolvedValue(true);

        await act(async () => {
            root.render(<Harness themeId='official.glass' />);
        });
        await settle();

        expect(activeId()).toBe('official.glass');
        expect(document.documentElement.getAttribute('data-rf-theme')).toBe(
            'official.glass'
        );
    });

    it('renders Glass Light against Glass’s token stylesheet when it loads', async () => {
        ensureColorSchemeLoaded.mockResolvedValue(true);

        await act(async () => {
            root.render(<Harness themeId='official.glass.light' />);
        });
        await settle();

        expect(activeId()).toBe('official.glass.light');
        // The `tokenThemeId` indirection, observed on the document: the entry is
        // `official.glass.light`, the stylesheet it selects is `official.glass`'s.
        expect(document.documentElement.getAttribute('data-rf-theme')).toBe(
            'official.glass'
        );
        expect(document.documentElement.getAttribute('data-rf-mode')).toBe(
            'light'
        );
    });
});
