import React, { type FC, type ReactNode } from 'react';

import './MediaShelf.scss';

export interface MediaShelfProps {
    title: string;
    /** Renders a "view all" link next to the title when set. */
    viewAllHref?: string;
    /** Label for the "view all" link; required together with `viewAllHref`. */
    viewAllLabel?: string;
    /** Maps to `--rf-spacing-*` gap/padding between cards. */
    density?: 'comfortable' | 'compact';
    /** `MediaCard` elements (or any content) to lay out in the horizontal scroller. */
    children: ReactNode;
    className?: string;
    id?: string;
}

/**
 * Horizontal media shelf (RFC-0005 §6 `MediaShelf`) — section title, optional "view all" link, and
 * an accessible horizontal-scroll region for `MediaCard` children. No dependency on the legacy
 * `emby-scroller` element; scrolling is native `overflow-x` with optional scroll-snap. Public slot:
 * `data-rf-slot="media-shelf"`.
 */
export const MediaShelf: FC<MediaShelfProps> = ({
    title,
    viewAllHref,
    viewAllLabel,
    density = 'comfortable',
    children,
    className,
    id
}) => {
    const classes = ['rf-media-shelf', className].filter(Boolean).join(' ');
    const headingId = id ? `${id}-heading` : undefined;

    return (
        <section className={classes} data-rf-slot='media-shelf' id={id}>
            <div className='rf-media-shelf__header'>
                <h2 className='rf-media-shelf__title' id={headingId}>
                    {title}
                </h2>
                {viewAllHref && viewAllLabel && (
                    <a className='rf-media-shelf__view-all' href={viewAllHref}>
                        {viewAllLabel}
                    </a>
                )}
            </div>
            <div
                className={`rf-media-shelf__scroller rf-media-shelf__scroller--${density}`}
                role='group'
                aria-labelledby={headingId}
            >
                {children}
            </div>
        </section>
    );
};

export default MediaShelf;
