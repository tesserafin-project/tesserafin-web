import React from 'react';

import { ThemeStudio } from 'apps/modern/features/themeStudio/components/ThemeStudio';
import Page from 'components/Page';

/**
 * `/themestudio` — the Theme Studio's own route (RFC-0007).
 *
 * A route rather than a section of the Display preferences page: the Studio is a two-pane editor
 * with a sticky preview, and it needs the width. `DisplayPreferences.tsx` links here, which is the
 * reachability the brief asks for — "through the Display/Appearance area" — without cramming an
 * editor into a settings form.
 *
 * Lazily loaded like every other async route, so the token editor, the preview and the schema JSON
 * the validator imports all land in this route's chunk rather than in the main bundle.
 */
export default function ThemeStudioPage() {
    return (
        <Page
            className='libraryPage userPreferencesPage noSecondaryNavPage'
            id='themeStudioPage'
            title='Theme Studio'
        >
            <div className='settingsContainer padded-left padded-right padded-bottom-page'>
                <ThemeStudio />
            </div>
        </Page>
    );
}
