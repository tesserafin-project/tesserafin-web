import React, { type FC } from 'react';

import './Pagination.scss';

export interface PaginationProps {
    /** 1-indexed current page. */
    page: number;
    totalPages: number;
    onPreviousPage: () => void;
    onNextPage: () => void;
    /** Label of the "previous page" button; callers own translation. Defaults to English. */
    previousLabel?: string;
    /** Label of the "next page" button; callers own translation. Defaults to English. */
    nextLabel?: string;
    /** Formats the current page status text; receives the 1-indexed page and total page count. */
    pageLabel?: (page: number, totalPages: number) => string;
    /** Accessible name for the `nav` landmark. Defaults to English. */
    'aria-label'?: string;
    className?: string;
    id?: string;
}

const defaultPageLabel = (page: number, totalPages: number) =>
    `Page ${page} of ${totalPages}`;

/**
 * Simple controlled pagination (RFC-0005 §6) — previous/next buttons and a page status text, no
 * page-number list. A `nav` landmark wraps the control; button labels and the page-status formatter
 * are props with English defaults so callers own translation (`src/ui` never imports `globalize`,
 * per the design-system boundary). Public slot: `data-rf-slot="pagination"`.
 */
export const Pagination: FC<PaginationProps> = ({
    page,
    totalPages,
    onPreviousPage,
    onNextPage,
    previousLabel = 'Previous',
    nextLabel = 'Next',
    pageLabel = defaultPageLabel,
    'aria-label': ariaLabel = 'Pagination',
    className,
    id
}) => {
    const classes = ['rf-pagination', className].filter(Boolean).join(' ');

    return (
        <nav
            className={classes}
            data-rf-slot='pagination'
            aria-label={ariaLabel}
            id={id}
        >
            <button
                type='button'
                className='rf-pagination__button'
                onClick={onPreviousPage}
                disabled={page <= 1}
            >
                {previousLabel}
            </button>
            <span className='rf-pagination__status' aria-live='polite'>
                {pageLabel(page, totalPages)}
            </span>
            <button
                type='button'
                className='rf-pagination__button'
                onClick={onNextPage}
                disabled={page >= totalPages}
            >
                {nextLabel}
            </button>
        </nav>
    );
};

export default Pagination;
