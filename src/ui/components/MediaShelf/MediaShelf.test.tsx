// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MediaCard } from '../MediaCard/MediaCard';
import { MediaShelf } from './MediaShelf';

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

describe('MediaShelf', () => {
    it('renders the title, slot attribute and MediaCard children', () => {
        act(() => {
            root.render(
                <MediaShelf title='Continue Watching' id='continue-watching'>
                    <MediaCard title='Item 1' imageAspect='backdrop' />
                    <MediaCard title='Item 2' imageAspect='backdrop' />
                </MediaShelf>
            );
        });

        const shelf = container.querySelector('[data-rf-slot="media-shelf"]');
        expect(shelf).not.toBeNull();
        expect(container.textContent).toContain('Continue Watching');
        expect(
            container.querySelectorAll('[data-rf-slot="media-card"]')
        ).toHaveLength(2);
    });

    it('renders a "view all" link only when both href and label are set', () => {
        act(() => {
            root.render(
                <MediaShelf
                    title='Movies'
                    viewAllHref='/library/movies'
                    viewAllLabel='View all'
                >
                    <MediaCard title='Item' imageAspect='poster' />
                </MediaShelf>
            );
        });

        const link = container.querySelector(
            '.rf-media-shelf__view-all'
        ) as HTMLAnchorElement;
        expect(link).not.toBeNull();
        expect(link.getAttribute('href')).toBe('/library/movies');
    });

    it('omits the "view all" link when only href is set', () => {
        act(() => {
            root.render(
                <MediaShelf title='Movies' viewAllHref='/library/movies'>
                    <MediaCard title='Item' imageAspect='poster' />
                </MediaShelf>
            );
        });

        expect(container.querySelector('.rf-media-shelf__view-all')).toBeNull();
    });
});
