import { AsyncRoute } from 'components/router/AsyncRoute';
import { AppType } from 'constants/appType';

export const ASYNC_USER_ROUTES: AsyncRoute[] = [
    // Item Details (#129 Step 1b). Also registered in the legacy family, for the reason recorded
    // there: both families must expose the same modern route or the cutover is only half done.
    { path: 'details', type: AppType.Modern },
    /*
     * Content packs (#138). Two entries, both `AppType.Modern`, both resolved by
     * `toAsyncPageRoute` — so the whole slice (its queries, its generated `ContentPacksApi` and
     * its UI) lands in the `contentpacks`/`contentpacks/pack` chunks and nothing of it reaches the
     * initial or start-up delivery graph. Registering the path here is also what gives
     * `isDrawerPath` and the drawer's active-route matching the parametrised detail route for
     * free (`components/drawers/drawerRoutes.ts`).
     *
     * Modern family only, like `home` and `library/:libraryId` and unlike `details`: this is a NEW
     * destination with no legacy view-manager controller to supersede, so there is no half-done
     * cutover to avoid — the drawer that links to it is itself modern-only.
     */
    { path: 'contentpacks', type: AppType.Modern },
    {
        path: 'contentpacks/:packId',
        page: 'contentpacks/pack',
        type: AppType.Modern
    },
    { path: 'home', type: AppType.Modern },
    { path: 'homevideos', type: AppType.Modern },
    { path: 'library/:libraryId', page: 'library', type: AppType.Modern },
    /*
     * The three non-default destinations (design §5: Browse is the default and renders at the short
     * URL above, so there is no `/browse` segment to declare). One entry, not three, because the
     * segment is a param the page resolves — `LibraryView` redirects an unknown segment back to the
     * short URL rather than falling through to the 404 route.
     */
    {
        path: 'library/:libraryId/:destination',
        page: 'library',
        type: AppType.Modern
    },
    { path: 'livetv', type: AppType.Modern },
    { path: 'movies', type: AppType.Modern },
    { path: 'music', type: AppType.Modern },
    { path: 'books', type: AppType.Modern },
    { path: 'musicvideos', type: AppType.Modern },
    { path: 'boxsets', type: AppType.Modern },
    { path: 'playlists', type: AppType.Modern },
    { path: 'mixed', type: AppType.Modern },
    {
        path: 'mypreferencesdisplay',
        page: 'user/display',
        type: AppType.Modern
    },
    // Linked from the Display preferences page rather than from the drawer: it is an authoring
    // tool reached from Appearance, not a top-level destination.
    {
        path: 'themestudio',
        page: 'user/themeStudio',
        type: AppType.Modern
    },
    { path: 'mypreferencesmenu', page: 'user/settings' },
    { path: 'quickconnect', page: 'quickConnect' },
    { path: 'search' },
    { path: 'tv', page: 'shows', type: AppType.Modern },
    { path: 'userprofile', page: 'user/userprofile' }
];
