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

function param<T extends string>(name: string, fallback: T): T {
    return (params.get(name) as T | null) ?? fallback;
}

async function main() {
    const side = param('tokens', 'after');

    const [tokens, manifest] = await Promise.all([
        fetch(`/__tokens__/classic.${side}.json`).then(
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
            profile={param<PreviewProfile>('profile', 'pointer')}
            mode={param<'light' | 'dark'>('mode', 'dark')}
            reducedMotion={params.get('reducedMotion') === '1'}
            reducedTransparency={params.get('reducedTransparency') === '1'}
            surface={param<PreviewSurface>('surface', 'home')}
        />
    );

    // The spec waits on this rather than on a timeout: a screenshot taken before the tokens landed
    // would silently capture the wrong palette and still look plausible.
    document.documentElement.setAttribute('data-capture-ready', 'true');
}

void main();
