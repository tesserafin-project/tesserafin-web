// @vitest-environment jsdom
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, expect, it, vi } from 'vitest';

import type { TrackSelection } from '../hooks/useTrackSelection';
import TrackSelections from './TrackSelections';

vi.mock('lib/globalize', () => ({
    default: { translate: (key: string) => key }
}));

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** WEB-UX-1-R1 — one version is no choice, so Version is only shown when there are two. */
function versionHidden(sources: string[]): boolean {
    const container = document.createElement('div');
    const tracks = {
        sources: sources.map((value) => ({ value, label: value })),
        videoTracks: [],
        audioTracks: [],
        subtitleTracks: [],
        selectedSourceId: sources[0] ?? '',
        selectedVideoIndex: '',
        selectedAudioIndex: '',
        selectedSubtitleIndex: ''
    } as unknown as TrackSelection;
    act(() =>
        createRoot(container).render(<TrackSelections tracks={tracks} />)
    );
    return (
        container.querySelector('[data-detail-select="selectSource"]')
            ?.parentElement?.hidden ?? false
    );
}

describe('TrackSelections — Version', () => {
    it('is hidden with a single version', () => {
        expect(versionHidden(['a'])).toBe(true);
    });

    it('is shown when there is a choice', () => {
        expect(versionHidden(['a', 'b'])).toBe(false);
    });
});
