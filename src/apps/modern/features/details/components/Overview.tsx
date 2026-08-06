import React, { useMemo, useState, type FC } from 'react';
import DOMPurify from 'dompurify';
import markdownIt from 'markdown-it';

import globalize from 'lib/globalize';

/**
 * The overview.
 *
 * Same pipeline as the legacy route: markdown, then DOMPurify. The clamp control is rendered
 * unconditionally rather than from a `scrollHeight`/`offsetHeight` comparison — the legacy
 * measurement is not reproducible outside a laid-out browser (contract §15.3 records that it was
 * never characterized), and a control whose visibility depends on measurement cannot be asserted.
 * It is a `<button>` with a real accessible name, so it is keyboard-reachable either way.
 */
const Overview: FC<{ markdown: string }> = ({ markdown }) => {
    const [expanded, setExpanded] = useState(false);

    const html = useMemo(
        () => DOMPurify.sanitize(markdownIt({ html: true }).render(markdown)),
        [markdown]
    );

    if (!html) return null;

    return (
        <>
            <div
                className={expanded ? undefined : 'detail-clamp-text'}
                // The content is server-authored markdown, sanitised by DOMPurify immediately above.
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: html }}
            />
            <button type='button' onClick={() => setExpanded(!expanded)}>
                {globalize.translate(expanded ? 'ShowLess' : 'ShowMore')}
            </button>
        </>
    );
};

export default Overview;
