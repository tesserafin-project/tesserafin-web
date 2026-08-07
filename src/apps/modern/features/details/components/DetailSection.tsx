import React, { type FC, type ReactNode } from 'react';

import type {
    DetailSectionColumn,
    DetailSectionName
} from '../constants/sections';

interface DetailSectionProps {
    /** The frozen contract's name for this surface. Rendered as `data-detail-section`. */
    name: DetailSectionName;
    /**
     * The grid column, decided by the composition rather than by this surface's identity.
     * Defaults to `full`; the fixed header block and a leading primary-column family pass `hero`.
     */
    column?: DetailSectionColumn;
    /**
     * The PUBLISHED content family this surface belongs to, rendered as `data-rf-slot`.
     *
     * Only theme-controllable surfaces carry one: it is the vocabulary a theme is allowed to know
     * about. The fixed header surfaces pass nothing, so a stylesheet or a test cannot address them
     * as if they were a recipe slot.
     */
    slot?: string;
    /** Already-translated heading text, or nothing for a section with no heading. */
    heading?: string;
    /** Suppress the heading element while keeping the section. `renderChildren` does this for
     * albums and seasons, and the frozen fixture records no heading for those classes. */
    headingHidden?: boolean;
    children?: ReactNode;
}

/**
 * One semantic section of the Item Details page.
 *
 * `data-detail-section` is a CHARACTERIZATION HOOK, not a theming surface: it lets the frozen P5
 * fixture judge the migrated route without being rewritten. Nothing styles it, it is not published
 * presentation vocabulary, and the Step 2 recipe binding does not read it. See
 * `docs/tesserafin/item-details-migration.md` §3.
 *
 * The heading is a real `h2` inside a real `section`, so the page has one landmark and one heading
 * per surface — the accessibility correction `MAY CHANGE` #1 permits and Phase 4 requires.
 */
const DetailSection: FC<DetailSectionProps> = ({
    name,
    column = 'full',
    slot,
    heading,
    headingHidden,
    children
}) => (
    <section
        className='rf-item-details__section'
        data-detail-section={name}
        data-detail-slot={column}
        data-rf-slot={slot}
        aria-label={heading && headingHidden ? heading : undefined}
    >
        {heading && !headingHidden ? (
            <h2
                className='rf-item-details__section-title'
                data-detail-heading={name}
            >
                {heading}
            </h2>
        ) : null}
        {children}
    </section>
);

export default DetailSection;
