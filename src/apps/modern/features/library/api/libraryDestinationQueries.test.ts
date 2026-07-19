import type { AxiosInstance } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { BaseItemKind, ReefinApi } from 'lib/reefin-sdk';

import {
    fetchLibraryCollections,
    fetchLibraryGenres,
    fetchLibraryStudios,
    fetchLibraryUpcoming,
    UPCOMING_LIMIT
} from './libraryDestinationQueries';

/**
 * Proves each non-Browse destination (and the Studios filter / Upcoming shelf) emits the *actual*
 * Reefin SDK request the design attributes to it — endpoint and params read off the URL axios was
 * called with, not off the source. Same `createMockApi` pattern as `useLibraryItems.test.ts`.
 */
const createMockApi = (request: ReturnType<typeof vi.fn>): ReefinApi =>
    new ReefinApi(
        'https://example.com',
        { name: 'Reefin Web', version: '1.0.0' },
        { name: 'Test Device', id: 'device-1' },
        'test-token',
        { request, defaults: {} } as unknown as AxiosInstance
    );

const mockRequest = () =>
    vi.fn().mockResolvedValue({ data: { Items: [], TotalRecordCount: 0 } });

const urlOf = (request: ReturnType<typeof vi.fn>): string =>
    request.mock.calls[0][0].url as string;

describe('fetchLibraryGenres() — Genres destination', () => {
    it('hits /Genres scoped to the library, not /Items', async () => {
        const request = mockRequest();
        const api = createMockApi(request);

        await fetchLibraryGenres(api, 'user-1', {
            parentId: 'library-1',
            includeItemTypes: [BaseItemKind.Movie]
        });

        const url = urlOf(request);
        expect(url).toContain('/Genres?');
        expect(url).toContain('parentId=library-1');
        expect(url).toContain('includeItemTypes=Movie');
        expect(url).toContain('sortBy=SortName');
        expect(url).toContain('userId=user-1');
    });

    it('scopes to Series for a tvshows library', async () => {
        const request = mockRequest();
        const api = createMockApi(request);

        await fetchLibraryGenres(api, 'user-1', {
            parentId: 'library-2',
            includeItemTypes: [BaseItemKind.Series]
        });

        expect(urlOf(request)).toContain('includeItemTypes=Series');
    });
});

describe('fetchLibraryCollections() — Collections destination', () => {
    it('requests BoxSet items, the whole point of a separate destination', async () => {
        const request = mockRequest();
        const api = createMockApi(request);

        await fetchLibraryCollections(api, 'user-1', {
            parentId: 'library-1',
            startIndex: 0,
            limit: 50
        });

        const url = urlOf(request);
        expect(url).toContain('/Items?');
        expect(url).toContain('includeItemTypes=BoxSet');
        expect(url).toContain('parentId=library-1');
        expect(url).toContain('recursive=true');
        expect(url).toContain('limit=50');
        // A collection is not a movie: the Browse item kinds must not leak in.
        expect(url).not.toContain('includeItemTypes=Movie');
    });
});

describe('fetchLibraryStudios() — Studios filter option list', () => {
    it('hits /Studios scoped to the library', async () => {
        const request = mockRequest();
        const api = createMockApi(request);

        await fetchLibraryStudios(api, 'user-1', {
            parentId: 'library-1',
            includeItemTypes: [BaseItemKind.Movie]
        });

        const url = urlOf(request);
        expect(url).toContain('/Studios?');
        expect(url).toContain('parentId=library-1');
        expect(url).toContain('includeItemTypes=Movie');
    });
});

describe('fetchLibraryUpcoming() — Upcoming shelf of Suggestions', () => {
    it('hits the upcoming-episodes route with the legacy 25-item limit', async () => {
        const request = mockRequest();
        const api = createMockApi(request);

        await fetchLibraryUpcoming(api, 'user-1', { parentId: 'library-2' });

        const url = urlOf(request);
        expect(url).toContain('/Shows/Upcoming?');
        expect(url).toContain('parentId=library-2');
        expect(url).toContain(`limit=${UPCOMING_LIMIT}`);
        expect(url).toContain('fields=AirTime');
    });

    it('forwards an abort signal', async () => {
        const request = mockRequest();
        const api = createMockApi(request);
        const signal = {} as AbortSignal;

        await fetchLibraryUpcoming(
            api,
            'user-1',
            { parentId: 'library-2' },
            { signal }
        );

        expect(request).toHaveBeenCalledWith(
            expect.objectContaining({ signal })
        );
    });
});
