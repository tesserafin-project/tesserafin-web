/**
 * The first-run suggestion list from `docs/content-pack-contract.md` §3.7 (#139 gate 3).
 *
 * This is **data**, not a domain enumeration. Nothing in the product may branch on a member of this
 * array: a pack the household typed itself has to behave identically to one that started here, and
 * the moment a code path asks "is this pack called Anime?" the suggestion list has quietly become a
 * taxonomy the server never agreed to. The wizard reads these names to pre-fill editable text
 * fields and then forgets where they came from — every pack, suggested or invented, is created
 * through the same `POST /ContentPacks` call with nothing but a name.
 *
 * Consequently there is no `SuggestedPack` type, no id, no icon and no key: a bare `string[]`
 * cannot accidentally acquire behaviour. Reordering it, shortening it or shipping it empty are all
 * valid product decisions that require no code change anywhere else.
 */
export const SUGGESTED_CONTENT_PACK_NAMES: readonly string[] = [
    'Movies and series',
    'Music',
    'Photos and home video',
    'Sport',
    'Concerts',
    'Theatre and performances',
    'Podcasts',
    'Audiobooks',
    'Anime'
];
