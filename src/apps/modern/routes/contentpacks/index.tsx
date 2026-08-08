import React, { type FC } from 'react';

/**
 * `/contentpacks` — the content-pack mosaic (#138).
 *
 * Deliberately thin: this module exists to BE the code-split boundary. Everything it needs lives
 * in `apps/modern/features/contentPacks`, which is why navigating here is what first requests the
 * route chunk, and why neither the feature nor the generated `ContentPacksApi` it imports reaches
 * the initial or start-up delivery graph.
 */
const ContentPacks: FC = () => <div data-content-packs='list' />;

export default ContentPacks;
