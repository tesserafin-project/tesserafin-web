// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MediaCard } from './MediaCard';

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

describe('MediaCard', () => {
    it('renders the title and slot attribute', () => {
        act(() => {
            root.render(<MediaCard title='The Matrix' imageAspect='poster' />);
        });

        const card = container.querySelector('[data-rf-slot="media-card"]');
        expect(card).not.toBeNull();
        expect(card?.textContent).toContain('The Matrix');
    });

    it('renders the subtitle when provided', () => {
        act(() => {
            root.render(
                <MediaCard
                    title='Episode 1'
                    subtitle='Season 1'
                    imageAspect='backdrop'
                />
            );
        });

        expect(container.textContent).toContain('Season 1');
    });

    it('renders a progressbar reflecting progressPercent', () => {
        act(() => {
            root.render(
                <MediaCard
                    title='Resume me'
                    imageAspect='backdrop'
                    progressPercent={42}
                />
            );
        });

        const progress = container.querySelector('[role="progressbar"]');
        expect(progress).not.toBeNull();
        expect(progress?.getAttribute('aria-valuenow')).toBe('42');
    });

    it('does not render a progressbar when progressPercent is absent', () => {
        act(() => {
            root.render(<MediaCard title='No progress' imageAspect='square' />);
        });

        expect(container.querySelector('[role="progressbar"]')).toBeNull();
    });

    it.each([
        ['poster', 'rf-media-card--poster'],
        ['backdrop', 'rf-media-card--backdrop'],
        ['square', 'rf-media-card--square']
    ] as const)(
        'applies the %s aspect variant class',
        (aspect, expectedClass) => {
            act(() => {
                root.render(
                    <MediaCard title='Aspect test' imageAspect={aspect} />
                );
            });

            const card = container.querySelector('[data-rf-slot="media-card"]');
            expect(card?.className).toContain(expectedClass);
        }
    );

    it('renders as a link when href is set', () => {
        act(() => {
            root.render(
                <MediaCard
                    title='Linked'
                    imageAspect='poster'
                    href='/items/1'
                />
            );
        });

        const anchor = container.querySelector('a[data-rf-slot="media-card"]');
        expect(anchor).not.toBeNull();
        expect(anchor?.getAttribute('href')).toBe('/items/1');
    });

    it('renders as a button and fires onClick when only onClick is set', () => {
        let clicked = false;
        act(() => {
            root.render(
                <MediaCard
                    title='Clickable'
                    imageAspect='poster'
                    onClick={() => {
                        clicked = true;
                    }}
                />
            );
        });

        const button = container.querySelector(
            'button[data-rf-slot="media-card"]'
        ) as HTMLButtonElement;
        expect(button).not.toBeNull();

        act(() => {
            button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(clicked).toBe(true);
    });
});
