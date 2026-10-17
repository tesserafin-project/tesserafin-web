import React, { type FC, useEffect } from 'react';
import { useSearchItems } from '../api/useSearchItems';
import globalize from 'lib/globalize';
import Loading from 'components/loading/LoadingComponent';
import SearchResultsRow from './SearchResultsRow';
import { CardShape } from 'components/cardbuilder/utils/shape';
import { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';
import { Section } from '../types';
import { Link } from 'react-router-dom';

const SCROLL_KEY = 'searchResultsScroll';

interface SearchResultsProps {
    parentId?: string;
    collectionType?: CollectionType;
    query?: string;
}

/*
 * React component to display search result rows for global search and library view search
 */
const SearchResults: FC<SearchResultsProps> = ({
    parentId,
    collectionType,
    query
}) => {
    const { data, isPending } = useSearchItems(
        parentId,
        collectionType,
        query?.trim()
    );

    // Coming back from a result lands where the viewer left the list, not at the top. The offset
    // is taken when a result is opened (the next page may scroll to the top before this one
    // unmounts), and restored a frame after mount, past the page's own `viewshow` scroll reset.
    useEffect(() => {
        if (!data?.length) return;
        const saved = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || 'null');
        if (saved?.query !== query) return;
        const frame = requestAnimationFrame(() => window.scrollTo(0, saved.y));
        return () => cancelAnimationFrame(frame);
    }, [data, query]);

    const rememberOffset = () =>
        sessionStorage.setItem(
            SCROLL_KEY,
            JSON.stringify({ query, y: window.scrollY })
        );

    if (isPending) return <Loading />;

    if (!data?.length) {
        return (
            <div className='noItemsMessage centerMessage'>
                {globalize.translate('SearchResultsEmpty', query)}
                {collectionType && (
                    <div>
                        <Link
                            className='emby-button'
                            to={`/search?query=${encodeURIComponent(query || '')}`}
                        >
                            {globalize.translate('RetryWithGlobalSearch')}
                        </Link>
                    </div>
                )}
            </div>
        );
    }

    const renderSection = (section: Section, index: number) => {
        return (
            <SearchResultsRow
                key={`${section.title}-${index}`}
                title={globalize.translate(section.title)}
                items={section.items}
                cardOptions={{
                    shape: CardShape.AutoOverflow,
                    scalable: true,
                    showTitle: true,
                    overlayText: false,
                    centerText: true,
                    allowBottomPadding: false,
                    ...section.cardOptions
                }}
            />
        );
    };

    return (
        <div
            className={'searchResults padded-top padded-bottom-page'}
            onClickCapture={rememberOffset}
        >
            {data.map((section, index) => renderSection(section, index))}
        </div>
    );
};

export default SearchResults;
