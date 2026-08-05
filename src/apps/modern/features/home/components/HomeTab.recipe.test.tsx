// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Home page-composition vertical, asserted on the REAL route component.
 *
 * These are the gates that make `presentation.page.home` a binding rather than a schema entry:
 *
 *  - the platform default reproduces the composition Home had before the binding;
 *  - Classic and Glass — two real, shipped manifests — produce materially different compositions,
 *    through the real resolver, with no component knowing either theme's id;
 *  - **the set of API queries Home issues is identical under every recipe**, including one that
 *    omits a section. That is the load-bearing one: it is what makes "composition" a presentation
 *    concern rather than a covert way for a theme to change data access (RFC-0007 §6.1);
 *  - an applied Theme Studio draft changes the live composition, survives a reload, and is undone
 *    by reset;
 *  - a malformed `localStorage` record cannot stop the page rendering.
 *
 * The server is stubbed at the SDK boundary, not the network, so these are render/behaviour tests
 * and not end-to-end proof — the browser flow against a real Tesserafin server is the separate
 * acceptance evidence. Stubbing at the SDK boundary is what lets the query-invariance assertion
 * observe every request the page would have made.
 */

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.stubGlobal('__WEBPACK_SERVE__', false);

// Identity translation that keeps the arguments, so the four "Latest from <library>" shelves stay
// distinguishable from one another in the rendered heading order.
vi.mock('lib/globalize', () => ({
    default: {
        translate: (key: string, ...args: string[]) =>
            [key, ...args].join(' ').trim()
    },
    translate: (key: string, ...args: string[]) =>
        [key, ...args].join(' ').trim()
}));

/** Every SDK call the page makes, in the order the query client ran it. */
const apiCalls: string[] = [];

const USER_VIEWS = [
    { Id: 'lib-movies', Name: 'Movies', CollectionType: 'movies' },
    { Id: 'lib-shows', Name: 'Shows', CollectionType: 'tvshows' }
];

const RESUME_ITEMS = [
    { Id: 'resume-1', Name: 'The Quiet Harbour', SeriesName: 'Harbour' }
];

const NEXT_UP_ITEMS = [{ Id: 'next-1', Name: 'Northern Lights' }];

const LATEST_ITEMS = [{ Id: 'latest-1', Name: 'Salt and Stone' }];

vi.mock('lib/tesserafin-sdk', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        getUserViewApi: () => ({
            getUserViews: () => {
                apiCalls.push('getUserViews');
                return Promise.resolve({ data: { Items: USER_VIEWS } });
            }
        }),
        getLibraryApi: () => ({
            getResumeItems: () => {
                apiCalls.push('getResumeItems');
                return Promise.resolve({ data: { Items: RESUME_ITEMS } });
            },
            getLatestMedia: (params: { parentId?: string }) => {
                apiCalls.push(`getLatestMedia:${params.parentId}`);
                return Promise.resolve({ data: LATEST_ITEMS });
            }
        }),
        getShowApi: () => ({
            getNextUp: () => {
                apiCalls.push('getNextUp');
                return Promise.resolve({ data: { Items: NEXT_UP_ITEMS } });
            }
        })
    };
});

const legacyApiClient = {
    getImageUrl: (itemId: string) => `/image/${itemId}`,
    serverId: () => 'server-1'
};

vi.mock('hooks/useApi', () => ({
    useApi: () => ({
        reefinApi: { axiosInstance: {} },
        user: { Id: 'user-1' },
        __legacyApiClient__: legacyApiClient
    })
}));

// Imported after the mocks so the module graph resolves against them.
const { default: HomeTab } = await import('./HomeTab');
const { PresentationProvider } = await import(
    'ui/presentation/PresentationContext'
);
const { PLATFORM_DEFAULT_PRESENTATION } = await import(
    'themes/platform/resolvePresentation'
);
const { saveAppliedPresentation, clearAppliedPresentation } = await import(
    'themes/platform/localPresentation'
);

let container: HTMLDivElement;
let root: Root;

function makeClient() {
    return new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } }
    });
}

async function render(children: ReactNode) {
    const client = makeClient();
    await act(async () => {
        root.render(
            <QueryClientProvider client={client}>
                {children}
            </QueryClientProvider>
        );
    });
    /*
     * Macrotask ticks, repeated. Two separate reasons, and both were observed:
     *
     *   - React Query batches its own subscriber notifications through a scheduler, so a bare
     *     microtask flush recorded the request but left every section rendering its loading state;
     *   - the per-library "Latest from …" queries cannot even be created until `useUserViews` has
     *     resolved AND its views have rendered, so one settled wave leaves the next one pending.
     */
    for (let pass = 0; pass < 8; pass++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    }
}

/** The rendered section order, read off the headings each section publishes. */
function headings(): string[] {
    return [...container.querySelectorAll('h2')].map((heading) =>
        (heading.textContent ?? '').trim()
    );
}

beforeEach(() => {
    apiCalls.length = 0;
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
});

/** The composition Home rendered before `presentation.page.home` was bound. */
const PRE_BINDING_ORDER = [
    'HeaderMyMedia',
    'HeaderContinueWatching',
    'NextUp',
    'LatestFromLibrary Movies',
    'LatestFromLibrary Shows'
];

describe('Home composition — the platform default', () => {
    it('reproduces the composition Home had before the binding', async () => {
        await render(<HomeTab />);
        expect(headings()).toEqual(PRE_BINDING_ORDER);
    });

    it('is what the platform default recipe says, so the two cannot drift', async () => {
        expect(PLATFORM_DEFAULT_PRESENTATION.page.home.sections).toEqual([
            'libraries',
            'continueWatching',
            'nextUp',
            'latestMedia'
        ]);
    });

    it('publishes the composition root as a durable slot', async () => {
        await render(<HomeTab />);
        expect(
            container.querySelector('[data-rf-slot="home-composition"]')
        ).not.toBeNull();
    });
});

describe('Home composition — two shipped themes, two compositions', () => {
    it('renders Classic in the default order, with no hero', async () => {
        await render(
            <PresentationProvider themeId='official.classic'>
                <HomeTab />
            </PresentationProvider>
        );
        expect(headings()).toEqual(PRE_BINDING_ORDER);
        expect(
            container.querySelector('[data-rf-slot="home-hero"]')
        ).toBeNull();
    });

    it('renders Glass hero-first, with libraries last', async () => {
        await render(
            <PresentationProvider themeId='official.glass'>
                <HomeTab />
            </PresentationProvider>
        );
        expect(headings()).toEqual([
            'The Quiet Harbour',
            'HeaderContinueWatching',
            'NextUp',
            'LatestFromLibrary Movies',
            'LatestFromLibrary Shows',
            'HeaderMyMedia'
        ]);
        expect(
            container.querySelector('[data-rf-slot="home-hero"]')
        ).not.toBeNull();
    });

    it('gives Glass its declared shelf density, through the real resolver', async () => {
        await render(
            <PresentationProvider themeId='official.glass'>
                <HomeTab />
            </PresentationProvider>
        );
        expect(
            container.querySelector('.rf-media-shelf__scroller--spacious')
        ).not.toBeNull();
        expect(
            container.querySelector('.rf-media-shelf__scroller--comfortable')
        ).toBeNull();
    });

    // "No component names a theme id" is asserted over the source of the whole Home vertical by
    // `tests/boundary/presentationBoundary.ratchet.test.ts`, which reads files from disk. It
    // lives there rather than here because it is a source-level gate, not a render-level one, and
    // because that file is where the rest of the boundary ratchet already lives.
});

describe('Home composition — a recipe cannot change data access', () => {
    /**
     * The gate. Three materially different compositions, including one that OMITS a section
     * entirely, must all issue exactly the same requests. If a recipe could suppress a fetch,
     * "hide this section" would be a theme deciding what the client asks the server for.
     */
    const recipes = [
        {
            name: 'platform default',
            presentation: undefined
        },
        {
            name: 'hero first, libraries last',
            presentation: {
                page: {
                    home: {
                        sections: [
                            'hero',
                            'continueWatching',
                            'nextUp',
                            'latestMedia',
                            'libraries'
                        ] as const
                    }
                }
            }
        },
        {
            name: 'continue watching only — every other section omitted',
            presentation: {
                page: { home: { sections: ['continueWatching'] as const } }
            }
        }
    ];

    it.each(recipes)(
        'issues the same requests under "$name"',
        async ({ presentation }) => {
            if (presentation) saveAppliedPresentation(presentation);
            await render(
                <PresentationProvider themeId='official.classic'>
                    <HomeTab />
                </PresentationProvider>
            );

            expect([...apiCalls].sort()).toEqual([
                'getLatestMedia:lib-movies',
                'getLatestMedia:lib-shows',
                'getNextUp',
                'getResumeItems',
                'getUserViews'
            ]);
        }
    );

    it('renders only the section the recipe kept', async () => {
        saveAppliedPresentation({
            page: { home: { sections: ['continueWatching'] } }
        });
        await render(
            <PresentationProvider themeId='official.classic'>
                <HomeTab />
            </PresentationProvider>
        );
        expect(headings()).toEqual(['HeaderContinueWatching']);
    });
});

describe('Home composition — apply, reload, reset', () => {
    const applied = {
        page: {
            home: {
                sections: ['nextUp', 'libraries'] as const,
                shelfDensity: 'compact' as const
            }
        }
    };

    it('changes the live composition as soon as a draft is applied', async () => {
        await render(
            <PresentationProvider themeId='official.classic'>
                <HomeTab />
            </PresentationProvider>
        );
        expect(headings()).toEqual(PRE_BINDING_ORDER);

        // What `applyLocalThemeOverlay` does on Apply. No reload, no remount.
        await act(async () => {
            saveAppliedPresentation(applied);
        });

        expect(headings()).toEqual(['NextUp', 'HeaderMyMedia']);
    });

    it('survives a reload, because the record is read at mount too', async () => {
        saveAppliedPresentation(applied);
        await render(
            <PresentationProvider themeId='official.classic'>
                <HomeTab />
            </PresentationProvider>
        );
        expect(headings()).toEqual(['NextUp', 'HeaderMyMedia']);
        expect(
            container.querySelector('.rf-media-shelf__scroller--compact')
        ).not.toBeNull();
    });

    it('restores the official composition on reset', async () => {
        saveAppliedPresentation(applied);
        await render(
            <PresentationProvider themeId='official.classic'>
                <HomeTab />
            </PresentationProvider>
        );
        expect(headings()).toEqual(['NextUp', 'HeaderMyMedia']);

        await act(async () => {
            clearAppliedPresentation();
        });

        expect(headings()).toEqual(PRE_BINDING_ORDER);
    });
});

describe('Home composition — a corrupted record cannot stop the page', () => {
    const KEY = 'tesserafin.themeStudio.appliedPresentation';

    it.each([
        ['not JSON at all', '{{{'],
        ['a JSON array', '[]'],
        [
            'sections as a string',
            '{"page":{"home":{"sections":"latestMedia"}}}'
        ],
        [
            'sections full of names this build does not know',
            '{"page":{"home":{"sections":["notASection","alsoNot"]}}}'
        ],
        ['an empty sections array', '{"page":{"home":{"sections":[]}}}'],
        [
            'a nonsense shelf density',
            '{"page":{"home":{"shelfDensity":"enormous"}}}'
        ]
    ])('boots and falls back with %s', async (_name, raw) => {
        localStorage.setItem(KEY, raw);
        await render(
            <PresentationProvider themeId='official.classic'>
                <HomeTab />
            </PresentationProvider>
        );
        expect(headings()).toEqual(PRE_BINDING_ORDER);
    });

    it('keeps the good half of a half-corrupt record', async () => {
        // Deliberate: one bad key must not cost the other. `sections` survives, the impossible
        // density falls back.
        localStorage.setItem(
            KEY,
            '{"page":{"home":{"sections":["nextUp"],"shelfDensity":"enormous"}}}'
        );
        await render(
            <PresentationProvider themeId='official.classic'>
                <HomeTab />
            </PresentationProvider>
        );
        expect(headings()).toEqual(['NextUp']);
        expect(
            container.querySelector('.rf-media-shelf__scroller--comfortable')
        ).not.toBeNull();
    });

    it('drops a duplicated section rather than rendering it twice', async () => {
        localStorage.setItem(
            KEY,
            '{"page":{"home":{"sections":["nextUp","nextUp","libraries"]}}}'
        );
        await render(
            <PresentationProvider themeId='official.classic'>
                <HomeTab />
            </PresentationProvider>
        );
        expect(headings()).toEqual(['NextUp', 'HeaderMyMedia']);
    });
});

describe('Home composition — a section the Web renderer does not draw', () => {
    it('falls back to the default order rather than rendering a blank page', async () => {
        // `recommendations` is valid universal vocabulary and renders nothing here. A recipe made
        // only of it is schema-valid, and honouring it literally would produce an empty Home.
        saveAppliedPresentation({
            page: { home: { sections: ['recommendations'] } }
        });
        await render(
            <PresentationProvider themeId='official.classic'>
                <HomeTab />
            </PresentationProvider>
        );
        expect(headings()).toEqual(PRE_BINDING_ORDER);
    });

    it('renders the sections it does draw and silently skips the one it does not', async () => {
        saveAppliedPresentation({
            page: { home: { sections: ['recommendations', 'nextUp'] } }
        });
        await render(
            <PresentationProvider themeId='official.classic'>
                <HomeTab />
            </PresentationProvider>
        );
        expect(headings()).toEqual(['NextUp']);
    });
});
