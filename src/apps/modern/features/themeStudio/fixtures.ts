/**
 * Deterministic synthetic media for the preview.
 *
 * Synthetic, not sampled from the user's library, for three reasons: the preview must render
 * identically for everyone (so a screenshot means something), it must work before a server is
 * reachable (RFC-0007 and the Studio brief both require no server connection), and a preview that
 * showed real titles would leak library contents into every shared screenshot of a theme.
 *
 * No image URLs at all. `MediaCard` renders its placeholder path when `imageUrl` is absent, which is
 * both the network-free option and the one that actually shows what a theme does to surfaces,
 * radii and typography rather than hiding it behind artwork.
 */

export interface PreviewItem {
    id: string;
    title: string;
    subtitle: string;
    /** 0-100, or `undefined` for an item with no resume position. */
    progressPercent?: number;
}

export interface PreviewShelf {
    id: string;
    title: string;
    items: readonly PreviewItem[];
}

function item(
    id: string,
    title: string,
    subtitle: string,
    progressPercent?: number
): PreviewItem {
    return { id, title, subtitle, progressPercent };
}

export const PREVIEW_SHELVES: readonly PreviewShelf[] = [
    {
        id: 'continue-watching',
        title: 'Continue watching',
        items: [
            item('cw-1', 'The Quiet Harbour', 'S2 · E4', 62),
            item('cw-2', 'Northern Lights', '1h 54m', 18),
            item('cw-3', 'Glasshouse', 'S1 · E9', 91),
            item('cw-4', 'Meridian', '2h 07m', 4)
        ]
    },
    {
        id: 'latest-media',
        title: 'Recently added',
        items: [
            item('lm-1', 'Salt and Stone', '2024'),
            item('lm-2', 'Ptarmigan', '2023'),
            item('lm-3', 'The Long Wait', '2025'),
            item('lm-4', 'Cartographer', '2022'),
            item('lm-5', 'Tessera', '2024'),
            item('lm-6', 'Ninth Wave', '2021')
        ]
    }
];

export const PREVIEW_LIBRARY_ITEMS: readonly PreviewItem[] = [
    item('lib-1', 'Aurora Bay', '2024'),
    item('lib-2', 'Between Tides', '2023'),
    item('lib-3', 'Cold Comfort', '2022'),
    item('lib-4', 'Driftwood', '2025'),
    item('lib-5', 'Estuary', '2021'),
    item('lib-6', 'Fathom', '2024'),
    item('lib-7', 'Groundswell', '2020'),
    item('lib-8', 'Harbourmaster', '2023'),
    item('lib-9', 'Isthmus', '2024'),
    item('lib-10', 'Jetsam', '2022'),
    item('lib-11', 'Keelhaul', '2025'),
    item('lib-12', 'Landfall', '2021')
];

export const PREVIEW_DETAIL = {
    title: 'The Quiet Harbour',
    tagline: 'Season 2 · 8 episodes · 2024',
    overview:
        'A lighthouse keeper and a cartographer spend one winter arguing about where the coastline actually is. Nothing is resolved. Everything is beautifully lit.',
    facts: [
        { label: 'Runtime', value: '48m' },
        { label: 'Video', value: '4K HDR' },
        { label: 'Audio', value: 'E-AC-3 5.1' },
        { label: 'Subtitles', value: '3 tracks' }
    ]
} as const;

export const PREVIEW_NAV_ITEMS = [
    { id: 'home', label: 'Home' },
    { id: 'movies', label: 'Films' },
    { id: 'shows', label: 'Series' },
    { id: 'music', label: 'Music' },
    { id: 'settings', label: 'Settings' }
] as const;
