/**
 * The canonical query keys (#138 §9.1).
 *
 * Two properties matter and neither is obvious from reading the module: every key is scoped to the
 * acting user, and the four families nest so that a prefix invalidation reaches exactly the
 * intended set and nothing else. Both are asserted here rather than described, because the
 * mutation frontier in `useContentPackMutations.ts` is built entirely out of prefix invalidations.
 */
import { describe, expect, it } from 'vitest';

import { contentPackKeys, ITEMS_KEY_PACK_ID_INDEX } from './contentPackKeys';

const USER = 'user-1';
const OTHER_USER = 'user-2';
const PACK = 'pack:7f3a-9b/Q';
const ITEM = 'item:41c0-8e/Z';
const PAGE = { startIndex: 0, limit: 50 };

/** `queryClient.invalidateQueries({ queryKey })` semantics: a key matches a prefix of itself. */
const isPrefixOf = (prefix: readonly unknown[], key: readonly unknown[]) =>
    prefix.length <= key.length &&
    prefix.every((part, index) => Object.is(part, key[index]));

describe('shape', () => {
    it('scopes every family to the acting user', () => {
        for (const key of [
            contentPackKeys.list(USER),
            contentPackKeys.detail(USER, PACK),
            contentPackKeys.items(USER, PACK, PAGE),
            contentPackKeys.forItem(USER, ITEM)
        ]) {
            expect(key[0]).toBe('User');
            expect(key[1]).toBe(USER);
            expect(key[2]).toBe('ContentPacks');
        }
    });

    it('gives two users disjoint cache entries for the same pack', () => {
        expect(contentPackKeys.detail(USER, PACK)).not.toEqual(
            contentPackKeys.detail(OTHER_USER, PACK)
        );
        expect(
            isPrefixOf(
                contentPackKeys.all(USER),
                contentPackKeys.detail(OTHER_USER, PACK)
            )
        ).toBe(false);
    });

    it('tolerates an absent user, because keys are built before the session exists', () => {
        expect(() => contentPackKeys.list(undefined)).not.toThrow();
        expect(contentPackKeys.detail(undefined, undefined)).toEqual([
            'User',
            undefined,
            'ContentPacks',
            'detail',
            undefined
        ]);
    });

    it('carries the opaque identifiers verbatim', () => {
        expect(contentPackKeys.detail(USER, PACK)).toContain(PACK);
        expect(contentPackKeys.forItem(USER, ITEM)).toContain(ITEM);
    });

    it('puts the paging arguments in the items key', () => {
        const first = contentPackKeys.items(USER, PACK, {
            startIndex: 0,
            limit: 50
        });
        const second = contentPackKeys.items(USER, PACK, {
            startIndex: 50,
            limit: 50
        });
        expect(first).not.toEqual(second);
        expect(first.at(-1)).toEqual({ startIndex: 0, limit: 50 });
    });

    it('exposes the pack-id position the items placeholder reads', () => {
        expect(
            contentPackKeys.items(USER, PACK, PAGE)[ITEMS_KEY_PACK_ID_INDEX]
        ).toBe(PACK);
    });
});

describe('prefix reach — what each invalidation actually hits', () => {
    const listKey = contentPackKeys.list(USER);
    const detailKey = contentPackKeys.detail(USER, PACK);
    const otherDetailKey = contentPackKeys.detail(USER, 'pack-other');
    const pageOne = contentPackKeys.items(USER, PACK, {
        startIndex: 0,
        limit: 50
    });
    const pageTwo = contentPackKeys.items(USER, PACK, {
        startIndex: 50,
        limit: 50
    });
    const otherPackPage = contentPackKeys.items(USER, 'pack-other', PAGE);
    const forItemKey = contentPackKeys.forItem(USER, ITEM);
    const otherItemKey = contentPackKeys.forItem(USER, 'item-other');

    it('itemsForPack reaches every page of that pack and no other pack', () => {
        const prefix = contentPackKeys.itemsForPack(USER, PACK);
        expect(isPrefixOf(prefix, pageOne)).toBe(true);
        expect(isPrefixOf(prefix, pageTwo)).toBe(true);
        expect(isPrefixOf(prefix, otherPackPage)).toBe(false);
    });

    it('forItemAll reaches every item, which is what a delete needs', () => {
        const prefix = contentPackKeys.forItemAll(USER);
        expect(isPrefixOf(prefix, forItemKey)).toBe(true);
        expect(isPrefixOf(prefix, otherItemKey)).toBe(true);
    });

    it('keeps the four families disjoint from each other', () => {
        expect(isPrefixOf(listKey, detailKey)).toBe(false);
        expect(isPrefixOf(listKey, pageOne)).toBe(false);
        expect(isPrefixOf(listKey, forItemKey)).toBe(false);
        expect(isPrefixOf(detailKey, pageOne)).toBe(false);
        expect(isPrefixOf(detailKey, otherDetailKey)).toBe(false);
    });

    it('reaches everything from all(), and nothing outside the slice', () => {
        const prefix = contentPackKeys.all(USER);
        for (const key of [
            listKey,
            detailKey,
            pageOne,
            forItemKey,
            otherPackPage
        ]) {
            expect(isPrefixOf(prefix, key)).toBe(true);
        }
        expect(isPrefixOf(prefix, ['User', USER, 'Items', 'library-1'])).toBe(
            false
        );
    });
});
