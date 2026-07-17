import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

import { clearBackdrop } from 'components/backdrop/backdrop';
import Page from 'components/Page';
import globalize from 'lib/globalize';
import { BaseItemKind } from 'lib/reefin-sdk';
import { Tabs, type TabItem } from 'ui';

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
    // TODO(RFC-0005 §4.2/design-reefin-shell-and-routing.md): retire this once the shell
    // (`AppLayout`/`components/`) is migrated onto `src/ui` and exposes a declarative way to hide
    // the home button instead of a legacy DOM class toggle on `.skinHeader`.
    useEffect(() => {
        const header = document.querySelector('.skinHeader');
        header?.classList.add('noHomeButtonHeader');

        return () => {
            header?.classList.remove('noHomeButtonHeader');
        };
    }, []);

    const tabItems: TabItem[] = [
        {
            id: tabId(0),
            label: globalize.translate('Home'),
            panelId: tabPanelId(0)
        },
        {
            id: tabId(1),
            label: globalize.translate('Favorites'),
            panelId: tabPanelId(1)
        }
    ];

    const onTabChange = (index: number) => {
        searchParams.set('tab', homeTabIndexToParam(index));
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
            <Tabs items={tabItems} value={activeTab} onChange={onTabChange} />

            <div
                role='tabpanel'
                id={tabPanelId(0)}
                aria-labelledby={tabId(0)}
                hidden={activeTab !== 0}
            >
                {activeTab === 0 && <HomeTab />}
            </div>
            <div
                role='tabpanel'
                id={tabPanelId(1)}
                aria-labelledby={tabId(1)}
                hidden={activeTab !== 1}
            >
                {activeTab === 1 && <FavoritesTab />}
            </div>
        </Page>
    );
};

export default Home;
