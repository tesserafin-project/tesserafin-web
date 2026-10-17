// @vitest-environment jsdom
import React, { type FC } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('lib/globalize', () => ({
    default: { translate: (key: string) => key }
}));
vi.mock('lib/jellyfin-apiclient', () => ({ ServerConnections: {} }));
vi.mock('components/itemHelper', () => ({ default: {} }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }));

import { useSearchSelection } from './searchSelection';

let state: ReturnType<typeof useSearchSelection>;
const Probe: FC = () => {
    state = useSearchSelection();
    return null;
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    container = document.createElement('div');
    act(() => {
        root = createRoot(container);
        root.render(<Probe />);
    });
});
afterEach(() => act(() => root.unmount()));

describe('search multi-select state', () => {
    it('selects, deselects, and leaves selection with the last item', () => {
        act(() => state.start('a'));
        expect(state.selected).toEqual(['a']);
        act(() => state.toggle('b'));
        expect(state.selected).toEqual(['a', 'b']);
        act(() => state.toggle('a'));
        expect(state.selected).toEqual(['b']);
        act(() => state.toggle('b'));
        expect(state.selected).toBeNull();
    });

    it('starts empty from the Select button, selects all, and cancels', () => {
        act(() => state.start());
        expect(state.selected).toEqual([]);
        act(() => state.selectAll(['a', 'b', 'c']));
        expect(state.selected).toEqual(['a', 'b', 'c']);
        act(() => state.cancel());
        expect(state.selected).toBeNull();
    });
});
