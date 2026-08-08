import { AsyncRoute } from '../../../../components/router/AsyncRoute';
import { AppType } from '../../../../constants/appType';

export const ASYNC_USER_ROUTES: AsyncRoute[] = [
    /*
     * Item Details is one modern async route in BOTH families (#129 Step 1b). `RootAppRouter` picks
     * a family by `layoutManager.modern`, so registering it only in the modern family would leave
     * `/details` resolving to the retired view-manager controller under the other layout — which is
     * exactly the partial cutover the migration is not allowed to ship.
     */
    { path: 'details', type: AppType.Modern },
    /*
     * Content packs (#138), for the same reason and by the same rule as `details` above: a
     * destination registered in one family only is unreachable under the other layout. There is no
     * legacy view-manager controller for content packs, so the other layout does not fall back to
     * an older screen - it falls through to "Page not found", which is what a TV or mobile layout
     * saw before this entry existed.
     */
    { path: 'contentpacks', type: AppType.Modern },
    {
        path: 'contentpacks/:packId',
        page: 'contentpacks',
        type: AppType.Modern
    },
    { path: 'mypreferencesmenu', page: 'user/settings' },
    { path: 'quickconnect', page: 'quickConnect' },
    { path: 'search', page: 'search' },
    { path: 'userprofile', page: 'user/userprofile' }
];
