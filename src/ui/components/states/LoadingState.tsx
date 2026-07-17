import React, { type FC } from 'react';

import './states.scss';

export type LoadingStateVariant = 'shelf' | 'grid' | 'block';

export interface LoadingStateProps {
    /**
     * `shelf` mirrors a horizontal `MediaShelf` of cards, `grid` a `MediaGrid` page, `block` a
     * single rectangular region (e.g. a hero or a form).
     */
    variant?: LoadingStateVariant;
    /** Number of skeleton placeholders to render for `shelf`/`grid`. */
    itemCount?: number;
    /** Screen-reader text for the busy region; callers own translation. */
    label?: string;
    className?: string;
}

const DEFAULT_ITEM_COUNT = 6;

/**
 * Standard loading placeholder (RFC-0005 §3.3/§6 `LoadingState`) — skeleton blocks sized per
 * `variant`, exposed as one `role="status"` busy region. Public slot: `data-rf-slot="state-loading"`.
 */
export const LoadingState: FC<LoadingStateProps> = ({
    variant = 'shelf',
    itemCount = DEFAULT_ITEM_COUNT,
    label = 'Loading…',
    className
}) => {
    const classes = [
        'rf-loading-state',
        `rf-loading-state--${variant}`,
        className
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <div
            className={classes}
            data-rf-slot='state-loading'
            role='status'
            aria-busy='true'
            aria-live='polite'
        >
            <span className='rf-loading-state__sr-label'>{label}</span>
            {Array.from({ length: itemCount }, (_, index) => (
                <span
                    key={index}
                    className='rf-loading-state__skeleton'
                    aria-hidden='true'
                />
            ))}
        </div>
    );
};

export default LoadingState;
