import React, { type FC } from 'react';
import { useParams } from 'react-router-dom';

import Page from 'components/Page';
import globalize from 'lib/globalize';

import ContentPackBrowse from '../../features/contentPacks/components/ContentPackBrowse';
import ContentPackMosaic from '../../features/contentPacks/components/ContentPackMosaic';

/**
 * `/contentpacks` and `/contentpacks/:packId` — one route module for both (#138).
 *
 * ## Why one module and not two
 *
 * `asyncRoutes/user.ts` points BOTH paths at `page: 'contentpacks'`, exactly as it already points
 * `library/:libraryId` and `library/:libraryId/:destination` at `page: 'library'`. The router's
 * lazy context names its chunks `[request]`, so two page modules would emit two JS chunks and two
 * CSS chunks — and every emitted asset costs entries in `runtime.bundle.js`, which is a START-UP
 * asset. With 45/45 assets and (at the time) 170 B of start-up gzip headroom, a second route module
 * put the delivery budget 31 B over its ceiling. Collapsing to one module is the recovery the
 * repository's own registration convention already prescribes; it is not a workaround, and no
 * ceiling moved.
 *
 * ## Why the branch is on the route parameter
 *
 * `packId` is present for the detail path and absent for the list path — that is the whole of the
 * distinction, and it comes from the URL rather than from any state this module owns. The pack
 * identifier is the server's OPAQUE string and is carried through verbatim: nothing here parses it,
 * derives meaning from it, or reconstructs it from a name. A rename therefore changes nothing about
 * the URL, and the surface below never remounts under a new identity.
 *
 * Everything either branch needs lives in `apps/modern/features/contentPacks`, so navigating here
 * is what first requests the route chunk and neither the feature nor the generated
 * `ContentPacksApi` reaches the initial or start-up delivery graph.
 */
const ContentPacks: FC = () => {
    const { packId } = useParams<{ packId?: string }>();

    return (
        <Page
            id='contentPacksPage'
            className='mainAnimatedPage libraryPage'
            title={globalize.translate('ContentPacks')}
        >
            {packId ? <ContentPackBrowse /> : <ContentPackMosaic />}
        </Page>
    );
};

export default ContentPacks;
