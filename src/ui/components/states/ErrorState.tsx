import React, { type FC } from 'react';

import './states.scss';

export interface ErrorStateProps {
    /** Defaults to a generic "something went wrong" title when omitted. */
    title?: string;
    message: string;
    /** Retry button label; the button only renders when both this and `onRetry` are set. */
    retryLabel?: string;
    onRetry?: () => void;
    className?: string;
}

const DEFAULT_TITLE = 'Something went wrong';

/**
 * Standard error placeholder (RFC-0005 §3.3/§6 `ErrorState`) — announced as an alert region, with
 * an optional retry action wired to the caller's refetch callback. Public slot:
 * `data-rf-slot="state-error"`.
 */
export const ErrorState: FC<ErrorStateProps> = ({
    title = DEFAULT_TITLE,
    message,
    retryLabel,
    onRetry,
    className
}) => {
    const classes = ['rf-error-state', className].filter(Boolean).join(' ');

    return (
        <div className={classes} data-rf-slot='state-error' role='alert'>
            <p className='rf-error-state__title'>{title}</p>
            <p className='rf-error-state__message'>{message}</p>
            {retryLabel && onRetry && (
                <button
                    type='button'
                    className='rf-error-state__retry'
                    onClick={onRetry}
                >
                    {retryLabel}
                </button>
            )}
        </div>
    );
};

export default ErrorState;
