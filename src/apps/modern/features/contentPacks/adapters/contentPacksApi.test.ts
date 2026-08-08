/**
 * Every one of the ten generated `ContentPacksApi` operations, judged by the request axios was
 * actually asked to make (#138 §9.2).
 *
 * The URL and method are read off the axios call, not off the source, for the same reason
 * `features/library/api/libraryDestinationQueries.test.ts` does it: a test that re-states the
 * adapter's own expression proves only that the expression exists. Reading the wire request proves
 * the operation, the path parameters and the query parameters.
 */
import type { AxiosInstance } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { TesserafinApi } from 'lib/tesserafin-sdk';

import {
    addContentPackItem,
    createContentPack,
    deleteContentPack,
    fetchContentPack,
    fetchContentPackItems,
    fetchContentPacks,
    fetchContentPacksForItem,
    removeContentPackItem,
    reorderContentPacks,
    updateContentPack
} from './contentPacksApi';

const createMockApi = (request: ReturnType<typeof vi.fn>): TesserafinApi =>
    new TesserafinApi(
        'https://example.com',
        { name: 'Tesserafin Web', version: '1.0.0' },
        { name: 'Test Device', id: 'device-1' },
        'test-token',
        { request, defaults: {} } as unknown as AxiosInstance
    );

const respond = (data: unknown) => vi.fn().mockResolvedValue({ data });

const callOf = (request: ReturnType<typeof vi.fn>) =>
    request.mock.calls[0][0] as {
        url: string;
        method: string;
        data?: string;
    };

/** An opaque identifier with punctuation in it, so a helper that "cleaned it up" would show. */
const PACK_ID = 'pack:7f3a-9b/Q';
const ITEM_ID = 'item:41c0-8e/Z';

describe('read operations', () => {
    it('getContentPacks hits /ContentPacks and returns the server list unchanged', async () => {
        const packs = [
            { Id: 'b', Name: 'Beta', SortOrder: 0, VisibleItemCount: 2 },
            { Id: 'a', Name: 'Alpha', SortOrder: 1, VisibleItemCount: 9 }
        ];
        const request = respond(packs);

        const result = await fetchContentPacks(createMockApi(request));

        const call = callOf(request);
        expect(call.url).toContain('/ContentPacks');
        expect(call.method).toBe('GET');
        // Same array, same order. Not sorted by name, not sorted by SortOrder, not re-counted.
        expect(result).toEqual(packs);
        expect(result.map((pack) => pack.Id)).toEqual(['b', 'a']);
    });

    it('getContentPack puts the opaque id in the path, encoded, and nothing else', async () => {
        const request = respond({ Id: PACK_ID, Name: 'Road trip' });

        await fetchContentPack(createMockApi(request), PACK_ID);

        const call = callOf(request);
        expect(call.method).toBe('GET');
        expect(call.url).toContain(
            `/ContentPacks/${encodeURIComponent(PACK_ID)}`
        );
        expect(call.url).not.toContain('/Items');
    });

    it('getContentPackItems carries the paging window and asks for images and user data', async () => {
        const request = respond({
            Items: [{ Id: 'i1' }],
            TotalRecordCount: 31,
            StartIndex: 20
        });

        const page = await fetchContentPackItems(createMockApi(request), {
            packId: PACK_ID,
            startIndex: 20,
            limit: 10
        });

        const call = callOf(request);
        expect(call.method).toBe('GET');
        expect(call.url).toContain(
            `/ContentPacks/${encodeURIComponent(PACK_ID)}/Items`
        );
        expect(call.url).toContain('startIndex=20');
        expect(call.url).toContain('limit=10');
        expect(call.url).toContain('enableImages=true');
        expect(call.url).toContain('enableUserData=true');

        expect(page).toEqual({
            items: [{ Id: 'i1' }],
            totalRecordCount: 31,
            startIndex: 20
        });
    });

    it('getContentPackItems normalises an absent page body without inventing a total', async () => {
        const request = respond({});

        const page = await fetchContentPackItems(createMockApi(request), {
            packId: PACK_ID,
            startIndex: 0,
            limit: 50
        });

        expect(page).toEqual({
            items: [],
            totalRecordCount: 0,
            startIndex: 0
        });
    });

    it('getContentPacksForItem hits the item-scoped route, not the pack-scoped one', async () => {
        const request = respond([{ Id: PACK_ID, Name: 'Road trip' }]);

        await fetchContentPacksForItem(createMockApi(request), ITEM_ID);

        const call = callOf(request);
        expect(call.method).toBe('GET');
        expect(call.url).toContain(
            `/Items/${encodeURIComponent(ITEM_ID)}/ContentPacks`
        );
    });
});

describe('write operations', () => {
    it('createContentPack POSTs the name and description', async () => {
        const request = respond({ Id: PACK_ID, Name: 'Road trip' });

        await createContentPack(createMockApi(request), {
            Name: 'Road trip',
            Description: 'Long drives'
        });

        const call = callOf(request);
        expect(call.method).toBe('POST');
        expect(call.url).toContain('/ContentPacks');
        expect(JSON.parse(call.data as string)).toEqual({
            Name: 'Road trip',
            Description: 'Long drives'
        });
    });

    it('updateContentPack POSTs to the same pack id it was given', async () => {
        const request = respond({ Id: PACK_ID, Name: 'Road trip 2' });

        await updateContentPack(createMockApi(request), PACK_ID, {
            Name: 'Road trip 2'
        });

        const call = callOf(request);
        expect(call.url).toContain(
            `/ContentPacks/${encodeURIComponent(PACK_ID)}`
        );
        expect(JSON.parse(call.data as string)).toEqual({
            Name: 'Road trip 2'
        });
    });

    it('reorderContentPacks sends the whole ordering, in the caller order', async () => {
        const request = respond(undefined);

        await reorderContentPacks(createMockApi(request), ['c', 'a', 'b']);

        const call = callOf(request);
        expect(call.url).toContain('/ContentPacks/Order');
        expect(JSON.parse(call.data as string)).toEqual({
            PackIds: ['c', 'a', 'b']
        });
    });

    it('deleteContentPack DELETEs the pack route', async () => {
        const request = respond(undefined);

        await deleteContentPack(createMockApi(request), PACK_ID);

        const call = callOf(request);
        expect(call.method).toBe('DELETE');
        expect(call.url).toContain(
            `/ContentPacks/${encodeURIComponent(PACK_ID)}`
        );
        expect(call.url).not.toContain('/Items');
    });

    it('addContentPackItem POSTs the membership route and asserts no provenance', async () => {
        const request = respond(undefined);

        await addContentPackItem(createMockApi(request), PACK_ID, ITEM_ID);

        const call = callOf(request);
        expect(call.method).toBe('POST');
        expect(call.url).toContain(
            `/ContentPacks/${encodeURIComponent(PACK_ID)}/Items/${encodeURIComponent(ITEM_ID)}`
        );
        // Provenance is the server's documented `Manual` default; the Web does not assert one.
        expect(call.url).not.toContain('provenance');
    });

    it('removeContentPackItem DELETEs exactly one membership', async () => {
        const request = respond(undefined);

        await removeContentPackItem(createMockApi(request), PACK_ID, ITEM_ID);

        const call = callOf(request);
        expect(call.method).toBe('DELETE');
        expect(call.url).toContain(
            `/ContentPacks/${encodeURIComponent(PACK_ID)}/Items/${encodeURIComponent(ITEM_ID)}`
        );
    });
});

describe('the opaque identifier survives', () => {
    it('is never parsed, split or rewritten on the way to the wire', async () => {
        const request = respond({ Id: PACK_ID, Name: 'Road trip' });

        await fetchContentPack(createMockApi(request), PACK_ID);

        const { url } = callOf(request);
        const path = url.slice(url.indexOf('/ContentPacks'));
        expect(decodeURIComponent(path)).toBe(`/ContentPacks/${PACK_ID}`);
    });
});
