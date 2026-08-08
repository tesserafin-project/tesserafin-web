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
    { path: 'mypreferencesmenu', page: 'user/settings' },
    { path: 'quickconnect', page: 'quickConnect' },
    { path: 'search', page: 'search' },
    { path: 'userprofile', page: 'user/userprofile' }
];
