import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind';
import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import React, { type SyntheticEvent, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

import { clearBackdrop } from 'components/backdrop/backdrop';
import Page from 'components/Page';
import globalize from 'lib/globalize';

import FavoritesTab from '../features/home/components/FavoritesTab';
import HomeTab from '../features/home/components/HomeTab';
import {
    homeTabIndexToParam,
    parseHomeTabIndex
} from '../features/home/utils/tabParam';

const tabId = (index: number) => `home-tab-${index}`;
const tabPanelId = (index: number) => `home-tabpanel-${index}`;

const Home = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const activeTab = parseHomeTabIndex(searchParams.get('tab'));

    // Mirrors the previous controller-based `home.tsx`'s `onResume`: reset the title and any
    // leftover backdrop image once when the page mounts.
    useEffect(() => {
        void (async () => {
            (await import('scripts/libraryMenu')).default.setTitle(null);
        })();
        clearBackdrop();
    }, []);

    // Same `.skinHeader.noHomeButtonHeader` toggling the previous `onResume`/`onPause` did, now
    // scoped to mount/unmount since there's no per-tab controller lifecycle left to hook into.
    useEffect(() => {
        const header = document.querySelector('.skinHeader');
        header?.classList.add('noHomeButtonHeader');

        return () => {
            header?.classList.remove('noHomeButtonHeader');
        };
    }, []);

    const onTabChange = (_event: SyntheticEvent, newValue: number) => {
        searchParams.set('tab', homeTabIndexToParam(newValue));
        setSearchParams(searchParams);
    };

    return (
        <Page
            id='indexPage'
            className='mainAnimatedPage homePage libraryPage allLibraryPage'
            isBackButtonEnabled={false}
            backDropType={[
                BaseItemKind.Movie,
                BaseItemKind.Series,
                BaseItemKind.Book
            ]}
        >
            <Tabs value={activeTab} onChange={onTabChange}>
                <Tab
                    label={globalize.translate('Home')}
                    id={tabId(0)}
                    aria-controls={tabPanelId(0)}
                />
                <Tab
                    label={globalize.translate('Favorites')}
                    id={tabId(1)}
                    aria-controls={tabPanelId(1)}
                />
            </Tabs>

            <Box
                role='tabpanel'
                id={tabPanelId(0)}
                aria-labelledby={tabId(0)}
                hidden={activeTab !== 0}
            >
                {activeTab === 0 && <HomeTab />}
            </Box>
            <Box
                role='tabpanel'
                id={tabPanelId(1)}
                aria-labelledby={tabId(1)}
                hidden={activeTab !== 1}
            >
                {activeTab === 1 && <FavoritesTab />}
            </Box>
        </Page>
    );
};

export default Home;
