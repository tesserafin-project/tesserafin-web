import React, { type FC, type HTMLAttributes, type ReactNode } from 'react';

import { usePresentation } from '../../presentation/PresentationContext';

import './Surface.scss';

export type SurfaceVariant = 'glass' | 'opaque';

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
    /**
     * `'glass'` renders the frosted treatment (RFC-0005 §8.2); `'opaque'` is the plain, non-frosted
     * surface.
     *
     * **Omit it to let the active theme decide** (RFC-0007 §4.6): the variant then comes from the
     * theme's `presentation.surface.variant`, which is what makes that contract field do anything.
     * An explicit prop still wins — a call site that genuinely needs one treatment (a modal scrim,
     * a print view) must be able to say so, and a theme overriding that would be a theme deciding
     * layout semantics rather than presentation.
     */
    variant?: SurfaceVariant;
    children?: ReactNode;
    className?: string;
}

/**
 * Surface primitive (RFC-0005 §6 `Surface`), deliberately token-driven: the same CSS renders flat
 * under Tesserafin Classic (`--rf-backdrop-filter-md: none`, opaque `--rf-color-surface`) and frosted
 * under Tesserafin Glass (`--rf-backdrop-filter-md: blur(16px)`, translucent `--rf-color-surface`) —
 * this component never branches on the active theme. `variant="glass"` (the default) is the
 * frosted-glass treatment (RFC-0005 §8.2); `variant="opaque"` is the plain surface. Public slot:
 * `data-rf-slot="surface"`.
 */
export const Surface: FC<SurfaceProps> = ({
    variant: variantProp,
    className,
    children,
    ...rest
}) => {
    const presentation = usePresentation();
    const variant = variantProp ?? presentation.surface.variant;
    const classes = [
        'rf-surface',
        variant === 'glass' && 'rf-surface--glass',
        variant === 'opaque' && 'rf-surface--opaque',
        className
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <div
            className={classes}
            data-rf-slot='surface'
            data-rf-surface-border={presentation.surface.border}
            data-rf-surface-elevation={presentation.surface.elevation}
            {...rest}
        >
            {children}
        </div>
    );
};

export default Surface;
