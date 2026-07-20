// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Theme } from 'types/webConfig';

import { useThemes } from './useThemes';

/**
 * The picker-facing view of the theme catalog (issue #18 G18b-1).
 *
 * `registry.test.ts` pins what the registry decides; this pins what actually reaches a picker
 * through the hook `DisplayPreferences.tsx` renders from — specifically that Reefin Glass is
 * offered at all (it was withheld before this slice) and that it arrives carrying the
 * `experimental` marker the badge is driven from. Without the second assertion the theme could be
 * selectable but silently unbadged, which is the outcome the product decision rules out.
 */

let container: HTMLDivElement;
let root: Root;

const renderThemes = (): { themes: Theme[]; defaultTheme?: Theme } => {
    let captured: { themes: Theme[]; defaultTheme?: Theme } = { themes: [] };

    const Probe = () => {
        captured = useThemes();
        return null;
    };

    act(() => {
        root.render(<Probe />);
    });

    return captured;
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
});

describe('useThemes()', () => {
    it('offers Reefin Glass as a selectable theme', () => {
        const { themes } = renderThemes();

        expect(themes.map((theme) => theme.id)).toContain('official.glass');
    });

    it('marks Reefin Glass experimental so the picker can badge it', () => {
        const { themes } = renderThemes();
        const glass = themes.find((theme) => theme.id === 'official.glass');

        expect(glass).toBeDefined();
        expect(glass?.experimental).toBe(true);
        expect(glass?.name).toBe('Reefin Glass');
    });

    it('badges only the two Glass modes, leaving every other offered theme unmarked', () => {
        const { themes } = renderThemes();
        const experimentalIds = themes
            .filter((theme) => theme.experimental)
            .map((theme) => theme.id);

        expect(experimentalIds).toEqual([
            'official.glass',
            'official.glass.light'
        ]);
    });

    it('keeps Reefin Classic the default, so Glass is opt-in only', () => {
        const { themes, defaultTheme } = renderThemes();

        expect(defaultTheme?.id).toBe('official.classic');
        expect(themes.filter((theme) => theme.default)).toHaveLength(1);
    });
});
