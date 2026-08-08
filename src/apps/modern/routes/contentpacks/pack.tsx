import React, { type FC } from 'react';

/**
 * `/contentpacks/:packId` — one pack's mixed-media browse (#138).
 *
 * Same code-split boundary rationale as `./index.tsx`. The route parameter is the server's OPAQUE
 * pack identifier and is carried through verbatim: nothing here parses it, derives meaning from
 * it, or reconstructs it from a name.
 */
const ContentPackDetail: FC = () => <div data-content-packs='detail' />;

export default ContentPackDetail;
