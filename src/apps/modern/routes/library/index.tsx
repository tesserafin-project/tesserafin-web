import React, { type FC } from 'react';

import LibraryView from 'apps/modern/features/library/components/LibraryView';

/**
 * Route entry for `/library/:libraryId` (RFC-0005 §11 WP-C). Registered additively in
 * `apps/modern/routes/asyncRoutes/user.ts` alongside the existing per-`CollectionType` pages
 * (`movies`, `tv`, ...) - see `LibraryView.tsx`'s own doc comment for the full scope and the
 * `appRouter.getRouteUrl()` follow-up TODO.
 */
const Library: FC = () => <LibraryView />;

export default Library;
