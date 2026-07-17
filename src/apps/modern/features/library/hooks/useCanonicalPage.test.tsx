// @vitest-environment jsdom
import type { FC } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanonicalPage } from './useCanonicalPage';

// Same harness `ui/components/Pagination/Pagination.test.tsx` uses: no `@testing-library/react` in
// this repo, so a tiny probe component + `createRoot`/`act` is how hooks get exercised in isolation.
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
});

interface ProbeProps {
    page: number;
    totalPages: number;
    isReady: boolean;
    onCanonicalize: (page: number) => void;
}

const Probe: FC<ProbeProps> = ({
    page,
    totalPages,
    isReady,
    onCanonicalize
}) => {
    useCanonicalPage(page, totalPages, isReady, onCanonicalize);
    return null;
};

describe('useCanonicalPage()', () => {
    it('does nothing while the total is not known yet, even for an out-of-range page', () => {
        const onCanonicalize = vi.fn();
        act(() => {
            root.render(
                <Probe
                    page={999}
                    totalPages={1}
                    isReady={false}
                    onCanonicalize={onCanonicalize}
                />
            );
        });

        expect(onCanonicalize).not.toHaveBeenCalled();
    });

    it('clamps an out-of-range page down to totalPages once the total is known', () => {
        const onCanonicalize = vi.fn();
        act(() => {
            root.render(
                <Probe
                    page={999}
                    totalPages={3}
                    isReady
                    onCanonicalize={onCanonicalize}
                />
            );
        });

        expect(onCanonicalize).toHaveBeenCalledTimes(1);
        expect(onCanonicalize).toHaveBeenCalledWith(3);
    });

    it('clamps a page below 1 up to the first page', () => {
        const onCanonicalize = vi.fn();
        act(() => {
            root.render(
                <Probe
                    page={0}
                    totalPages={3}
                    isReady
                    onCanonicalize={onCanonicalize}
                />
            );
        });

        expect(onCanonicalize).toHaveBeenCalledWith(1);
    });

    it('does not call onCanonicalize when the page is already in range', () => {
        const onCanonicalize = vi.fn();
        act(() => {
            root.render(
                <Probe
                    page={2}
                    totalPages={3}
                    isReady
                    onCanonicalize={onCanonicalize}
                />
            );
        });

        expect(onCanonicalize).not.toHaveBeenCalled();
    });

    it('does not loop: re-rendering with the corrected page does not fire again', () => {
        const onCanonicalize = vi.fn();
        act(() => {
            root.render(
                <Probe
                    page={999}
                    totalPages={3}
                    isReady
                    onCanonicalize={onCanonicalize}
                />
            );
        });
        expect(onCanonicalize).toHaveBeenCalledTimes(1);

        // Simulates the `replace` navigation landing: the caller's `page` prop now matches the
        // clamped value the hook already asked for.
        act(() => {
            root.render(
                <Probe
                    page={3}
                    totalPages={3}
                    isReady
                    onCanonicalize={onCanonicalize}
                />
            );
        });

        expect(onCanonicalize).toHaveBeenCalledTimes(1);
    });
});
