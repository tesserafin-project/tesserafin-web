// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    PLATFORM_DEFAULT_PRESENTATION,
    getManifestForThemeId
} from 'themes/platform';

import {
    PresentationProvider,
    usePresentationContext
} from './PresentationContext';

let container: HTMLDivElement;
let root: Root;

/** Renders whatever the context currently holds, as JSON, so a test can read it back. */
function Probe() {
    const value = usePresentationContext();
    return <output data-testid='probe'>{JSON.stringify(value)}</output>;
}

function read(): {
    presentation: typeof PLATFORM_DEFAULT_PRESENTATION;
    fallbacks: { capability: string }[];
    activatable: boolean;
} {
    const text = container.querySelector('[data-testid="probe"]')?.textContent;
    if (!text) throw new Error('probe did not render');
    return JSON.parse(text);
}

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

describe('PresentationProvider', () => {
    it('gives the platform default with no provider at all', () => {
        act(() => {
            root.render(<Probe />);
        });
        // A primitive must render correctly outside the app tree — a unit test, a legacy view —
        // without branching on whether it is inside a provider.
        expect(read().presentation).toEqual(PLATFORM_DEFAULT_PRESENTATION);
        expect(read().activatable).toBe(true);
    });

    it('resolves the shipped manifest for an official theme', () => {
        act(() => {
            root.render(
                <PresentationProvider themeId='official.classic'>
                    <Probe />
                </PresentationProvider>
            );
        });
        const manifest = getManifestForThemeId('official.classic');
        expect(read().presentation.surface.variant).toBe(
            manifest?.presentation?.surface?.variant
        );
        expect(read().presentation.surface.variant).toBe('opaque');
    });

    it('gives a .light entry its parent theme presentation', () => {
        act(() => {
            root.render(
                <PresentationProvider themeId='official.glass.light'>
                    <Probe />
                </PresentationProvider>
            );
        });
        // `official.glass.light` is a second registry entry for the SAME theme — it renders Glass's
        // tokens, so it must render Glass's presentation too.
        expect(read().presentation.surface.variant).toBe('glass');
    });

    it('gives a legacy colour preset the platform default', () => {
        act(() => {
            root.render(
                <PresentationProvider themeId='blueradiance'>
                    <Probe />
                </PresentationProvider>
            );
        });
        // A legacy preset declares no presentation, and the honest answer to "what does it declare"
        // is the platform default rather than an invented manifest.
        expect(read().presentation).toEqual(PLATFORM_DEFAULT_PRESENTATION);
    });

    it('gives an unknown theme id the platform default', () => {
        act(() => {
            root.render(
                <PresentationProvider themeId='not.a-theme'>
                    <Probe />
                </PresentationProvider>
            );
        });
        expect(read().presentation).toEqual(PLATFORM_DEFAULT_PRESENTATION);
    });

    it('refuses to half-apply a theme requiring an unimplemented capability', () => {
        act(() => {
            root.render(
                <PresentationProvider
                    value={{
                        presentation: PLATFORM_DEFAULT_PRESENTATION,
                        fallbacks: [],
                        activatable: false
                    }}
                >
                    <Probe />
                </PresentationProvider>
            );
        });
        expect(read().activatable).toBe(false);
        expect(read().presentation).toEqual(PLATFORM_DEFAULT_PRESENTATION);
    });
});

describe('getManifestForThemeId', () => {
    it.each([
        ['official.classic', 'official.classic'],
        ['official.glass', 'official.glass'],
        ['official.glass.light', 'official.glass']
    ])('maps %s to the %s manifest', (themeId, manifestId) => {
        expect(getManifestForThemeId(themeId)?.id).toBe(manifestId);
    });

    it.each(['dark', 'light', 'appletv', 'blueradiance', 'purplehaze', 'wmc'])(
        'has no manifest for the legacy preset %s',
        (themeId) => {
            expect(getManifestForThemeId(themeId)).toBeUndefined();
        }
    );
});

describe('an applied Theme Studio draft', () => {
    const KEY = 'tesserafin.themeStudio.appliedPresentation';

    afterEach(() => {
        window.localStorage.removeItem(KEY);
    });

    it('wins over the official theme presentation', () => {
        window.localStorage.setItem(
            KEY,
            JSON.stringify({ surface: { variant: 'glass' } })
        );
        act(() => {
            root.render(
                <PresentationProvider themeId='official.classic'>
                    <Probe />
                </PresentationProvider>
            );
        });
        // Classic declares "opaque"; the applied draft asked for "glass". Applying a draft has to
        // change the presentation, or the Studio's controls would be preview-only.
        expect(read().presentation.surface.variant).toBe('glass');
    });

    it('still fills unstated keys from the platform default', () => {
        window.localStorage.setItem(
            KEY,
            JSON.stringify({ surface: { variant: 'glass' } })
        );
        act(() => {
            root.render(
                <PresentationProvider themeId='official.classic'>
                    <Probe />
                </PresentationProvider>
            );
        });
        expect(read().presentation.mediaCard).toEqual(
            PLATFORM_DEFAULT_PRESENTATION.mediaCard
        );
    });

    it('is ignored when the stored record is not a plain object', () => {
        for (const bad of ['[]', '"x"', 'null', '{ not json']) {
            window.localStorage.setItem(KEY, bad);
            act(() => {
                root.render(
                    <PresentationProvider themeId='official.classic'>
                        <Probe />
                    </PresentationProvider>
                );
            });
            // Hand-edited or truncated storage must degrade to the theme's own presentation, never
            // throw on boot.
            expect(read().presentation.surface.variant).toBe('opaque');
        }
    });
});
