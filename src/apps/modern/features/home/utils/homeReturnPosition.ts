const SHELF = '[data-rf-slot="media-shelf"][id]';
const CARD = 'a[data-rf-slot="media-card"][href]';
const SCROLLER = '.rf-media-shelf__scroller';

export interface HomeReturnPosition {
    y: number;
    rows: Record<string, number>;
    shelf: string;
    shelfIndex: number;
    href: string;
    cardIndex: number;
}

// Session-local and bounded. No account data/URLs are written to browser storage.
const positions = new Map<string, HomeReturnPosition>();
const MAX_POSITIONS = 20;

export const homeReturnKey = (
    server: string,
    user: string,
    tab: number,
    entry: string
) => JSON.stringify([server, user, tab, entry]);

export function rememberHomePosition(
    key: string,
    root: HTMLElement,
    card: HTMLAnchorElement
) {
    const shelves = [...root.querySelectorAll<HTMLElement>(SHELF)];
    const shelf = card.closest<HTMLElement>(SHELF);
    if (!shelf) return;
    const rows: Record<string, number> = {};
    for (const row of shelves) {
        rows[row.id] =
            row.querySelector<HTMLElement>(SCROLLER)?.scrollLeft ?? 0;
    }
    positions.delete(key);
    positions.set(key, {
        y: window.scrollY,
        rows,
        shelf: shelf.id,
        shelfIndex: shelves.indexOf(shelf),
        href: card.getAttribute('href')!,
        cardIndex: [...shelf.querySelectorAll(CARD)].indexOf(card)
    });
    if (positions.size > MAX_POSITIONS)
        positions.delete(positions.keys().next().value!);
}

export const readHomePosition = (key: string) => positions.get(key);
export const forgetHomePosition = (key: string) => positions.delete(key);

export function restoreHomePosition(
    root: HTMLElement,
    saved: HomeReturnPosition
) {
    const shelves = [...root.querySelectorAll<HTMLElement>(SHELF)];
    for (const shelf of shelves) {
        const scroller = shelf.querySelector<HTMLElement>(SCROLLER);
        if (scroller && saved.rows[shelf.id] !== undefined) {
            scroller.scrollTo({
                left: saved.rows[shelf.id],
                behavior: 'instant'
            });
        }
    }
    window.scrollTo({ top: saved.y, behavior: 'instant' });
    // Stable section identity survives reordering/translations; href disambiguates duplicate titles.
    const shelf =
        shelves.find((row) => row.id === saved.shelf) ??
        shelves[Math.min(saved.shelfIndex, shelves.length - 1)];
    const cards = [...(shelf?.querySelectorAll<HTMLAnchorElement>(CARD) ?? [])];
    const target =
        cards.find((card) => card.getAttribute('href') === saved.href) ??
        cards[Math.min(saved.cardIndex, cards.length - 1)] ??
        root.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    target?.focus({ preventScroll: true });
    // A removed row/card or a changed recipe can put the replacement outside the viewport.
    // Keep exact offsets when it is already visible; reveal it only when necessary.
    const box = target?.getBoundingClientRect();
    if (
        box &&
        (box.top < 0 ||
            box.bottom > window.innerHeight ||
            box.left < 0 ||
            box.right > window.innerWidth)
    ) {
        target?.scrollIntoView({
            block: 'nearest',
            inline: 'nearest',
            behavior: 'instant'
        });
    }
}
