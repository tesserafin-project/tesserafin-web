import {
    type SupportedColorScheme,
    ThemeProvider,
    useColorScheme
} from '@mui/material/styles';
import React, { useEffect } from 'react';
import {
    RouterProvider,
    createHashRouter,
    Outlet,
    useLocation
} from 'react-router-dom';

import {
    DASHBOARD_APP_PATHS,
    DASHBOARD_APP_ROUTES
} from 'apps/dashboard/routes/routes';
import { APP_ROUTES as MODERN_APP_ROUTES } from 'apps/modern/routes/routes';
import { APP_ROUTES as LEGACY_APP_ROUTES } from 'apps/legacy/routes/routes';
import { WIZARD_APP_ROUTES } from 'apps/wizard/routes/routes';
import AppHeader from 'components/AppHeader';
import Backdrop from 'components/Backdrop';
import layoutManager from 'components/layoutManager';
import BangRedirect from 'components/router/BangRedirect';
import { createRouterHistory } from 'components/router/routerHistory';
import { ThemeStorageManager } from 'themes/themeStorageManager';
import { useAppTheme } from 'themes/useAppTheme';
import { PresentationProvider } from 'ui/presentation/PresentationContext';

const router = createHashRouter([
    {
        element: <RootAppLayout />,
        children: [
            ...(layoutManager.modern ? MODERN_APP_ROUTES : LEGACY_APP_ROUTES),
            ...DASHBOARD_APP_ROUTES,
            ...WIZARD_APP_ROUTES,
            {
                path: '!/*',
                Component: BangRedirect
            }
        ]
    }
]);

export const history = createRouterHistory(router);

export default function RootAppRouter() {
    return <RouterProvider router={router} />;
}

/**
 * Layout component that renders legacy components required on all pages.
 * NOTE: The app will crash if these get removed from the DOM.
 */
function RootAppLayout() {
    const location = useLocation();
    const isNewLayoutPath = Object.values(DASHBOARD_APP_PATHS).some((path) =>
        location.pathname.startsWith(`/${path}`)
    );
    // No explicit theme id: this tree is driven by the legacy THEME_CHANGE event bus, same as
    // ThemeStorageManager below (RFC-0005 §9.1) — see themes/useAppTheme.ts.
    const { theme: appTheme, activeThemeId } = useAppTheme();

    return (
        <ThemeProvider
            theme={appTheme}
            defaultMode='dark'
            storageManager={ThemeStorageManager}
        >
            {/*
             * Inside `ThemeProvider` and keyed on the SAME `activeThemeId` it uses, so the
             * palette and the presentation can never describe different themes — `activeThemeId`
             * is already the id after the unrenderable-theme fallback, not the requested one.
             */}
            <PresentationProvider themeId={activeThemeId}>
                <ColorSchemeSync themeId={activeThemeId} />
                <Backdrop />
                <AppHeader isHidden={layoutManager.modern || isNewLayoutPath} />

                <Outlet />
            </PresentationProvider>
        </ThemeProvider>
    );
}

/**
 * Actively re-applies `themeId` as the MUI color scheme, from inside the `<ThemeProvider>` it
 * configures. `ThemeStorageManager` alone (passive, event-bus driven) is not enough once color
 * schemes load lazily (RFC-0005 §9.1): MUI's `setColorScheme` validates against the schemes the
 * *current* theme object already knows about and silently drops an id it does not recognize yet,
 * without retrying (see `themes/useAppTheme.ts`'s `AppTheme.activeThemeId` doc). Listing
 * `setColorScheme` itself as an effect dependency is what makes this self-heal: once the theme
 * rebuilds with the newly-loaded scheme, MUI hands out a new `setColorScheme` (its identity is
 * tied to the up-to-date set of known schemes), the effect re-fires, and the retry succeeds.
 */
function ColorSchemeSync({ themeId }: { themeId: string }) {
    const { setColorScheme } = useColorScheme();

    useEffect(() => {
        setColorScheme(themeId as SupportedColorScheme);
    }, [themeId, setColorScheme]);

    return null;
}
