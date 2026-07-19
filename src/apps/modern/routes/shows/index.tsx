import { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';
import React, { type FC } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';

import LibraryPage from 'apps/modern/features/libraries/components/LibraryPage';
import { getLegacyLibraryRedirect } from 'apps/modern/features/library/utils/legacyLibraryRedirect';

/**
 * `#/tv` — the tvshows twin of `routes/movies/index.tsx`; see that file for why the redirect lives
 * in the lazy route page and why two tabs deliberately keep their legacy page (issue #15, L15b).
 */
const Shows: FC = () => {
    const [searchParams] = useSearchParams();
    const redirect = getLegacyLibraryRedirect(
        CollectionType.Tvshows,
        searchParams
    );

    if (redirect) {
        return <Navigate replace to={redirect} />;
    }

    return <LibraryPage type={CollectionType.Tvshows} />;
};

export default Shows;
