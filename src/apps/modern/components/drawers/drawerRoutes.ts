import { matchPath } from 'react-router-dom';

import { ASYNC_USER_ROUTES } from '../../routes/asyncRoutes';
import { LEGACY_USER_ROUTES } from '../../routes/legacyRoutes';

const DRAWERLESS_ROUTES = [
    'video' // video player
];

const MAIN_DRAWER_ROUTES = [...ASYNC_USER_ROUTES, ...LEGACY_USER_ROUTES].filter(
    (route) => !DRAWERLESS_ROUTES.includes(route.path)
);

/**
 * Whether `path` (a `location.pathname`) resolves to a route that should show the app drawer.
 *
 * Uses `matchPath` rather than string equality because route paths may carry URL parameters:
 * `library/:libraryId` never string-equals a real pathname like `/library/f1e2d3`, so the plain
 * comparison this replaces reported "no drawer" for every parametrised route. On mobile that
 * removed the hamburger button and the drawer itself (`AppLayout.tsx` gates both on
 * `isDrawerAvailable`), leaving `/library/:libraryId` with no way to navigate away (issue #17).
 *
 * Route paths are relative (no leading `/`) while pathnames are absolute, so both sides are
 * normalised before matching. Normalising the argument keeps the slash-less form the previous
 * string-equality implementation accepted working, even though the only caller
 * (`AppLayout.tsx`) passes a `location.pathname`, which is always absolute.
 *
 * Lives outside `AppDrawer.tsx` so it stays importable (and unit-testable) without pulling in the
 * drawer's MUI/`ServerConnections` component tree.
 */
const withLeadingSlash = (path: string) => `/${path.replace(/^\//, '')}`;

export const isDrawerPath = (path: string) =>
    MAIN_DRAWER_ROUTES.some(
        (route) =>
            matchPath(withLeadingSlash(route.path), withLeadingSlash(path)) !==
            null
    );
