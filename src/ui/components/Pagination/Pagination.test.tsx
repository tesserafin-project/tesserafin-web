// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Pagination } from './Pagination';

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

describe('Pagination', () => {
    it('renders a nav landmark with the slot attribute and default labels', () => {
        act(() => {
            root.render(
                <Pagination
                    page={2}
                    totalPages={5}
                    onPreviousPage={() => undefined}
                    onNextPage={() => undefined}
                />
            );
        });

        const nav = container.querySelector('[data-rf-slot="pagination"]');
        expect(nav).not.toBeNull();
        expect(nav?.tagName).toBe('NAV');
        expect(nav?.getAttribute('aria-label')).toBe('Pagination');
        expect(container.textContent).toContain('Previous');
        expect(container.textContent).toContain('Next');
        expect(container.textContent).toContain('Page 2 of 5');
    });

    it('fires onPreviousPage when the previous button is clicked', () => {
        const onPreviousPage = vi.fn();
        act(() => {
            root.render(
                <Pagination
                    page={2}
                    totalPages={5}
                    onPreviousPage={onPreviousPage}
                    onNextPage={() => undefined}
                />
            );
        });

        const [previousButton] = container.querySelectorAll('button');
        act(() => {
            previousButton?.dispatchEvent(
                new MouseEvent('click', { bubbles: true })
            );
        });

        expect(onPreviousPage).toHaveBeenCalledTimes(1);
    });

    it('fires onNextPage when the next button is clicked', () => {
        const onNextPage = vi.fn();
        act(() => {
            root.render(
                <Pagination
                    page={2}
                    totalPages={5}
                    onPreviousPage={() => undefined}
                    onNextPage={onNextPage}
                />
            );
        });

        const buttons = container.querySelectorAll('button');
        const nextButton = buttons[buttons.length - 1];
        act(() => {
            nextButton?.dispatchEvent(
                new MouseEvent('click', { bubbles: true })
            );
        });

        expect(onNextPage).toHaveBeenCalledTimes(1);
    });

    it('disables the previous button on the first page', () => {
        act(() => {
            root.render(
                <Pagination
                    page={1}
                    totalPages={5}
                    onPreviousPage={() => undefined}
                    onNextPage={() => undefined}
                />
            );
        });

        const [previousButton] = container.querySelectorAll('button');
        expect((previousButton as HTMLButtonElement).disabled).toBe(true);
    });

    it('disables the next button on the last page', () => {
        act(() => {
            root.render(
                <Pagination
                    page={5}
                    totalPages={5}
                    onPreviousPage={() => undefined}
                    onNextPage={() => undefined}
                />
            );
        });

        const buttons = container.querySelectorAll('button');
        const nextButton = buttons[buttons.length - 1] as HTMLButtonElement;
        expect(nextButton.disabled).toBe(true);
    });

    it('accepts custom labels and a custom page-status formatter', () => {
        act(() => {
            root.render(
                <Pagination
                    page={3}
                    totalPages={9}
                    onPreviousPage={() => undefined}
                    onNextPage={() => undefined}
                    previousLabel='Précédent'
                    nextLabel='Suivant'
                    pageLabel={(page, totalPages) => `${page} / ${totalPages}`}
                    aria-label='Pagination de la bibliothèque'
                />
            );
        });

        const nav = container.querySelector('[data-rf-slot="pagination"]');
        expect(nav?.getAttribute('aria-label')).toBe(
            'Pagination de la bibliothèque'
        );
        expect(container.textContent).toContain('Précédent');
        expect(container.textContent).toContain('Suivant');
        expect(container.textContent).toContain('3 / 9');
    });
});
