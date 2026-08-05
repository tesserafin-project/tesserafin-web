import React, { type FC, useMemo } from 'react';

import type { ResolvedPresentation } from 'themes/platform';
import { MediaCard } from 'ui/components/MediaCard/MediaCard';
import { MediaGrid } from 'ui/components/MediaGrid/MediaGrid';
import { MediaShelf } from 'ui/components/MediaShelf/MediaShelf';
import { Surface } from 'ui/components/Surface/Surface';
import { Tabs } from 'ui/components/Tabs/Tabs';
import {
    getProfileAttribute,
    resolveTokensForProfiles
} from 'ui/tokens/profiles';
import { toCustomProperties } from 'ui/tokens/projectTokens';

import { toRenderedHomeSections } from 'apps/modern/features/home/utils/homeRecipe';

import type { ThemeDraft } from '../draftFormat';
import {
    PREVIEW_DETAIL,
    PREVIEW_HERO_ITEM,
    PREVIEW_HOME_SHELVES,
    PREVIEW_LIBRARY_ITEMS,
    PREVIEW_NAV_ITEMS
} from '../fixtures';

import './PreviewCanvas.scss';

export type PreviewProfile = 'pointer' | 'touch' | 'remote';
export type PreviewSurface = 'home' | 'library' | 'itemDetails';

export interface PreviewCanvasProps {
    draft: ThemeDraft;
    presentation: ResolvedPresentation;
    profile: PreviewProfile;
    mode: 'light' | 'dark';
    reducedMotion: boolean;
    reducedTransparency: boolean;
    surface: PreviewSurface;
}

/** Viewport widths the three interaction profiles are previewed at. */
const PROFILE_WIDTH: Record<PreviewProfile, string> = {
    pointer: '100%',
    touch: '390px',
    remote: '100%'
};

/**
 * Renders the synthetic fixtures under a draft's tokens.
 *
 * ## How the preview is actually themed
 *
 * The draft's tokens are projected to `--rf-*` custom properties and written as **inline styles on
 * this container**, not on `<html>`. Custom properties inherit, so every `src/ui` primitive inside
 * resolves its `var(--rf-*)` against the draft while the surrounding Studio chrome keeps the app's
 * real theme. That is what makes the preview live and side-effect-free at the same time: nothing
 * outside this element changes, and no Apply has happened.
 *
 * Profile and mode resolution goes through `ui/tokens/profiles.ts` — the same cascade the running
 * app uses — rather than a preview-only approximation. A preview that resolved profiles its own way
 * would be a picture of a theme that does not exist.
 *
 * The primitives are the real `MediaCard`, `MediaShelf`, `MediaGrid`, `Surface` and `Tabs`, not
 * look-alikes. A mock preview would be exactly the "decorative fake" this feature is required not
 * to be: it would drift from the app and would keep looking right after the app stopped matching.
 */
export const PreviewCanvas: FC<PreviewCanvasProps> = ({
    draft,
    presentation,
    profile,
    mode,
    reducedMotion,
    reducedTransparency,
    surface
}) => {
    const activeProfiles = useMemo(
        () => ({
            remote: profile === 'remote',
            reducedTransparency,
            reducedMotion,
            lowPower: false
        }),
        [profile, reducedTransparency, reducedMotion]
    );

    const style = useMemo(() => {
        const resolved = resolveTokensForProfiles(draft.tokens, activeProfiles);
        return toCustomProperties(resolved, mode) as React.CSSProperties;
    }, [draft.tokens, activeProfiles, mode]);

    /*
     * The recipe's own density, not a two-value approximation of it: `MediaShelf` speaks the full
     * `compact | comfortable | spacious` vocabulary, and clamping `spacious` here would have made
     * the Studio's density control look inert in its own preview.
     *
     * `MediaGrid` (the library surface) still has only two densities, so `spacious` maps to
     * `comfortable` there — the library recipe is not bound yet, and widening a second primitive is
     * not this change's business.
     */
    const density = presentation.page.home.shelfDensity;
    const gridDensity = density === 'compact' ? 'compact' : 'comfortable';

    // The SAME function the live Home route calls, deliberately. A preview that ordered sections
    // its own way would be a picture of a Home that does not exist.
    const homeSections = toRenderedHomeSections(
        presentation.page.home.sections
    );

    return (
        <div
            className={`rf-studio-preview rf-studio-preview--${profile}`}
            style={{ ...style, maxWidth: PROFILE_WIDTH[profile] }}
            data-rf-theme={draft.basedOn.id}
            data-rf-mode={mode}
            data-rf-profile={getProfileAttribute(activeProfiles)}
            data-rf-reduced-motion={reducedMotion ? 'true' : undefined}
            data-testid='theme-studio-preview'
        >
            <nav
                className={`rf-studio-preview__nav rf-studio-preview__nav--${presentation.navigation.shell}`}
                aria-label='Preview navigation'
            >
                {PREVIEW_NAV_ITEMS.map((navItem, index) => (
                    <span
                        key={navItem.id}
                        className='rf-studio-preview__nav-item'
                        data-active={index === 0 ? 'true' : undefined}
                    >
                        {presentation.navigation.labels === 'never'
                            ? navItem.label.charAt(0)
                            : navItem.label}
                    </span>
                ))}
            </nav>

            <div className='rf-studio-preview__body'>
                {surface === 'home' && (
                    <div data-testid='theme-studio-preview-home'>
                        {homeSections.map((section) => {
                            if (section === 'hero') {
                                return (
                                    <div
                                        key='hero'
                                        className='rf-studio-preview__home-hero'
                                        data-rf-preview-section='hero'
                                    >
                                        <span className='rf-studio-preview__title'>
                                            {PREVIEW_HERO_ITEM.title}
                                        </span>
                                        <span className='rf-studio-preview__tagline'>
                                            {PREVIEW_HERO_ITEM.subtitle}
                                        </span>
                                    </div>
                                );
                            }

                            const shelf = PREVIEW_HOME_SHELVES[section];
                            return (
                                <div
                                    key={section}
                                    data-rf-preview-section={section}
                                >
                                    <MediaShelf
                                        title={shelf.title}
                                        density={density}
                                    >
                                        {shelf.items.map((item) => (
                                            <MediaCard
                                                key={item.id}
                                                title={item.title}
                                                subtitle={item.subtitle}
                                                imageAspect={
                                                    presentation.mediaCard
                                                        .imageAspect
                                                }
                                                progressPercent={
                                                    presentation.mediaCard
                                                        .progressStyle === 'bar'
                                                        ? item.progressPercent
                                                        : undefined
                                                }
                                                placeholderIcon={
                                                    <span aria-hidden='true'>
                                                        {item.title.charAt(0)}
                                                    </span>
                                                }
                                            />
                                        ))}
                                    </MediaShelf>
                                </div>
                            );
                        })}
                    </div>
                )}

                {surface === 'library' && (
                    <>
                        <Tabs
                            items={[
                                { id: 'browse', label: 'Browse' },
                                { id: 'collections', label: 'Collections' },
                                { id: 'genres', label: 'Genres' }
                            ]}
                            value={0}
                            onChange={noop}
                            variant={
                                presentation.surface.variant === 'glass'
                                    ? 'pills'
                                    : 'underline'
                            }
                            aria-label='Preview library sections'
                        />
                        <MediaGrid
                            density={gridDensity}
                            aria-label='Preview library items'
                        >
                            {PREVIEW_LIBRARY_ITEMS.map((item) => (
                                <MediaCard
                                    key={item.id}
                                    title={item.title}
                                    subtitle={item.subtitle}
                                    imageAspect={
                                        presentation.page.library.cardAspect
                                    }
                                    placeholderIcon={
                                        <span aria-hidden='true'>
                                            {item.title.charAt(0)}
                                        </span>
                                    }
                                />
                            ))}
                        </MediaGrid>
                    </>
                )}

                {surface === 'itemDetails' && (
                    <div className='rf-studio-preview__detail'>
                        <Surface
                            variant={presentation.surface.variant}
                            className='rf-studio-preview__hero'
                        >
                            <h2 className='rf-studio-preview__title'>
                                {PREVIEW_DETAIL.title}
                            </h2>
                            <p className='rf-studio-preview__tagline'>
                                {PREVIEW_DETAIL.tagline}
                            </p>
                            <p className='rf-studio-preview__overview'>
                                {PREVIEW_DETAIL.overview}
                            </p>
                        </Surface>
                        <Surface
                            variant={presentation.surface.variant}
                            className='rf-studio-preview__facts'
                        >
                            <dl>
                                {PREVIEW_DETAIL.facts.map((fact) => (
                                    <div
                                        key={fact.label}
                                        className='rf-studio-preview__fact'
                                    >
                                        <dt>{fact.label}</dt>
                                        <dd>{fact.value}</dd>
                                    </div>
                                ))}
                            </dl>
                        </Surface>
                    </div>
                )}
            </div>
        </div>
    );
};

/** The preview's tab strip is a still life, not a control — the surface selector above drives it. */
function noop() {
    /* intentionally empty */
}

export default PreviewCanvas;
