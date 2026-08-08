import React from 'react';
import { Navigate, RouteObject } from 'react-router-dom';

import AppLayout from 'apps/legacy/AppLayout';
import ConnectionRequired from 'components/ConnectionRequired';
import ErrorBoundary from 'components/router/ErrorBoundary';
import { toViewManagerPageRoute } from 'components/router/LegacyRoute';

import { WIZARD_STEPS } from './steps';

export const WIZARD_APP_ROUTES: RouteObject[] = [
    {
        element: <ConnectionRequired level='wizard' />,
        children: [
            {
                Component: AppLayout,
                path: 'wizard',
                children: [
                    { index: true, element: <Navigate replace to='start' /> },
                    ...WIZARD_STEPS.map(toViewManagerPageRoute)
                ],
                ErrorBoundary
            }
        ]
    }
];
