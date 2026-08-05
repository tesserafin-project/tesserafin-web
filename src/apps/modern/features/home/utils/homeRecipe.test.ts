import { describe, expect, it } from 'vitest';

import { HOME_SECTIONS } from 'themes/platform/contract';
import { PLATFORM_DEFAULT_PRESENTATION } from 'themes/platform/resolvePresentation';

import {
    toRenderedHomeSections,
    WEB_RENDERED_HOME_SECTIONS,
    WEB_UNRENDERED_HOME_SECTIONS
} from './homeRecipe';

describe('toRenderedHomeSections', () => {
    it('keeps the recipe order exactly', () => {
        expect(
            toRenderedHomeSections([
                'nextUp',
                'hero',
                'libraries',
                'continueWatching'
            ])
        ).toEqual(['nextUp', 'hero', 'libraries', 'continueWatching']);
    });

    it('drops a section this renderer draws nothing for', () => {
        expect(toRenderedHomeSections(['recommendations', 'nextUp'])).toEqual([
            'nextUp'
        ]);
    });

    it('falls back to the default order when nothing in the recipe is renderable', () => {
        // A recipe of `['recommendations']` alone is schema-valid. Honouring it literally would
        // produce a blank Home — a composition nobody designed, which is exactly what the
        // capability fallback path exists to prevent.
        expect(toRenderedHomeSections(['recommendations'])).toEqual([
            'libraries',
            'continueWatching',
            'nextUp',
            'latestMedia'
        ]);
    });

    it('falls back to the default order for an empty recipe', () => {
        expect(toRenderedHomeSections([])).toEqual(
            PLATFORM_DEFAULT_PRESENTATION.page.home.sections
        );
    });
});

describe('the renderer/contract split is stated exactly once', () => {
    it('accounts for every contract section as rendered or not rendered', () => {
        // A section added to the universal vocabulary and to neither list here would be invisible:
        // the Home route would silently drop it and the Theme Studio would silently not offer it,
        // with nothing failing anywhere. This forces the choice to be made.
        expect(
            [
                ...WEB_RENDERED_HOME_SECTIONS,
                ...WEB_UNRENDERED_HOME_SECTIONS
            ].sort()
        ).toEqual([...HOME_SECTIONS].sort());
    });

    it('renders every section the platform default names', () => {
        // Otherwise the default recipe would itself lose a section — the fallback would be broken
        // in the one case that must always work.
        for (const section of PLATFORM_DEFAULT_PRESENTATION.page.home
            .sections) {
            expect(WEB_RENDERED_HOME_SECTIONS).toContain(section);
        }
    });
});
