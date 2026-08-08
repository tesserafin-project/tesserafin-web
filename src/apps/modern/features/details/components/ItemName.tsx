import React, { type FC, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import itemHelper from 'components/itemHelper';
import { appRouter } from 'components/router/appRouter';

import type { DetailItem } from '../adapters/itemDetailsApi';

interface ParentLink {
    id: string;
    name: string;
    type: string;
    serverId?: string;
}

/**
 * The parent links the name block carries, in the frozen order.
 *
 * `MUST PRESERVE` #8: an episode links to its series AND its season. The legacy block emitted these
 * as `data-action="link"` anchors driven by `components/shortcuts`; here they are ordinary router
 * links, which is `MAY CHANGE` #7. The `data-*` attributes are kept because the frozen fixture
 * identifies the links by `data-type` / `data-id`.
 */
export function parentLinks(item: DetailItem): ParentLink[] {
    const links: ParentLink[] = [];
    const serverId = item.ServerId;

    if (item.Type === 'Episode' && item.SeriesName && item.SeriesId) {
        links.push({
            id: item.SeriesId as string,
            name: item.SeriesName as string,
            type: 'Series',
            serverId
        });
    } else if (item.Type === 'Season' && item.SeriesName && item.SeriesId) {
        links.push({
            id: item.SeriesId as string,
            name: item.SeriesName as string,
            type: 'Series',
            serverId
        });
    }

    if (
        item.Type === 'Episode' &&
        item.ParentIndexNumber != null &&
        item.SeasonId
    ) {
        links.push({
            id: item.SeasonId as string,
            name: (item.SeasonName as string) ?? '',
            type: 'Season',
            serverId
        });
    } else if (
        (item.Type === 'MusicVideo' || item.Type === 'Audio') &&
        item.Album &&
        item.AlbumId
    ) {
        links.push({
            id: item.AlbumId as string,
            name: item.Album as string,
            type: 'MusicAlbum',
            serverId
        });
    }

    return links;
}

/** The artist links an album, track or music video carries above its name. */
function artistLinks(item: DetailItem): ParentLink[] {
    const artists = (item.AlbumArtists ??
        (item.Type === 'MusicVideo' ? item.ArtistItems : undefined) ??
        []) as { Id?: string; Name?: string }[];

    return artists.slice(0, 10).map((artist) => ({
        id: artist.Id ?? '',
        name: artist.Name ?? '',
        type: 'MusicArtist',
        serverId: item.ServerId
    }));
}

/**
 * A parent link.
 *
 * `color: inherit` so the link takes the name block's own foreground rather than the theme's link
 * colour. Not decoration: the link sits on the detail hero, where the default link blue fails WCAG
 * AA contrast — axe reports `color-contrast` on exactly this element otherwise. The legacy block
 * carried the same inline `color: inherit` for the same reason.
 */
const ParentAnchor: FC<{ link: ParentLink }> = ({ link }) => (
    <Link
        to={appRouter.getRouteUrl(
            { Id: link.id, Type: link.type, ServerId: link.serverId },
            { itemType: link.type, serverId: link.serverId }
        )}
        data-id={link.id}
        data-type={link.type}
        data-serverid={link.serverId}
        style={{ color: 'inherit' }}
    >
        {link.name}
    </Link>
);

interface ItemNameProps {
    item: DetailItem;
}

/**
 * The name block.
 *
 * One `h1` for the item, one `h2`-level parent line where the item has one. The legacy block emitted
 * `h1`/`h3`/`h4` in an order that depended on which branch produced the parent name, producing an
 * invalid heading sequence on several classes; `MAY CHANGE` #1 releases the levels and Phase 4
 * requires a correct hierarchy, so the parent line is a paragraph and the item name is the only
 * heading. Delta D9.
 */
const ItemName: FC<ItemNameProps> = ({ item }) => {
    const artists = artistLinks(item);
    const parents = parentLinks(item);
    const displayName = itemHelper.getDisplayName(item, {
        includeParentInfo: false
    });

    const parentLine: ReactNode[] = [];
    if (artists.length) {
        artists.forEach((link, index) => {
            if (index > 0)
                parentLine.push(<span key={`sep-${link.id}`}> / </span>);
            parentLine.push(<ParentAnchor key={link.id} link={link} />);
        });
    } else {
        parents.forEach((link, index) => {
            if (index > 0) {
                parentLine.push(<span key={`sep-${link.id}`}> - </span>);
            }
            parentLine.push(<ParentAnchor key={link.id} link={link} />);
        });
    }

    return (
        <>
            {parentLine.length ? <p>{parentLine}</p> : null}
            <h1>
                <bdi>{displayName}</bdi>
            </h1>
            {item.OriginalTitle && item.OriginalTitle !== item.Name ? (
                <p data-detail-original-title>{item.OriginalTitle as string}</p>
            ) : null}
        </>
    );
};

export default ItemName;
