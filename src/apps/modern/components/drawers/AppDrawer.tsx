import React, { FC } from 'react';

import ResponsiveDrawer, {
    ResponsiveDrawerProps
} from 'components/ResponsiveDrawer';

import MainDrawerContent from './MainDrawerContent';

export { isDrawerPath } from './drawerRoutes';

const AppDrawer: FC<ResponsiveDrawerProps> = ({
    open = false,
    onClose,
    onOpen
}) => (
    <ResponsiveDrawer open={open} onClose={onClose} onOpen={onOpen}>
        <MainDrawerContent />
    </ResponsiveDrawer>
);

export default AppDrawer;
