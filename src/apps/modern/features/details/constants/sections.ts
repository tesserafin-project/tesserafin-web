/**
 * The section vocabulary the frozen P5 contract speaks.
 *
 * `tests/fixtures/item-details/legacy-contract.json` names each section by the DOM id the legacy
 * view template used. `MAY CHANGE` #1 releases those ids as MARKUP, but they are the identifiers
 * the frozen evidence is written in, so the migrated route keeps the NAMES and drops the markup:
 * every section renders `data-detail-section="<name>"`.
 *
 * That attribute is a CHARACTERIZATION HOOK, not a theming surface. It exists so the frozen fixture
 * can judge the migrated route without being rewritten. No stylesheet targets it, it is not part of
 * the published presentation vocabulary, and Step 2's recipe binding will not read it. See
 * `docs/tesserafin/item-details-migration.md` §3.
 */

export const DETAIL_SECTIONS = [
    'nameContainer',
    'itemMiscInfo-primary',
    'itemMiscInfo-secondary',
    'mainDetailButtons',
    'trackSelections',
    'recordingFields',
    'tagline',
    'overview',
    'itemBirthday',
    'itemBirthLocation',
    'itemDeathDate',
    'seriesAirTime',
    'itemTags',
    'itemExternalLinks',
    'itemDetailsGroup',
    'seriesTimerScheduleSection',
    'collectionItems',
    'nextUpSection',
    'programGuideSection',
    'listChildrenCollapsible',
    'childrenCollapsible',
    'additionalPartsCollapsible',
    'moreFromSeasonSection',
    'lyricsSection',
    'moreFromArtistSection',
    'castCollapsible',
    'guestCastCollapsible',
    'seriesScheduleSection',
    'specialsCollapsible',
    'musicVideosCollapsible',
    'scenesCollapsible',
    'collectionsCollapsible',
    'similarCollapsible'
] as const;

export type DetailSectionName = (typeof DETAIL_SECTIONS)[number];

/**
 * The sections that sit BESIDE the poster rather than below it.
 *
 * The legacy template split the page into `detailPagePrimaryContent` (beside the artwork) and the
 * full-width blocks under it. That split is layout, not composition — `MAY CHANGE` #2 says which
 * column a section renders in carries no product guarantee — so it is expressed here as a slot the
 * stylesheet reads, and the SECTION ORDER is untouched either way.
 *
 * Everything from `seriesTimerScheduleSection` onward is a full-width block.
 */
export const HERO_SECTIONS: readonly DetailSectionName[] =
    DETAIL_SECTIONS.slice(0, DETAIL_SECTIONS.indexOf('itemDetailsGroup') + 1);

export const isHeroSection = (name: DetailSectionName): boolean =>
    HERO_SECTIONS.includes(name);

/** The principal actions, named as the frozen contract names them. */
export const DETAIL_ACTIONS = [
    'btnPlay',
    'btnReplay',
    'btnInstantMix',
    'btnShuffle',
    'btnPlayTrailer',
    'btnCancelTimer',
    'btnCancelSeriesTimer',
    'btnDownload',
    'btnPlaystate',
    'btnUserRating',
    'btnSplitVersions',
    'btnMoreCommands'
] as const;

export type DetailActionName = (typeof DETAIL_ACTIONS)[number];

/** The user-data controls, a subset of the actions. */
export const USER_DATA_CONTROLS = ['btnPlaystate', 'btnUserRating'] as const;

/** The track/version selectors, named as the frozen contract names them. */
export const DETAIL_SELECTORS = [
    'selectSource',
    'selectVideo',
    'selectAudio',
    'selectSubtitles'
] as const;

export type DetailSelectorName = (typeof DETAIL_SELECTORS)[number];
