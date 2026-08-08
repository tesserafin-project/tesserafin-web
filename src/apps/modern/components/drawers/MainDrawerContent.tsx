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

    return (
        <>
            {/* MAIN LINKS */}
            <List sx={{ paddingTop: 0 }}>
                <ListItem disablePadding>
                    <DrawerHeaderLink />
                </ListItem>
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
                 * structure — the primary media-family navigation below is untouched, and
                 * reordering or replacing it is #139/M3, not this milestone.
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
                 */}
                <ListItem disablePadding>
                    <ListItemLink to='/contentpacks'>
                        <ListItemIcon>
                            <Icon>collections_bookmark</Icon>
                        </ListItemIcon>
                        <ListItemText
                            primary={globalize.translate('ContentPacks')}
                        />
                    </ListItemLink>
                </ListItem>
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
