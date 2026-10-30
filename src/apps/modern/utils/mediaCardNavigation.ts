/**
 * The media card a plain left click is about to open, or nothing when the browser should handle the
 * click: modified and new-tab clicks stay native, as do links outside the hash router.
 */
export function plainCardNavigation(event: MouseEvent, container: HTMLElement) {
    if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
    )
        return undefined;
    const card = (event.target as Element)?.closest<HTMLAnchorElement>(
        'a[data-rf-slot="media-card"][href]'
    );
    const href = card?.getAttribute('href');
    if (
        !card ||
        !container.contains(card) ||
        !href?.startsWith('#/') ||
        (card.target && card.target !== '_self') ||
        card.hasAttribute('download')
    )
        return undefined;
    return { card, href };
}
