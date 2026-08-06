import React, { useCallback, useMemo, type FC } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { appHost } from 'components/apphost';
import layoutManager from 'components/layoutManager';
import PrimaryMediaInfo from 'components/mediainfo/PrimaryMediaInfo';
import SecondaryMediaInfo from 'components/mediainfo/SecondaryMediaInfo';
import usePrimaryMediaInfo from 'components/mediainfo/usePrimaryMediaInfo';
import useSecondaryMediaInfo from 'components/mediainfo/useSecondaryMediaInfo';
import { AppFeature } from 'constants/appFeature';
import globalize from 'lib/globalize';
import datetime from 'scripts/datetime';
import { EmptyState, ErrorState, LoadingState } from 'ui';

import type { DetailItem, DetailUser } from '../adapters/itemDetailsApi';
import {
    childrenKind,
    useAdditionalParts,
    useChannelGuide,
    useDetailChildren,
    useItemCollections,
    useLyrics,
    useMoreFromArtist,
    useMoreFromSeason,
    useMusicVideos,
    useNextUp,
    useSeriesSchedule,
    useSeriesTimerSchedule,
    useSimilarItems,
    useSpecialFeatures
} from '../api/useItemDetails';
import { useItemActions } from '../hooks/useItemActions';
import { useTrackSelection } from '../hooks/useTrackSelection';
import { useUserDataRefresh } from '../hooks/useUserDataRefresh';
import {
    LIST_VIEW_TYPES,
    canManageLiveTv,
    childrenHeadingIsHidden,
    childrenHeadingKey,
    peopleHeadingKey,
    playbackGates,
    renderableChapters,
    splitCast
} from '../utils/itemPredicates';
import type { DetailsRouteParams } from '../utils/routeParams';
import DetailActionBar from './DetailActionBar';
import DetailSection from './DetailSection';
import ItemCollectionGrid from './ItemCollectionGrid';
import ItemName from './ItemName';
import PeopleGrid from './PeopleGrid';
import RecordingFields from './RecordingFields';
import SceneGrid from './SceneGrid';
import ScheduleList from './ScheduleList';
import TrackSelections from './TrackSelections';
import MetadataLists from './MetadataLists';
import Overview from './Overview';

interface ItemDetailsViewProps {
    item: DetailItem;
    user: DetailUser;
    params: DetailsRouteParams;
}

const list = (result: { Items?: DetailItem[] } | undefined) =>
    result?.Items ?? [];

/**
 * The Item Details composition, in the frozen order.
 *
 * This is the migrated form of `docs/tesserafin/item-details-legacy-contract.md` §3. The order of
 * the sections below IS the contract; a section renders when its data is present and is absent when
 * it is not (`MUST PRESERVE` #10). The reads that feed them are issued by the hooks regardless, so
 * a class that fetches and shows nothing still fetches — invariant 16.
 *
 * Nothing here reads `usePresentation()`. `presentation.page.itemDetails` is unbound and stays that
 * way until Step 2.
 */
const ItemDetailsView: FC<ItemDetailsViewProps> = ({ item, user, params }) => {
    const queryClient = useQueryClient();
    const refresh = useCallback(() => {
        void queryClient.invalidateQueries({ queryKey: ['itemDetails'] });
    }, [queryClient]);

    useUserDataRefresh(item, params.serverId, refresh);

    const tracks = useTrackSelection(item, (key) => globalize.translate(key));
    const actions = useItemActions({
        item,
        user,
        tracks,
        serverId: params.serverId,
        refresh
    });

    const children = useDetailChildren(item, user);
    const moreFromSeason = useMoreFromSeason(item);
    const nextUp = useNextUp(item, user);
    const seriesSchedule = useSeriesSchedule(item);
    const similar = useSimilarItems(item);
    const collections = useItemCollections(item, user);
    const specials = useSpecialFeatures(item, user);
    const additionalParts = useAdditionalParts(item, user);
    const musicVideos = useMusicVideos(item, user);
    const moreFromArtist = useMoreFromArtist(item);
    const lyrics = useLyrics(item);
    const channelGuide = useChannelGuide(item);
    const seriesTimerSchedule = useSeriesTimerSchedule(
        item,
        canManageLiveTv(user)
    );

    const primaryInfo = usePrimaryMediaInfo({
        item: item as never,
        showEpisodeTitleInfo: false
    });
    /*
     * The legacy route called `fillSecondaryMediaInfo(elem, item, { interactive: true })`, and
     * `getProgramInfoHtml` treated programme time, start date, channel number and channel name as
     * ON unless explicitly disabled. The modern hook defaults them all to `false`, so they are
     * requested here — same fields, same order.
     */
    const secondaryInfoOptions = {
        showProgramTimeInfo: true,
        showStartDateInfo: true,
        showChannelNumberInfo: true,
        showChannelInfo: true,
        channelInteractive: true
    };
    const secondaryInfo = useSecondaryMediaInfo({
        item: item as never,
        ...secondaryInfoOptions
    });

    const { cast, guestCast } = useMemo(() => splitCast(item), [item]);
    const chapters = useMemo(() => renderableChapters(item), [item]);

    const childKind = childrenKind(item);
    const childItems = list(children.data);
    /*
     * Which of the two child containers this class uses.
     *
     * `setInitialCollapsibleState` sends the items-by-name and playlist branches to
     * `#listChildrenCollapsible` explicitly, and `renderChildren` picks between the two by
     * `LIST_VIEW_TYPES`. Both rules matter: five classes in the frozen record are items-by-name
     * types that are NOT in `LIST_VIEW_TYPES` and still land in the list container.
     */
    const isListChildren =
        childrenKind(item) === 'itemsByName' ||
        childrenKind(item) === 'playlist' ||
        LIST_VIEW_TYPES.includes(item.Type ?? '');
    const isBoxSet = item.Type === 'BoxSet';

    const gates = playbackGates(item);
    const actionBarShown = item.Type !== 'Program' || gates.canPlay;

    /**
     * A collection whose children contain nothing playable offers no play and no shuffle.
     *
     * `SUSPECT` #9: the legacy route showed both controls and then hid them, re-focusing to
     * compensate — a sequence its own source calls a HACK. The END STATE is preserved; the flicker
     * and the compensating focus call are not. Delta D7.
     */
    const suppressPlayback =
        isBoxSet &&
        childItems.length > 0 &&
        !childItems.some(
            (child) =>
                child.MediaType === 'Video' || child.MediaType === 'Audio'
        );

    const externalLinks = [
        ...(item.HomePageUrl
            ? [
                  {
                      Name: globalize.translate('ButtonWebsite'),
                      Url: item.HomePageUrl as string
                  }
              ]
            : []),
        ...((item.ExternalUrls ?? []) as { Name?: string; Url?: string }[])
    ];
    const externalLinksShown =
        !layoutManager.tv &&
        appHost.supports(AppFeature.ExternalLinks) &&
        externalLinks.length > 0;

    const tags = ((item.Type === 'Program' ? [] : item.Tags) ?? []) as string[];

    const isSeriesTimer = item.Type === 'SeriesTimer';
    const airTime = seriesAirTimeText(item);

    return (
        <>
            <DetailSection name='nameContainer'>
                <ItemName item={item} />
            </DetailSection>

            {primaryInfo.length > 0 && !isSeriesTimer ? (
                <DetailSection name='itemMiscInfo-primary'>
                    <PrimaryMediaInfo
                        item={item as never}
                        showEpisodeTitleInfo={false}
                    />
                </DetailSection>
            ) : null}

            {secondaryInfo.length > 0 && !isSeriesTimer ? (
                <DetailSection name='itemMiscInfo-secondary'>
                    <SecondaryMediaInfo
                        item={item as never}
                        {...secondaryInfoOptions}
                    />
                </DetailSection>
            ) : null}

            {actionBarShown ? (
                <DetailSection name='mainDetailButtons'>
                    <DetailActionBar
                        item={item}
                        user={user}
                        actions={actions}
                        suppressPlayback={suppressPlayback}
                    />
                </DetailSection>
            ) : null}

            {tracks.isOffered ? (
                <DetailSection name='trackSelections'>
                    <TrackSelections tracks={tracks} />
                </DetailSection>
            ) : null}

            {item.Type === 'Program' && canManageLiveTv(user) ? (
                <DetailSection name='recordingFields'>
                    <RecordingFields item={item} />
                </DetailSection>
            ) : null}

            {((item.Taglines ?? []) as string[]).length ? (
                <DetailSection name='tagline'>
                    <p>
                        <bdi>{((item.Taglines as string[]) ?? [])[0]}</bdi>
                    </p>
                </DetailSection>
            ) : null}

            {item.Overview ? (
                <DetailSection name='overview'>
                    <Overview markdown={item.Overview as string} />
                </DetailSection>
            ) : null}

            {item.Type === 'Person' && item.PremiereDate ? (
                <DetailSection name='itemBirthday'>
                    <p>{birthdayText(item)}</p>
                </DetailSection>
            ) : null}

            {item.Type === 'Person' &&
            ((item.ProductionLocations ?? []) as string[]).length ? (
                <DetailSection name='itemBirthLocation'>
                    <p>
                        {globalize.translate(
                            'BirthPlaceValue',
                            ((item.ProductionLocations as string[]) ?? [])[0]
                        )}
                    </p>
                </DetailSection>
            ) : null}

            {item.Type === 'Person' && item.EndDate ? (
                <DetailSection name='itemDeathDate'>
                    <p>{deathDateText(item)}</p>
                </DetailSection>
            ) : null}

            {airTime ? (
                <DetailSection name='seriesAirTime'>
                    <p>{airTime}</p>
                </DetailSection>
            ) : null}

            {tags.length ? (
                <DetailSection name='itemTags'>
                    <p>{globalize.translate('TagsValue', tags.join(', '))}</p>
                </DetailSection>
            ) : null}

            {externalLinksShown ? (
                <DetailSection name='itemExternalLinks'>
                    <ul>
                        {externalLinks.map((link) => (
                            <li key={link.Url}>
                                <a
                                    href={link.Url}
                                    target='_blank'
                                    rel='noreferrer'
                                >
                                    {link.Name}
                                </a>
                            </li>
                        ))}
                    </ul>
                </DetailSection>
            ) : null}

            <DetailSection name='itemDetailsGroup'>
                <MetadataLists item={item} />
            </DetailSection>

            {isSeriesTimer && canManageLiveTv(user) ? (
                <DetailSection
                    name='seriesTimerScheduleSection'
                    heading={globalize.translate('Schedule')}
                >
                    <ScheduleList items={list(seriesTimerSchedule.data)} />
                </DetailSection>
            ) : null}

            {isBoxSet ? (
                <DetailSection name='collectionItems'>
                    <CollectionGroups items={childItems} />
                </DetailSection>
            ) : null}

            {list(nextUp.data).length ? (
                <DetailSection
                    name='nextUpSection'
                    heading={globalize.translate('NextUp')}
                >
                    <ItemCollectionGrid
                        items={list(nextUp.data)}
                        aspect='backdrop'
                    />
                </DetailSection>
            ) : null}

            {item.Type === 'TvChannel' ? (
                <DetailSection name='programGuideSection'>
                    <ProgramGuide items={list(channelGuide.data)} />
                </DetailSection>
            ) : null}

            {/*
             * Revealed by TYPE, not by result count. `setInitialCollapsibleState` unhid
             * `#listChildrenCollapsible` before the items-by-name and playlist reads resolved, and
             * `renderChildren` unhid its container for every non-`BoxSet` folder whatever the
             * result was. Five classes in the frozen record show this section with no children, so
             * gating it on `childItems.length` would silently drop a recorded surface.
             */}
            {childKind !== 'none' && !isBoxSet ? (
                <DetailSection
                    name={
                        isListChildren
                            ? 'listChildrenCollapsible'
                            : 'childrenCollapsible'
                    }
                    heading={globalize.translate(childrenHeadingKey(item))}
                    headingHidden={childrenHeadingIsHidden(item)}
                >
                    <ItemCollectionGrid
                        items={childItems}
                        label={globalize.translate(childrenHeadingKey(item))}
                    />
                </DetailSection>
            ) : null}

            {list(additionalParts.data).length ? (
                <DetailSection
                    name='additionalPartsCollapsible'
                    heading={globalize.translate('HeaderAdditionalParts')}
                >
                    <ItemCollectionGrid
                        items={list(additionalParts.data)}
                        aspect='backdrop'
                    />
                </DetailSection>
            ) : null}

            {list(moreFromSeason.data).length >= 2 ? (
                <DetailSection
                    name='moreFromSeasonSection'
                    heading={globalize.translate(
                        'MoreFromValue',
                        (item.SeasonName as string) ?? ''
                    )}
                >
                    <ItemCollectionGrid
                        items={list(moreFromSeason.data)}
                        aspect='backdrop'
                    />
                </DetailSection>
            ) : null}

            {(lyrics.data?.Lyrics ?? []).length ? (
                <DetailSection
                    name='lyricsSection'
                    heading={globalize.translate('Lyrics')}
                >
                    <p>
                        {(lyrics.data?.Lyrics ?? []).map((line, index) => (
                            <React.Fragment key={index}>
                                {line.Text}
                                <br />
                            </React.Fragment>
                        ))}
                    </p>
                </DetailSection>
            ) : null}

            {list(moreFromArtist.data).length ? (
                <DetailSection
                    name='moreFromArtistSection'
                    heading={
                        item.Type === 'MusicArtist'
                            ? globalize.translate('HeaderAppearsOn')
                            : globalize.translate(
                                  'MoreFromValue',
                                  (
                                      (item.AlbumArtists ?? []) as {
                                          Name?: string;
                                      }[]
                                  )[0]?.Name ?? ''
                              )
                    }
                >
                    <ItemCollectionGrid
                        items={list(moreFromArtist.data)}
                        aspect='square'
                    />
                </DetailSection>
            ) : null}

            {cast.length ? (
                <DetailSection
                    name='castCollapsible'
                    heading={globalize.translate(peopleHeadingKey(item))}
                >
                    <PeopleGrid people={cast} serverId={item.ServerId} />
                </DetailSection>
            ) : null}

            {guestCast.length ? (
                <DetailSection
                    name='guestCastCollapsible'
                    heading={globalize.translate('HeaderGuestCast')}
                >
                    <PeopleGrid people={guestCast} serverId={item.ServerId} />
                </DetailSection>
            ) : null}

            {list(seriesSchedule.data).length ? (
                <DetailSection
                    name='seriesScheduleSection'
                    heading={globalize.translate('HeaderUpcomingOnTV')}
                >
                    <ScheduleList items={list(seriesSchedule.data)} />
                </DetailSection>
            ) : null}

            {(specials.data ?? []).length ? (
                <DetailSection
                    name='specialsCollapsible'
                    heading={globalize.translate('SpecialFeatures')}
                >
                    <ItemCollectionGrid
                        items={specials.data ?? []}
                        aspect='backdrop'
                    />
                </DetailSection>
            ) : null}

            {list(musicVideos.data).length ? (
                <DetailSection
                    name='musicVideosCollapsible'
                    heading={globalize.translate('MusicVideos')}
                >
                    <ItemCollectionGrid
                        items={list(musicVideos.data)}
                        aspect='backdrop'
                    />
                </DetailSection>
            ) : null}

            {chapters.length ? (
                <DetailSection
                    name='scenesCollapsible'
                    heading={globalize.translate('HeaderScenes')}
                >
                    <SceneGrid item={item} chapters={chapters} />
                </DetailSection>
            ) : null}

            {(collections.data ?? []).length ? (
                <DetailSection
                    name='collectionsCollapsible'
                    heading={globalize.translate('Collections')}
                >
                    <ItemCollectionGrid items={collections.data ?? []} />
                </DetailSection>
            ) : null}

            {list(similar.data).length ? (
                <DetailSection
                    name='similarCollapsible'
                    heading={globalize.translate('HeaderMoreLikeThis')}
                >
                    <ItemCollectionGrid items={list(similar.data)} />
                </DetailSection>
            ) : null}
        </>
    );
};

/**
 * `renderSeriesAirTime`, byte-identical.
 *
 * `SUSPECT` #7 records that this emits untranslated English (`daily`, ` at `, `Aired `/`Airs `).
 * It is preserved verbatim: adding translation keys would touch the i18n corpus, which the P6 scope
 * neither includes nor excludes. Flagged for Step 2.
 */
function seriesAirTimeText(item: DetailItem): string {
    if (item.Type !== 'Series') return '';

    let text = '';
    const airDays = (item.AirDays ?? []) as string[];
    if (airDays.length) {
        text +=
            airDays.length === 7
                ? 'daily'
                : airDays.map((day) => `${day}s`).join(',');
    }
    if (item.AirTime) text += ` at ${item.AirTime as string}`;
    if (!text) return '';
    return (item.Status === 'Ended' ? 'Aired ' : 'Airs ') + text;
}

function birthdayText(item: DetailItem): string {
    const birthday = datetime.parseISO8601Date(item.PremiereDate, true);
    const value = globalize.translate(
        'BirthDateValue',
        birthday.toLocaleDateString()
    );
    if (item.EndDate) return value;
    const years = yearsBetween(birthday, new Date());
    return `${value} ${globalize.translate('AgeValue', years)}`;
}

function deathDateText(item: DetailItem): string {
    const deathday = datetime.parseISO8601Date(item.EndDate, true);
    const value = globalize.translate(
        'DeathDateValue',
        deathday.toLocaleDateString()
    );
    if (!item.PremiereDate) return value;
    const birthday = datetime.parseISO8601Date(item.PremiereDate, true);
    return `${value} ${globalize.translate('AgeValue', yearsBetween(birthday, deathday))}`;
}

function yearsBetween(start: Date, end: Date): number {
    let years = end.getFullYear() - start.getFullYear();
    const beforeAnniversary =
        end.getMonth() < start.getMonth() ||
        (end.getMonth() === start.getMonth() &&
            end.getDate() < start.getDate());
    if (beforeAnniversary) years -= 1;
    return years;
}

/**
 * A collection's children, grouped by item type in the frozen order.
 *
 * `renderCollectionItems`' type table, unchanged. A group renders only when it has members, and
 * whatever is left over lands in "Other Items".
 */
const COLLECTION_GROUPS: { key: string; type?: string; mediaType?: string }[] =
    [
        { key: 'Movies', type: 'Movie' },
        { key: 'Series', type: 'Series' },
        { key: 'Episodes', type: 'Episode' },
        { key: 'HeaderVideos', mediaType: 'Video' },
        { key: 'Albums', type: 'MusicAlbum' },
        { key: 'Books', type: 'Book' },
        { key: 'Collections', type: 'BoxSet' }
    ];

const CollectionGroups: FC<{ items: DetailItem[] }> = ({ items }) => {
    if (!items.length) {
        return (
            <EmptyState
                title={globalize.translate('Items')}
                description={globalize.translate('MessageNoItemsAvailable')}
            />
        );
    }

    let rest = items;
    const groups: { key: string; items: DetailItem[] }[] = [];

    for (const group of COLLECTION_GROUPS) {
        const matched = rest.filter(
            (entry) =>
                (group.mediaType && entry.MediaType === group.mediaType) ||
                entry.Type === group.type
        );
        rest = rest.filter((entry) => !matched.includes(entry));
        if (matched.length) groups.push({ key: group.key, items: matched });
    }

    if (rest.length) groups.push({ key: 'HeaderOtherItems', items: rest });

    return (
        <>
            {groups.map((group) => (
                <div key={group.key}>
                    <h2 data-detail-heading='collectionItems'>
                        {globalize.translate(group.key)}
                    </h2>
                    <ItemCollectionGrid
                        items={group.items}
                        aspect={group.key === 'Albums' ? 'square' : 'poster'}
                    />
                </div>
            ))}
        </>
    );
};

/**
 * The channel guide, grouped by air date.
 *
 * The date heading uses `scripts/datetime`'s formatter with the same options the legacy route used,
 * so the heading string is identical — the frozen fixture records it literally
 * (`'Saturday, January 1'`) rather than as a translation key.
 */
const ProgramGuide: FC<{ items: DetailItem[] }> = ({ items }) => {
    const groups: { label: string; items: DetailItem[] }[] = [];

    for (const entry of items) {
        const start = datetime.parseISO8601Date(entry.StartDate);
        const label = datetime.toLocaleDateString(start, {
            weekday: 'long',
            month: 'long',
            day: 'numeric'
        });
        const current = groups[groups.length - 1];
        if (current && current.label === label) {
            current.items.push(entry);
        } else {
            groups.push({ label, items: [entry] });
        }
    }

    return (
        <>
            {groups.map((group) => (
                <div key={group.label}>
                    <h2 data-detail-heading='programGuideSection'>
                        {group.label}
                    </h2>
                    <ul>
                        {group.items.map((entry) => (
                            <li key={entry.Id} data-id={entry.Id}>
                                {entry.Name}
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
        </>
    );
};

export { ErrorState, LoadingState };
export default ItemDetailsView;
