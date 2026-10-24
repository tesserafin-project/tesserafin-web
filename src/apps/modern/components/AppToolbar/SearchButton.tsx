import React, { type FC } from 'react';
import {
    Link,
    URLSearchParamsInit,
    createSearchParams,
    useLocation,
    useSearchParams
} from 'react-router-dom';
import SearchIcon from '@mui/icons-material/Search';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { useItem } from 'hooks/useItem';
import globalize from 'lib/globalize';

const getUrlParams = (
    searchParams: URLSearchParams,
    library?: { id?: string; collectionType?: string | null }
) => {
    const parentId =
        searchParams.get('parentId') ||
        searchParams.get('topParentId') ||
        library?.id;
    const collectionType =
        searchParams.get('collectionType') || library?.collectionType;
    const params: URLSearchParamsInit = {};

    if (parentId) {
        params.parentId = parentId;
    }

    if (collectionType) {
        params.collectionType = collectionType;
    }
    return params;
};

const SearchButton: FC = () => {
    const location = useLocation();
    const [searchParams] = useSearchParams();
    // `/library/:libraryId` names its library in the path, not the query: without this the button
    // opened a global search from inside a movies or shows library (DEBT-WEB-1).
    // Read from the path rather than with `useMatch`, which put ~130 B of route matching on the
    // start-up bundle for one segment.
    const libraryId = /^\/library\/([^/]+)/.exec(location.pathname)?.[1];
    const { data: library } = useItem(libraryId);

    const isSearchPath = location.pathname === '/search';
    const search = createSearchParams(
        getUrlParams(
            searchParams,
            libraryId
                ? { id: libraryId, collectionType: library?.CollectionType }
                : undefined
        )
    );
    const createSearchLink = {
        pathname: '/search',
        search: search ? `?${search}` : undefined
    };

    return (
        <Tooltip
            slotProps={{ popper: { disablePortal: true } }}
            title={globalize.translate('Search')}
        >
            <IconButton
                size='large'
                aria-label={globalize.translate('Search')}
                color='inherit'
                component={Link}
                disabled={isSearchPath}
                to={createSearchLink}
            >
                <SearchIcon />
            </IconButton>
        </Tooltip>
    );
};

export default SearchButton;
