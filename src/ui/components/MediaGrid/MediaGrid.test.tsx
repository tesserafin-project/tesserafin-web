// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MediaCard } from '../MediaCard/MediaCard';
import { MediaGrid } from './MediaGrid';

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

describe('MediaGrid', () => {
    it('renders the slot attribute and MediaCard children', () => {
        act(() => {
            root.render(
                <MediaGrid aria-label='Movies'>
                    <MediaCard title='Item 1' imageAspect='poster' />
                    <MediaCard title='Item 2' imageAspect='poster' />
                </MediaGrid>
            );
        });

        const grid = container.querySelector('[data-rf-slot="media-grid"]');
        expect(grid).not.toBeNull();
        expect(
            container.querySelectorAll('[data-rf-slot="media-card"]')
        ).toHaveLength(2);
    });

    it('exposes the aria-label on the group role', () => {
        act(() => {
            root.render(
                <MediaGrid aria-label='Movies'>
                    <MediaCard title='Item' imageAspect='poster' />
                </MediaGrid>
            );
        });

        const grid = container.querySelector('[data-rf-slot="media-grid"]');
        expect(grid?.getAttribute('role')).toBe('group');
        expect(grid?.getAttribute('aria-label')).toBe('Movies');
    });

    it('defaults to comfortable density', () => {
        act(() => {
            root.render(
                <MediaGrid>
                    <MediaCard title='Item' imageAspect='poster' />
                </MediaGrid>
            );
        });

        const grid = container.querySelector('[data-rf-slot="media-grid"]');
        expect(grid?.className).toContain('rf-media-grid--comfortable');
    });

    it('applies the compact density class', () => {
        act(() => {
            root.render(
                <MediaGrid density='compact'>
                    <MediaCard title='Item' imageAspect='poster' />
                </MediaGrid>
            );
        });

        const grid = container.querySelector('[data-rf-slot="media-grid"]');
        expect(grid?.className).toContain('rf-media-grid--compact');
    });

    it('sets the min-item-width custom property when minItemWidth is provided', () => {
        act(() => {
            root.render(
                <MediaGrid minItemWidth='220px'>
                    <MediaCard title='Item' imageAspect='backdrop' />
                </MediaGrid>
            );
        });

        const grid = container.querySelector(
            '[data-rf-slot="media-grid"]'
        ) as HTMLElement;
        expect(
            grid.style.getPropertyValue('--rf-media-grid-min-item-width')
        ).toBe('220px');
    });

    it('does not set the min-item-width custom property when minItemWidth is absent', () => {
        act(() => {
            root.render(
                <MediaGrid>
                    <MediaCard title='Item' imageAspect='poster' />
                </MediaGrid>
            );
        });

        const grid = container.querySelector(
            '[data-rf-slot="media-grid"]'
        ) as HTMLElement;
        expect(
            grid.style.getPropertyValue('--rf-media-grid-min-item-width')
        ).toBe('');
    });
});
