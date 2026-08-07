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
import { detailsBanner } from 'scripts/settings/userSettings';
import type { ItemDetailsSection } from 'themes/platform/contract';
import { EmptyState, ErrorState, LoadingState } from 'ui';
import { usePresentation } from 'ui/presentation/PresentationContext';

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
    hasBackdrop,
    peopleHeadingKey,
    playbackGates,
    renderableChapters,
    splitCast
} from '../utils/itemPredicates';
import {
    composeItemDetails,
    resolveHeroLayout
} from '../utils/itemDetailsRecipe';
import type { DetailsRouteParams } from '../utils/routeParams';
import DetailActionBar from './DetailActionBar';
import DetailImage from './DetailImage';
import DetailSection from './DetailSection';
import ItemCollectionGrid from './ItemCollectionGrid';
import ItemName from './ItemName';

import './ItemDetailsView.scss';
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
 * The Item Details composition, ordered by the resolved recipe.
 *
 * This is the migrated form of `docs/tesserafin/item-details-legacy-contract.md` §3, bound to
 * `presentation.page.itemDetails` by #129 Step 2. Three things are worth stating precisely:
 *
 *  1. **The recipe is read once, here.** This is the composition boundary — the highest point that
 *     knows every surface. No child reads a presentation, none of them can know a theme id, and
 *     nothing on this path parses a manifest or touches `localStorage`: `usePresentation()` returns
 *     an already-resolved value from a provider above the whole app.
 *  2. **Every hook above is called unconditionally**, before the recipe is consulted. A family the
 *     recipe omits is not rendered and is still fetched — hiding is a statement about what is
 *     SHOWN, never about what is REQUESTED (RFC-0007 §6.1). `itemDetails.recipe.test.tsx` replays
 *     the whole P7 ledger under nine recipes to say so.
 *  3. **The fixed header is anchored outside the recipe.** Identity, primary information, the
 *     action bar, the track selectors and the recording controls render in their product-defined
 *     order regardless of what the recipe says, because no theme may select, hide, reorder or move
 *     them.
 *
 * A section still renders only when its data is present and is absent when it is not
 * (`MUST PRESERVE` #10); the recipe decides ORDER and INCLUSION, never eligibility.
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

    /*
     * The legacy route called
     * `fillPrimaryMediaInfo(elem, item, { interactive: true, episodeTitle: false, subtitles: false })`,
     * and `getMediaInfoHtml` treated every field as ON unless explicitly disabled
     * (`options.x !== false`). The modern hook defaults them all to `false`, so the same set is
     * requested here: everything except the episode title, which the legacy call turned off.
     */
    const primaryInfoOptions = {
        showYearInfo: true,
        showAudioContainerInfo: true,
        showEpisodeTitleInfo: false,
        showOriginalAirDateInfo: true,
        showFolderRuntimeInfo: true,
        showRuntimeInfo: true,
        showItemCountInfo: true,
        showSeriesTimerInfo: true,
        showStartDateInfo: true,
        showProgramIndicatorInfo: true,
        showOfficialRatingInfo: true,
        showVideo3DFormatInfo: true,
        showPhotoSizeInfo: true
    };
    const primaryInfo = usePrimaryMediaInfo({
        item: item as never,
        ...primaryInfoOptions
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

    /*
     * The single recipe read, at the composition boundary.
     *
     * `usePresentation()` returns an ALREADY-RESOLVED presentation. Nothing here validates a
     * manifest, reads `localStorage` or knows a theme id — the provider above the app did that
     * once, which is what keeps the Item Details chunk free of the authoring and schema code.
     */
    const recipe = usePresentation().page.itemDetails;
    const composition = useMemo(() => composeItemDetails(recipe), [recipe]);
    const hero = resolveHeroLayout({
        treatment: composition.hero,
        itemSupportsBackdrop: hasBackdrop(item),
        // The user's own preference for their own client. It outranks the theme, and it defaults
        // to ON, so the platform default composes exactly what the pre-binding route rendered.
        userWantsBackdrop: detailsBanner()
    });

    /**
     * Each published content family's surfaces.
     *
     * The gates are the ones the migrated route already had, unchanged: a family renders what its
     * data supports and nothing more. What the recipe decides is the ORDER these are emitted in
     * and WHICH of them are emitted at all — never the gates, never the queries above.
     */
    const families: Record<
        ItemDetailsSection,
        (column: 'hero' | 'full') => React.ReactNode
    > = {
        overview: (column) => (
            <>
                {((item.Taglines ?? []) as string[]).length ? (
                    <DetailSection
                        name='tagline'
                        column={column}
                        slot='overview'
                    >
                        <p>
                            <bdi>{((item.Taglines as string[]) ?? [])[0]}</bdi>
                        </p>
                    </DetailSection>
                ) : null}

                {item.Overview ? (
                    <DetailSection
                        name='overview'
                        column={column}
                        slot='overview'
                    >
                        <Overview markdown={item.Overview as string} />
                    </DetailSection>
                ) : null}
            </>
        ),

        mediaInfo: (column) => (
            <>
                {item.Type === 'Person' && item.PremiereDate ? (
                    <DetailSection
                        name='itemBirthday'
                        column={column}
                        slot='mediaInfo'
                    >
                        <p>{birthdayText(item)}</p>
                    </DetailSection>
                ) : null}

                {item.Type === 'Person'
                && ((item.ProductionLocations ?? []) as string[]).length ? (
                    <DetailSection
                        name='itemBirthLocation'
                        column={column}
                        slot='mediaInfo'
                    >
                        <p>
                            {globalize.translate(
                                'BirthPlaceValue',
                                ((item.ProductionLocations as string[])
                                    ?? [])[0]
                            )}
                        </p>
                    </DetailSection>
                ) : null}

                {item.Type === 'Person' && item.EndDate ? (
                    <DetailSection
                        name='itemDeathDate'
                        column={column}
                        slot='mediaInfo'
                    >
                        <p>{deathDateText(item)}</p>
                    </DetailSection>
                ) : null}

                {airTime ? (
                    <DetailSection
                        name='seriesAirTime'
                        column={column}
                        slot='mediaInfo'
                    >
                        <p>{airTime}</p>
                    </DetailSection>
                ) : null}

                {tags.length ? (
                    <DetailSection
                        name='itemTags'
                        column={column}
                        slot='mediaInfo'
                    >
                        <p>
                            {globalize.translate('TagsValue', tags.join(', '))}
                        </p>
                    </DetailSection>
                ) : null}

                {externalLinksShown ? (
                    <DetailSection
                        name='itemExternalLinks'
                        column={column}
                        slot='mediaInfo'
                    >
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

                <DetailSection
                    name='itemDetailsGroup'
                    column={column}
                    slot='mediaInfo'
                >
                    <MetadataLists item={item} />
                </DetailSection>
            </>
        ),

        nextUp: (column) =>
            list(nextUp.data).length ? (
                <DetailSection
                    name='nextUpSection'
                    column={column}
                    slot='nextUp'
                    heading={globalize.translate('NextUp')}
                >
                    <ItemCollectionGrid
                        items={list(nextUp.data)}
                        aspect='backdrop'
                    />
                </DetailSection>
            ) : null,

        episodes: (column) => (
            <>
                {isBoxSet ? (
                    <DetailSection
                        name='collectionItems'
                        column={column}
                        slot='episodes'
                    >
                        <CollectionGroups items={childItems} />
                    </DetailSection>
                ) : null}

                {/*
                 * Revealed by TYPE, not by result count. `setInitialCollapsibleState` unhid
                 * `#listChildrenCollapsible` before the items-by-name and playlist reads resolved,
                 * and `renderChildren` unhid its container for every non-`BoxSet` folder whatever
                 * the result was. Five classes in the frozen record show this section with no
                 * children, so gating it on `childItems.length` would silently drop a recorded
                 * surface.
                 */}
                {childKind !== 'none' && !isBoxSet ? (
                    <DetailSection
                        name={
                            isListChildren
                                ? 'listChildrenCollapsible'
                                : 'childrenCollapsible'
                        }
                        column={column}
                        slot='episodes'
                        heading={globalize.translate(childrenHeadingKey(item))}
                        headingHidden={childrenHeadingIsHidden(item)}
                    >
                        <ItemCollectionGrid
                            items={childItems}
                            label={globalize.translate(
                                childrenHeadingKey(item)
                            )}
                        />
                    </DetailSection>
                ) : null}

                {list(additionalParts.data).length ? (
                    <DetailSection
                        name='additionalPartsCollapsible'
                        column={column}
                        slot='episodes'
                        heading={globalize.translate('HeaderAdditionalParts')}
                    >
                        <ItemCollectionGrid
                            items={list(additionalParts.data)}
                            aspect='backdrop'
                        />
                    </DetailSection>
                ) : null}
            </>
        ),

        lyrics: (column) =>
            (lyrics.data?.Lyrics ?? []).length ? (
                <DetailSection
                    name='lyricsSection'
                    column={column}
                    slot='lyrics'
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
            ) : null,

        moreFrom: (column) => (
            <>
                {list(moreFromSeason.data).length >= 2 ? (
                    <DetailSection
                        name='moreFromSeasonSection'
                        column={column}
                        slot='moreFrom'
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

                {list(moreFromArtist.data).length ? (
                    <DetailSection
                        name='moreFromArtistSection'
                        column={column}
                        slot='moreFrom'
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
            </>
        ),

        cast: (column) => (
            <>
                {cast.length ? (
                    <DetailSection
                        name='castCollapsible'
                        column={column}
                        slot='cast'
                        heading={globalize.translate(peopleHeadingKey(item))}
                    >
                        <PeopleGrid people={cast} serverId={item.ServerId} />
                    </DetailSection>
                ) : null}

                {guestCast.length ? (
                    <DetailSection
                        name='guestCastCollapsible'
                        column={column}
                        slot='cast'
                        heading={globalize.translate('HeaderGuestCast')}
                    >
                        <PeopleGrid
                            people={guestCast}
                            serverId={item.ServerId}
                        />
                    </DetailSection>
                ) : null}
            </>
        ),

        schedule: (column) => (
            <>
                {isSeriesTimer && canManageLiveTv(user) ? (
                    <DetailSection
                        name='seriesTimerScheduleSection'
                        column={column}
                        slot='schedule'
                        heading={globalize.translate('Schedule')}
                    >
                        <ScheduleList items={list(seriesTimerSchedule.data)} />
                    </DetailSection>
                ) : null}

                {item.Type === 'TvChannel' ? (
                    <DetailSection
                        name='programGuideSection'
                        column={column}
                        slot='schedule'
                    >
                        <ProgramGuide items={list(channelGuide.data)} />
                    </DetailSection>
                ) : null}

                {list(seriesSchedule.data).length ? (
                    <DetailSection
                        name='seriesScheduleSection'
                        column={column}
                        slot='schedule'
                        heading={globalize.translate('HeaderUpcomingOnTV')}
                    >
                        <ScheduleList items={list(seriesSchedule.data)} />
                    </DetailSection>
                ) : null}
            </>
        ),

        extras: (column) => (
            <>
                {(specials.data ?? []).length ? (
                    <DetailSection
                        name='specialsCollapsible'
                        column={column}
                        slot='extras'
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
                        column={column}
                        slot='extras'
                        heading={globalize.translate('MusicVideos')}
                    >
                        <ItemCollectionGrid
                            items={list(musicVideos.data)}
                            aspect='backdrop'
                        />
                    </DetailSection>
                ) : null}
            </>
        ),

        chapters: (column) =>
            chapters.length ? (
                <DetailSection
                    name='scenesCollapsible'
                    column={column}
                    slot='chapters'
                    heading={globalize.translate('HeaderScenes')}
                >
                    <SceneGrid item={item} chapters={chapters} />
                </DetailSection>
            ) : null,

        related: (column) => (
            <>
                {(collections.data ?? []).length ? (
                    <DetailSection
                        name='collectionsCollapsible'
                        column={column}
                        slot='related'
                        heading={globalize.translate('Collections')}
                    >
                        <ItemCollectionGrid items={collections.data ?? []} />
                    </DetailSection>
                ) : null}

                {list(similar.data).length ? (
                    <DetailSection
                        name='similarCollapsible'
                        column={column}
                        slot='related'
                        heading={globalize.translate('HeaderMoreLikeThis')}
                    >
                        <ItemCollectionGrid items={list(similar.data)} />
                    </DetailSection>
                ) : null}
            </>
        )
    };

    return (
        <div className='rf-item-details' data-rf-hero={hero.treatment}>
            {/*
             * The item's own artwork. `MUST PRESERVE` #9: a poster is always rendered, and Person
             * and Book never get a backdrop. It carries no `data-detail-section` because the frozen
             * record never named it as one — it was a template element — so it is asserted by its
             * own gate rather than by the section list.
             */}
            <DetailImage item={item} hero={hero} />

            {/*
             * The FIXED HEADER. Anchored above the recipe and in its product-defined order: item
             * identity, the information the page is required to state, the playback controls, the
             * track selectors and the recording controls. No recipe selects, hides, reorders or
             * moves any of these, and none of them carries a `data-rf-slot`.
             */}
            <DetailSection name='nameContainer' column='hero'>
                <ItemName item={item} />
            </DetailSection>

            {primaryInfo.length > 0 && !isSeriesTimer ? (
                <DetailSection name='itemMiscInfo-primary' column='hero'>
                    <PrimaryMediaInfo
                        item={item as never}
                        {...primaryInfoOptions}
                    />
                </DetailSection>
            ) : null}

            {secondaryInfo.length > 0 && !isSeriesTimer ? (
                <DetailSection name='itemMiscInfo-secondary' column='hero'>
                    <SecondaryMediaInfo
                        item={item as never}
                        {...secondaryInfoOptions}
                    />
                </DetailSection>
            ) : null}

            {actionBarShown ? (
                <DetailSection name='mainDetailButtons' column='hero'>
                    <DetailActionBar
                        item={item}
                        user={user}
                        actions={actions}
                        suppressPlayback={suppressPlayback}
                    />
                </DetailSection>
            ) : null}

            {tracks.isOffered ? (
                <DetailSection name='trackSelections' column='hero'>
                    <TrackSelections tracks={tracks} />
                </DetailSection>
            ) : null}

            {item.Type === 'Program' && canManageLiveTv(user) ? (
                <DetailSection name='recordingFields' column='hero'>
                    <RecordingFields item={item} />
                </DetailSection>
            ) : null}

            {/* The theme-controllable composition, in the resolved recipe's order. */}
            {composition.families.map(({ family, column }) => (
                <React.Fragment key={family}>
                    {families[family](column)}
                </React.Fragment>
            ))}
        </div>
    );
};

/**
 * `renderSeriesAirTime`, byte-identical.
 *
 * `SUSPECT` #7 records that this emits untranslated English (`daily`, ` at `, `Aired `/`Airs `).
 * It is preserved verbatim: adding translation keys would touch the i18n corpus, which the P6 scope
 * neither includes nor excludes, and Step 2 did not widen its scope to take it on. Still open.
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
