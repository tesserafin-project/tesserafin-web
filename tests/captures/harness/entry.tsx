/**
 * Capture harness entry.
 *
 * Mounts the REAL `PreviewCanvas` — and through it the real `MediaCard`, `MediaShelf`, `MediaGrid`,
 * `Surface` and `Tabs` — under a token set fetched at runtime. Nothing here re-implements or
 * approximates a screen: a harness that drew its own markup would produce screenshots of the
 * harness, which is exactly the manufactured evidence this work must not create.
 *
 * Runtime-fetched tokens rather than bundled ones, so `before` and `after` come from the same
 * bundle. If each side needed its own build, the two captures would differ by build as well as by
 * palette, and the comparison would prove nothing.
 *
 * Configuration is entirely in the URL, so one spec drives every combination:
 *
 *   ?tokens=before|after &surface=home|library|itemDetails &profile=pointer|touch|remote
 *   &mode=dark|light &reducedMotion=1 &reducedTransparency=1
 */
import React from 'react';
import { createRoot } from 'react-dom/client';

import {
    PreviewCanvas,
    type PreviewProfile,
    type PreviewSurface
} from 'apps/modern/features/themeStudio/components/PreviewCanvas';
import type { ThemeDraft } from 'apps/modern/features/themeStudio/draftFormat';
import { resolvePresentation, type ThemeManifest } from 'themes/platform';
import type { TesserafinTokens } from 'ui/tokens/types';

import 'styles/focus-visible.scss';
import './harness.scss';

const params = new URLSearchParams(window.location.search);

/**
 * Reads a URL parameter, accepting ONLY a value from `allowed`.
 *
 * Every knob here comes from the query string, and CodeQL was right to flag the first version:
 * the token side was interpolated straight into a fetch path, so any string in the URL became part
 * of a request URL — client-side request forgery, even in a test harness served from a throwaway
 * static server.
 *
 * Validating against a closed list rather than escaping the value is the fix that generalises: an
 * unrecognised value cannot reach the URL at all, and adding a new option means adding it to the
 * list rather than remembering to sanitise a new call site.
 */
function param<T extends string>(
    name: string,
    allowed: readonly T[],
    fallback: T
): T {
    const raw = params.get(name);
    return allowed.find((candidate) => candidate === raw) ?? fallback;
}

/** The two token sets `prepare-tokens.mjs` writes. Nothing else is fetchable. */
const TOKEN_SIDES = ['before', 'after'] as const;
const PROFILES = ['pointer', 'touch', 'remote'] as const;
const SURFACES = ['home', 'library', 'itemDetails'] as const;
const MODES = ['dark', 'light'] as const;

/** The fetch URLs, chosen by lookup rather than built by interpolation. */
const TOKEN_URLS: Record<(typeof TOKEN_SIDES)[number], string> = {
    before: '/__tokens__/classic.before.json',
    after: '/__tokens__/classic.after.json'
};

async function main() {
    const side = param('tokens', TOKEN_SIDES, 'after');

    const [tokens, manifest] = await Promise.all([
        fetch(TOKEN_URLS[side]).then(
            (response) => response.json() as Promise<TesserafinTokens>
        ),
        fetch('/__tokens__/classic.manifest.json').then(
            (response) => response.json() as Promise<ThemeManifest>
        )
    ]);

    const draft: ThemeDraft = {
        formatVersion: 1,
        kind: 'tesserafin-theme-draft',
        basedOn: {
            id: manifest.id,
            version: manifest.version,
            name: manifest.name
        },
        manifest,
        tokens
    };

    const resolution = resolvePresentation(manifest);

    const container = document.getElementById('root');
    if (!container) throw new Error('missing #root');

    createRoot(container).render(
        <PreviewCanvas
            draft={draft}
            presentation={resolution.presentation}
            profile={param<PreviewProfile>('profile', PROFILES, 'pointer')}
            mode={param('mode', MODES, 'dark')}
            reducedMotion={params.get('reducedMotion') === '1'}
            reducedTransparency={params.get('reducedTransparency') === '1'}
            surface={param<PreviewSurface>('surface', SURFACES, 'home')}
        />
    );

    // The spec waits on this rather than on a timeout: a screenshot taken before the tokens landed
    // would silently capture the wrong palette and still look plausible.
    document.documentElement.setAttribute('data-capture-ready', 'true');
}

void main();
