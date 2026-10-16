import React, { type FC } from 'react';

import './Ambient.scss';

export interface AmbientProps {
    /** An image the page ALREADY shows. The layer must never be the reason a request is made. */
    src: string;
}

/**
 * The page-wide atmosphere a recipe's `backdrop: 'ambient'` asks for (RFC-0007 §4.7): the given
 * artwork, blurred and dimmed, fixed behind the whole page. Decorative, so it has no accessible
 * name. Callers render it only when the recipe asks and an image exists; it decides nothing.
 */
export const Ambient: FC<AmbientProps> = ({ src }) => (
    <img className='rf-ambient' src={src} alt='' />
);

export default Ambient;
