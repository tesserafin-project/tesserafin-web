import React, { type FC } from 'react';

import Page from 'components/Page';
import globalize from 'lib/globalize';

import ContentPackMosaic from '../../features/contentPacks/components/ContentPackMosaic';

/**
 * `/contentpacks` — the content-pack mosaic (#138).
 *
 * Deliberately thin: this module exists to BE the code-split boundary. Everything it needs lives
 * in `apps/modern/features/contentPacks`, which is why navigating here is what first requests the
 * route chunk, and why neither the feature nor the generated `ContentPacksApi` it imports reaches
 * the initial or start-up delivery graph.
 */
const ContentPacks: FC = () => (
    <Page
        id='contentPacksPage'
        className='mainAnimatedPage libraryPage'
        title={globalize.translate('ContentPacks')}
    >
        <ContentPackMosaic />
    </Page>
);

export default ContentPacks;
