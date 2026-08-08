import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

import Page from 'components/Page';
import globalize from 'lib/globalize';

import ItemDetailsPage from '../features/details/components/ItemDetailsPage';

/**
 * `/details` — the Item Details route.
 *
 * Async, registered through `ASYNC_USER_ROUTES` / `toAsyncPageRoute` in BOTH route families, so the
 * route resolves to this module under every supported application layout and there is no legacy
 * controller left to fall back to (#129 Step 1b, invariants 6 and 13).
 *
 * This module is deliberately thin: it exists to be the code-split boundary. Everything it needs
 * lives in `apps/modern/features/details`, which is why navigating here is what first requests the
 * route chunk and why none of it reaches the initial or startup delivery graph.
 */
const Details = () => {
    const [searchParams] = useSearchParams();

    useEffect(() => {
        void (async () => {
            (await import('scripts/libraryMenu')).default.setTitle('');
        })();
    }, []);

    return (
        <Page
            id='itemDetailPage'
            className='mainAnimatedPage libraryPage itemDetailPage'
            title={globalize.translate('Details')}
        >
            <ItemDetailsPage searchParams={searchParams} />
        </Page>
    );
};

export default Details;
