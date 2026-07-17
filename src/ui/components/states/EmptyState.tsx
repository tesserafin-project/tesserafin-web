import React, { type FC, type ReactNode } from 'react';

import './states.scss';

export interface EmptyStateProps {
    title: string;
    description?: string;
    icon?: ReactNode;
    actionLabel?: string;
    onAction?: () => void;
    className?: string;
}

/**
 * Standard "nothing here" placeholder (RFC-0005 §3.3/§6 `EmptyState`) — optional icon, a title,
 * an optional description, and an optional single action. Public slot: `data-rf-slot="state-empty"`.
 */
export const EmptyState: FC<EmptyStateProps> = ({
    title,
    description,
    icon,
    actionLabel,
    onAction,
    className
}) => {
    const classes = ['rf-empty-state', className].filter(Boolean).join(' ');

    return (
        <div className={classes} data-rf-slot='state-empty'>
            {icon && (
                <span className='rf-empty-state__icon' aria-hidden='true'>
                    {icon}
                </span>
            )}
            <p className='rf-empty-state__title'>{title}</p>
            {description && (
                <p className='rf-empty-state__description'>{description}</p>
            )}
            {actionLabel && onAction && (
                <button
                    type='button'
                    className='rf-empty-state__action'
                    onClick={onAction}
                >
                    {actionLabel}
                </button>
            )}
        </div>
    );
};

export default EmptyState;
