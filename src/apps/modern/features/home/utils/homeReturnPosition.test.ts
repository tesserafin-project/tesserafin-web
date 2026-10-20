// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    forgetHomePosition,
    homeReturnKey,
    readHomePosition,
    rememberHomePosition,
    restoreHomePosition
} from './homeReturnPosition';

let root: HTMLDivElement;
function shelf(id: string, hrefs: string[]) {
    const row = document.createElement('section');
    row.id = id;
    row.dataset.rfSlot = 'media-shelf';
    const strip = document.createElement('div');
    strip.className = 'rf-media-shelf__scroller';
    strip.scrollTo = vi.fn((options?: ScrollToOptions | number) => {
        if (options && typeof options !== 'number')
            strip.scrollLeft = options.left ?? 0;
    });
    row.append(strip);
    for (const href of hrefs) {
        const card = document.createElement('a');
        card.dataset.rfSlot = 'media-card';
        card.href = href;
        card.textContent = 'Same title';
        strip.append(card);
    }
    root.append(row);
    return row;
}
beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
    root.remove();
});

describe('Home recovery identity, bounded state and fallbacks', () => {
    it('uses server, user, tab and history entry without delimiter collisions', () => {
        const key = homeReturnKey('s', 'u', 0, 'h');
        expect([
            homeReturnKey('other', 'u', 0, 'h'),
            homeReturnKey('s', 'other', 0, 'h'),
            homeReturnKey('s', 'u', 1, 'h'),
            homeReturnKey('s', 'u', 0, 'other')
        ]).not.toContain(key);
        expect(homeReturnKey('s|u', 'v', 0, 'h')).not.toBe(
            homeReturnKey('s', 'u|v', 0, 'h')
        );
    });
    it('keeps only twenty most recently recorded entries', () => {
        const row = shelf('bounded', ['#/details?id=1']);
        const card = row.querySelector('a')!;
        for (let index = 0; index < 21; index++)
            rememberHomePosition(`bounded-${index}`, root, card);
        expect(readHomePosition('bounded-0')).toBeUndefined();
        expect(readHomePosition('bounded-20')).toBeDefined();
        for (let index = 0; index < 21; index++)
            forgetHomePosition(`bounded-${index}`);
    });
    it('follows a stable shelf id after reordering, ignoring identical titles and hrefs elsewhere', () => {
        shelf('first', ['#/details?id=same']);
        const row = shelf('second', [
            '#/details?id=other',
            '#/details?id=same'
        ]);
        const card = row.querySelectorAll('a')[1];
        rememberHomePosition('reorder', root, card);
        root.prepend(row);
        restoreHomePosition(root, readHomePosition('reorder')!);
        expect(document.activeElement).toBe(card);
        forgetHomePosition('reorder');
    });
    it('chooses a surviving nearby shelf when the original section disappears', () => {
        shelf('first', ['#/details?id=first']);
        const row = shelf('gone', ['#/details?id=gone']);
        const nearby = shelf('nearby', ['#/details?id=nearby']);
        rememberHomePosition('gone', root, row.querySelector('a')!);
        row.remove();
        restoreHomePosition(root, readHomePosition('gone')!);
        expect(document.activeElement).toBe(nearby.querySelector('a'));
        forgetHomePosition('gone');
    });
    it('focuses the selected tab when no card survives', () => {
        const row = shelf('gone', ['#/details?id=gone']);
        rememberHomePosition('empty', root, row.querySelector('a')!);
        row.remove();
        const tab = document.createElement('button');
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', 'true');
        root.append(tab);
        restoreHomePosition(root, readHomePosition('empty')!);
        expect(document.activeElement).toBe(tab);
        forgetHomePosition('empty');
    });
    it('preserves signed RTL offsets and uses preventScroll for focus', () => {
        const row = shelf('rtl', ['#/details?id=1']);
        const strip = row.firstElementChild as HTMLElement;
        strip.scrollLeft = -410;
        const card = row.querySelector('a')!;
        const focus = vi.spyOn(card, 'focus');
        rememberHomePosition('rtl', root, card);
        strip.scrollLeft = 0;
        restoreHomePosition(root, readHomePosition('rtl')!);
        expect(strip.scrollLeft).toBe(-410);
        expect(focus).toHaveBeenCalledWith({ preventScroll: true });
        forgetHomePosition('rtl');
    });
});
