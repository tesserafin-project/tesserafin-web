import Favorite from '@mui/icons-material/Favorite';
import Home from '@mui/icons-material/Home';
import Divider from '@mui/material/Divider';
import Icon from '@mui/material/Icon';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import React from 'react';
import { useLocation } from 'react-router-dom';

import ListItemLink from 'components/ListItemLink';
import { appRouter } from 'components/router/appRouter';
import { useUserViews } from 'hooks/api/useUserViews';
import { useApi } from 'hooks/useApi';
import { useWebConfig } from 'hooks/useWebConfig';
import globalize from 'lib/globalize';
import { ContentPackBrowsingPreference } from 'lib/tesserafin-sdk/generated/models/content-pack-browsing-preference';

import LibraryIcon from '../LibraryIcon';
import DrawerHeaderLink from './DrawerHeaderLink';

const MainDrawerContent = () => {
    const { user } = useApi();
    const location = useLocation();
    const { data: userViewsData } = useUserViews({ userId: user?.Id });
    const userViews = userViewsData?.Items || [];
    const webConfig = useWebConfig();

    const isHomeSelected =
        location.pathname === '/home' &&
        (!location.search || location.search === '?tab=0');

    /*
     * #139 gate 4, for the layout that has a drawer instead of a toolbar.
     *
     * On a phone `AppToolbar` renders no `UserViewNav` at all — `isDrawerAvailable` is true and the
     * navigation moves in here — so a modern phone would otherwise see no effect from the choice the
     * wizard asked for.
     *
     * Content-pack-first moves the content-pack destination to the head of the drawer. It does not
     * add, remove or reorder anything else: Home, Favourites, the custom links and every
     * media-family destination stay exactly where M2 put them, in the same order, on the same
     * routes. Anything other than an explicit `ContentPackFirst` leaves the drawer as M2 shipped it.
     *
     * The comparison is written out rather than delegated to
     * `features/contentPacks/adapters/browsingPreference`: this component is in the start-up graph,
     * where the measured gzip headroom is 43 bytes. The enum still comes from the generated model,
     * so the wire value is never spelled as a literal. `useApi` hands back `@jellyfin/sdk`'s
     * `UserDto`, whose `UserConfiguration` predates this field; the cast is on the shape, not the
     * value, and erases at runtime.
     */
    const packsLead =
        (
            user?.Configuration as
                | { ContentPackBrowsingPreference?: string }
                | undefined
        )?.ContentPackBrowsingPreference ===
        ContentPackBrowsingPreference.ContentPackFirst;

    const contentPacksItem = (
        <ListItem disablePadding>
            <ListItemLink to='/contentpacks'>
                <ListItemIcon>
                    <Icon>collections_bookmark</Icon>
                </ListItemIcon>
                <ListItemText primary={globalize.translate('ContentPacks')} />
            </ListItemLink>
        </ListItem>
    );

    return (
        <>
            {/* MAIN LINKS */}
            <List sx={{ paddingTop: 0 }}>
                <ListItem disablePadding>
                    <DrawerHeaderLink />
                </ListItem>
                {packsLead && contentPacksItem}
                <ListItem disablePadding>
                    <ListItemLink to='/home' selected={isHomeSelected}>
                        <ListItemIcon>
                            <Home />
                        </ListItemIcon>
                        <ListItemText primary={globalize.translate('Home')} />
                    </ListItemLink>
                </ListItem>
                <ListItem disablePadding>
                    <ListItemLink to='/home?tab=1'>
                        <ListItemIcon>
                            <Favorite />
                        </ListItemIcon>
                        <ListItemText
                            primary={globalize.translate('Favorites')}
                        />
                    </ListItemLink>
                </ListItem>
                {/*
                 * Content packs (#138). One destination ALONGSIDE the existing browsing
                 * structure — the primary media-family navigation below is untouched.
                 *
                 * Metadata only: a path, a translated label and an icon. This entry pulls in no
                 * feature module and no SDK client, which is what keeps `ContentPacksApi` out of
                 * the start-up graph even though the drawer itself is in it. It is also NOT gated
                 * on `EnableContentPackManagement`: browsing packs is ordinary authorized
                 * viewing, and the manager capability gates only the management affordances.
                 *
                 * The icon is `@mui/material/Icon` with a ligature name rather than a new
                 * `@mui/icons-material/*` module, because `Icon` is already imported here for the
                 * custom menu links and the start-up asset count has zero headroom (45/45).
                 *
                 * Under content-pack-first the same item is rendered at the head of this list
                 * instead — see `packsLead` above. It appears once either way.
                 */}
                {!packsLead && contentPacksItem}
            </List>

            {/* CUSTOM LINKS */}
            {!!webConfig.menuLinks && webConfig.menuLinks.length > 0 && (
                <>
                    <Divider />
                    <List>
                        {webConfig.menuLinks.map((menuLink) => (
                            <ListItem
                                key={`${menuLink.name}_${menuLink.url}`}
                                disablePadding
                            >
                                <ListItemButton
                                    component='a'
                                    href={menuLink.url}
                                    target='_blank'
                                    rel='noopener noreferrer'
                                >
                                    <ListItemIcon>
                                        <Icon>{menuLink.icon ?? 'link'}</Icon>
                                    </ListItemIcon>
                                    <ListItemText primary={menuLink.name} />
                                </ListItemButton>
                            </ListItem>
                        ))}
                    </List>
                </>
            )}

            {/* LIBRARY LINKS */}
            {userViews.length > 0 && (
                <>
                    <Divider />
                    <List
                        aria-labelledby='libraries-subheader'
                        subheader={
                            <ListSubheader
                                component='div'
                                id='libraries-subheader'
                            >
                                {globalize.translate('HeaderLibraries')}
                            </ListSubheader>
                        }
                    >
                        {userViews.map((view) => (
                            <ListItem key={view.Id} disablePadding>
                                <ListItemLink
                                    to={appRouter
                                        .getRouteUrl(view, {
                                            context: view.CollectionType
                                        })
                                        .substring(1)}
                                >
                                    <ListItemIcon>
                                        <LibraryIcon item={view} />
                                    </ListItemIcon>
                                    <ListItemText primary={view.Name} />
                                </ListItemLink>
                            </ListItem>
                        ))}
                    </List>
                </>
            )}
        </>
    );
};

export default MainDrawerContent;
