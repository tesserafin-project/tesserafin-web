// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PLATFORM_DEFAULT_PRESENTATION } from 'themes/platform';
import { PresentationProvider } from '../../presentation/PresentationContext';

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

describe('MediaCard — theme presentation (RFC-0007 §4.6)', () => {
    it('projects the active theme hover and title-placement choices', () => {
        act(() => {
            root.render(
                <PresentationProvider themeId='official.classic'>
                    <MediaCard title='T' imageAspect='poster' />
                </PresentationProvider>
            );
        });

        const card = container.querySelector('[data-rf-slot="media-card"]');
        // Tesserafin Classic declares hoverEffect: "lift", titlePlacement: "below".
        expect(card?.getAttribute('data-rf-hover')).toBe('lift');
        expect(card?.getAttribute('data-rf-title-placement')).toBe('below');
    });

    it('honours progressStyle: "none" by not rendering the progress bar at all', () => {
        act(() => {
            root.render(
                <PresentationProvider
                    value={{
                        presentation: {
                            ...PLATFORM_DEFAULT_PRESENTATION,
                            mediaCard: {
                                ...PLATFORM_DEFAULT_PRESENTATION.mediaCard,
                                progressStyle: 'none'
                            }
                        },
                        fallbacks: [],
                        activatable: true
                    }}
                >
                    <MediaCard
                        title='T'
                        imageAspect='poster'
                        progressPercent={40}
                    />
                </PresentationProvider>
            );
        });

        // Removed from the DOM, not merely hidden: a `role="progressbar"` that is invisible but
        // still announced would tell a screen-reader user about a control that is not there.
        expect(container.querySelector('[role="progressbar"]')).toBeNull();
    });

    it('still renders the progress bar under the default presentation', () => {
        act(() => {
            root.render(
                <MediaCard
                    title='T'
                    imageAspect='poster'
                    progressPercent={40}
                />
            );
        });
        expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
    });

    it('never lets a theme change imageAspect', () => {
        act(() => {
            root.render(
                <PresentationProvider
                    value={{
                        presentation: {
                            ...PLATFORM_DEFAULT_PRESENTATION,
                            mediaCard: {
                                ...PLATFORM_DEFAULT_PRESENTATION.mediaCard,
                                imageAspect: 'backdrop'
                            }
                        },
                        fallbacks: [],
                        activatable: true
                    }}
                >
                    <MediaCard title='T' imageAspect='poster' />
                </PresentationProvider>
            );
        });

        // `imageAspect` is a statement about the artwork this card holds, not a theme choice — a
        // theme that could override it would crop posters into backdrops.
        const card = container.querySelector('[data-rf-slot="media-card"]');
        expect(card?.className).toContain('rf-media-card--poster');
        expect(card?.className).not.toContain('rf-media-card--backdrop');
    });
});
