import React, { type CSSProperties, type FC, type ReactNode } from 'react';

import './MediaGrid.scss';

export interface MediaGridProps {
    /** `MediaCard` elements (or any content) to lay out in the responsive grid. */
    children: ReactNode;
    /** Maps to `--rf-spacing-*` gap between cards. */
    density?: 'comfortable' | 'compact';
    /**
     * CSS length overriding the per-item minimum column width (`--rf-media-grid-min-item-width`).
     * Defaults to 160px, sized for `poster` aspect `MediaCard`s (same default already used by
     * `LoadingState`'s `grid` variant skeleton); pass a wider value for `backdrop`/`square` grids.
     */
    minItemWidth?: string;
    className?: string;
    id?: string;
    /** Accessible name for the grid region when no visible heading already labels it. */
    'aria-label'?: string;
}

/**
 * Responsive `MediaCard` grid (RFC-0005 §6 `MediaGrid`) — a plain `CSS Grid` container with
 * `repeat(auto-fill, minmax(...))` columns, so the layout adapts to available width without
 * hardcoded breakpoints. A simple container, not a 2D roving-tabindex widget: cards keep their own
 * natural tab order and `:focus-visible` styling, compatible with the generic 10-foot navigation
 * socle (RFC-0005 §6). Public slot: `data-rf-slot="media-grid"`.
 */
export const MediaGrid: FC<MediaGridProps> = ({
    children,
    density = 'comfortable',
    minItemWidth,
    className,
    id,
    'aria-label': ariaLabel
}) => {
    const classes = ['rf-media-grid', `rf-media-grid--${density}`, className]
        .filter(Boolean)
        .join(' ');

    const style = minItemWidth
        ? ({
              '--rf-media-grid-min-item-width': minItemWidth
          } as CSSProperties)
        : undefined;

    return (
        <div
            className={classes}
            data-rf-slot='media-grid'
            role='group'
            aria-label={ariaLabel}
            id={id}
            style={style}
        >
            {children}
        </div>
    );
};

export default MediaGrid;
