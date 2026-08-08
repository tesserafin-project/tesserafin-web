import React, { type FC } from 'react';

import Page from 'components/Page';
import globalize from 'lib/globalize';

import ContentPackBrowse from '../../features/contentPacks/components/ContentPackBrowse';

/**
 * `/contentpacks/:packId` — one pack's mixed-media browse (#138).
 *
 * Same code-split boundary rationale as `./index.tsx`. The route parameter is the server's OPAQUE
 * pack identifier and is carried through verbatim: nothing here parses it, derives meaning from
 * it, or reconstructs it from a name. A rename therefore changes nothing about this URL, and the
 * surface below it never remounts under a new identity.
 */
const ContentPackDetail: FC = () => (
    <Page
        id='contentPackPage'
        className='mainAnimatedPage libraryPage'
        title={globalize.translate('ContentPacks')}
    >
        <ContentPackBrowse />
    </Page>
);

export default ContentPackDetail;
