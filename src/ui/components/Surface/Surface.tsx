import React, { type FC, type HTMLAttributes, type ReactNode } from 'react';

import './Surface.scss';

export type SurfaceVariant = 'glass' | 'opaque';

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
    /** `'glass'` renders the frosted treatment (RFC-0005 §8.2); `'opaque'` is the plain, non-frosted surface. */
    variant?: SurfaceVariant;
    children?: ReactNode;
    className?: string;
}

/**
 * Surface primitive (RFC-0005 §6 `Surface`), deliberately token-driven: the same CSS renders flat
 * under Reefin Classic (`--rf-backdrop-filter-md: none`, opaque `--rf-color-surface`) and frosted
 * under Reefin Glass (`--rf-backdrop-filter-md: blur(16px)`, translucent `--rf-color-surface`) —
 * this component never branches on the active theme. `variant="glass"` (the default) is the
 * frosted-glass treatment (RFC-0005 §8.2); `variant="opaque"` is the plain surface. Public slot:
 * `data-rf-slot="surface"`.
 */
export const Surface: FC<SurfaceProps> = ({
    variant = 'glass',
    className,
    children,
    ...rest
}) => {
    const classes = [
        'rf-surface',
        variant === 'glass' && 'rf-surface--glass',
        variant === 'opaque' && 'rf-surface--opaque',
        className
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <div className={classes} data-rf-slot='surface' {...rest}>
            {children}
        </div>
    );
};

export default Surface;
