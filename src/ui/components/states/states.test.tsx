// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { LoadingState } from './LoadingState';

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

describe('LoadingState', () => {
    it('renders a busy status region with the requested item count', () => {
        act(() => {
            root.render(<LoadingState variant='grid' itemCount={4} />);
        });

        const region = container.querySelector(
            '[data-rf-slot="state-loading"]'
        );
        expect(region).not.toBeNull();
        expect(region?.getAttribute('role')).toBe('status');
        expect(region?.getAttribute('aria-busy')).toBe('true');
        expect(
            container.querySelectorAll('.rf-loading-state__skeleton')
        ).toHaveLength(4);
    });
});

describe('EmptyState', () => {
    it('renders title/description and fires the action callback', () => {
        let acted = false;
        act(() => {
            root.render(
                <EmptyState
                    title='Nothing here'
                    description='Try another library.'
                    actionLabel='Browse'
                    onAction={() => {
                        acted = true;
                    }}
                />
            );
        });

        expect(container.textContent).toContain('Nothing here');
        expect(container.textContent).toContain('Try another library.');

        const button = container.querySelector(
            '[data-rf-slot="state-empty"] button'
        ) as HTMLButtonElement;
        expect(button).not.toBeNull();

        act(() => {
            button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(acted).toBe(true);
    });

    it('omits the action button when no callback is provided', () => {
        act(() => {
            root.render(<EmptyState title='Nothing here' />);
        });

        expect(
            container.querySelector('[data-rf-slot="state-empty"] button')
        ).toBeNull();
    });
});

describe('ErrorState', () => {
    it('renders as an alert and fires the retry callback', () => {
        let retried = false;
        act(() => {
            root.render(
                <ErrorState
                    message='Failed to load.'
                    retryLabel='Retry'
                    onRetry={() => {
                        retried = true;
                    }}
                />
            );
        });

        const region = container.querySelector('[data-rf-slot="state-error"]');
        expect(region?.getAttribute('role')).toBe('alert');
        expect(container.textContent).toContain('Failed to load.');

        const button = container.querySelector(
            '[data-rf-slot="state-error"] button'
        ) as HTMLButtonElement;

        act(() => {
            button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(retried).toBe(true);
    });
});
