import { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';
import React, { type FC } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';

import LibraryPage from 'apps/modern/features/libraries/components/LibraryPage';
import { getLegacyLibraryRedirect } from 'apps/modern/features/library/utils/legacyLibraryRedirect';

/**
 * `#/movies` — kept mounted, but no longer the destination of `getRouteUrl()` (issue #15, L15b).
 *
 * The redirect lives *here*, in the lazily-imported route page, rather than in `appRouter.js` or
 * the route table: both of those are in the eager `main.jellyfin.bundle.js`, and this URL is only
 * ever visited by someone who is already loading this chunk. The mapping therefore costs the main
 * bundle nothing.
 *
 * `getLegacyLibraryRedirect` returns `undefined` for the tabs that keep their legacy page — the
 * Studios grid and Playlists — and this component then renders `LibraryPage` exactly as before.
 * That "or nothing" branch is the point: the two tabs without a faithful canonical target are not
 * pointed at an approximate one.
 */
const Movies: FC = () => {
    const [searchParams] = useSearchParams();
    const redirect = getLegacyLibraryRedirect(
        CollectionType.Movies,
        searchParams
    );

    if (redirect) {
        return <Navigate replace to={redirect} />;
    }

    return <LibraryPage type={CollectionType.Movies} />;
};

export default Movies;
