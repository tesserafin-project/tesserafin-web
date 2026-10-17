import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('lib/globalize', () => ({
    default: {
        translate: (key: string, ...args: unknown[]) =>
            args.length ? `${key}(${args.join(',')})` : key
    }
}));
vi.mock('components/apphost', () => ({ appHost: {} }));
vi.mock('lib/jellyfin-apiclient', () => ({ ServerConnections: {} }));
vi.mock('components/router/appRouter', () => ({
    appRouter: {
        getRouteUrl: (item: { Id?: string; Type?: string }) =>
            `#/${item.Type}/${item.Id}`
    }
}));
vi.mock('scripts/datetime', () => ({
    default: {
        toLocaleString: (value: number) => String(value),
        parseISO8601Date: (value: string) => new Date(value),
        toLocaleDateString: () => 'ven. 17 oct.',
        getDisplayTime: () => '21:00'
    }
}));

import { LIVETV_CARD_OPTIONS } from '../constants/liveTvCardOptions';
import { getCardOptionsFromType } from './search';
import { getRowImageAspect, toSearchCardProps } from './searchCardProps';

const image = (id: string, type: string, tag: string) => `${id}/${type}/${tag}`;
const card = (item: BaseItemDto, options = {}) =>
    toSearchCardProps(
        item,
        { showTitle: true, ...options },
        'poster',
        image,
        'srv'
    );

describe('search card props', () => {
    it('captions an episode with its numbered name and links its series', () => {
        const props = card(
            {
                Id: 'e1',
                Type: 'Episode',
                Name: 'Le phare',
                IndexNumber: 2,
                ParentIndexNumber: 1,
                SeriesId: 's1',
                SeriesName: 'Station Nord',
                ImageTags: { Primary: 'p' },
                UserData: { PlayedPercentage: 40, Played: false, Key: 'e1' }
            },
            getCardOptionsFromType('Episode')
        );

        expect(props.title).toBe('S1:E2 - Le phare');
        expect(props.subtitleLinks).toEqual([
            { label: 'Station Nord', href: '#/Series/s1' }
        ]);
        expect(props.href).toBe('#/Episode/e1');
        expect(props.imageUrl).toBe('e1/Primary/p');
        expect(props.progressPercent).toBe(40);
    });

    it('links every album artist of a song', () => {
        const props = card(
            {
                Id: 'a1',
                Type: 'Audio',
                Name: 'Vent du Nord',
                AlbumId: 'al',
                AlbumPrimaryImageTag: 't',
                AlbumArtists: [
                    { Id: 'x', Name: 'Nordic Echo' },
                    { Id: 'y', Name: 'Invité' }
                ]
            },
            getCardOptionsFromType('Audio')
        );

        expect(props.subtitleLinks?.map((link) => link.href)).toEqual([
            '#/MusicArtist/x',
            '#/MusicArtist/y'
        ]);
        expect(props.imageUrl).toBe('al/Primary/t');
    });

    it('prints a continuing series as "year to present"', () => {
        const props = card(
            {
                Id: 's',
                Type: 'Series',
                Name: 'Station Nord',
                ProductionYear: 2022,
                Status: 'Continuing'
            },
            getCardOptionsFromType('Series')
        );

        expect(props.subtitle).toBe('SeriesYearToPresent(2022)');
    });

    it('captions a programme with its air time and links its channel', () => {
        const props = card(
            {
                Id: 'p',
                Type: 'Program',
                Name: 'Journal du Nord',
                ChannelId: 'c',
                ChannelName: 'Nord TV',
                StartDate: '2026-10-17T19:00:00Z',
                ImageTags: { Thumb: 'th', Primary: 'pr' }
            },
            LIVETV_CARD_OPTIONS
        );

        expect(props.title).toBe('Journal du Nord');
        expect(props.subtitle).toBe('ven. 17 oct. 21:00');
        expect(props.subtitleLinks).toEqual([
            { label: 'Nord TV', href: '#/TvChannel/c' }
        ]);
        // Live TV prefers the thumb, as the old row did.
        expect(props.imageUrl).toBe('p/Thumb/th');
    });

    it('drops secondary links on TV, keeping their text', () => {
        const props = toSearchCardProps(
            {
                Id: 'p',
                Type: 'Program',
                Name: 'Journal',
                ChannelId: 'c',
                ChannelName: 'Nord TV',
                StartDate: '2026-10-17T19:00:00Z'
            },
            LIVETV_CARD_OPTIONS,
            'backdrop',
            image,
            'srv',
            true
        );

        expect(props.subtitleLinks).toBeUndefined();
        expect(props.subtitle).toBe('ven. 17 oct. 21:00 · Nord TV');
    });

    it('shapes a row from its median artwork, and honours an explicit shape', () => {
        const ratios = (...values: number[]) =>
            values.map((PrimaryImageAspectRatio) => ({
                PrimaryImageAspectRatio
            }));

        expect(getRowImageAspect(ratios(0.67, 0.68, 1.78), {})).toBe('poster');
        expect(getRowImageAspect(ratios(1.78, 1.77), {})).toBe('backdrop');
        expect(getRowImageAspect(ratios(), {})).toBe('square');
        expect(getRowImageAspect(ratios(1.78), { shape: 'square' })).toBe(
            'square'
        );
    });
});
