import React, { type FC, type HTMLAttributes, type ReactNode } from 'react';

import './GlassSurface.scss';

export type GlassSurfaceVariant = 'glass' | 'opaque';

export interface GlassSurfaceProps extends HTMLAttributes<HTMLDivElement> {
    /** `'glass'` renders the frosted treatment (RFC-0005 §8.2); `'opaque'` is the plain, non-frosted surface. */
    surface?: GlassSurfaceVariant;
    children?: ReactNode;
    className?: string;
}

/**
 * Frosted-glass surface primitive (RFC-0005 §8.2 `GlassSurface`), deliberately token-driven: the
 * same CSS renders flat under Reefin Classic (`--rf-blur-*: 0`, opaque `--rf-color-surface`) and
 * frosted under Reefin Glass (`--rf-blur-md` > 0, translucent `--rf-color-surface`) — this
 * component never branches on the active theme. Public slot: `data-rf-slot="surface"`.
 */
export const GlassSurface: FC<GlassSurfaceProps> = ({
    surface = 'glass',
    className,
    children,
    ...rest
}) => {
    const classes = [
        'rf-surface',
        surface === 'glass' && 'rf-surface--glass',
        surface === 'opaque' && 'rf-surface--opaque',
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

export default GlassSurface;
