/**
 * Media-source, video, audio and subtitle selection.
 *
 * `MUST PRESERVE` #5: the choices, their defaults, the explicit "Off" subtitle option and the
 * `itemHelper.sortTracks` order. The selection is React state, so `Play` reads what is selected AT
 * CLICK TIME rather than a value captured when the page rendered — Phase 5's requirement, and the
 * one thing the legacy DOM-reading version got right only because it re-read the `<select>`.
 *
 * The video selector is offered and disabled, exactly as today. `SUSPECT` #3 records that it is
 * never read; removing a recorded selector is an owner decision, not a migration one, so it stays.
 */
import { useCallback, useMemo, useState } from 'react';

import itemHelper from 'components/itemHelper';

import type { DetailItem } from '../adapters/itemDetailsApi';
import { canSelectMediaSource } from '../utils/itemPredicates';

export interface MediaStream {
    Index: number;
    Type?: string;
    Codec?: string;
    DisplayTitle?: string;
    IsExternal?: boolean;
    IsForced?: boolean;
    IsDefault?: boolean;
    [key: string]: unknown;
}

export interface MediaSource {
    Id?: string;
    Name?: string;
    Type?: string;
    DefaultAudioStreamIndex?: number | null;
    DefaultSubtitleStreamIndex?: number | null;
    MediaStreams?: MediaStream[];
    [key: string]: unknown;
}

export interface TrackOption {
    value: string;
    label: string;
}

export interface TrackSelection {
    /** Whether the whole selector form is offered at all. */
    isOffered: boolean;
    sources: TrackOption[];
    videoTracks: TrackOption[];
    audioTracks: TrackOption[];
    subtitleTracks: TrackOption[];
    selectedSourceId: string;
    selectedVideoIndex: string;
    selectedAudioIndex: string;
    selectedSubtitleIndex: string;
    selectSource: (id: string) => void;
    selectAudio: (index: string) => void;
    selectSubtitle: (index: string) => void;
    /** The media source the play action must target. */
    selectedSource: MediaSource | undefined;
}

const streamsOfType = (source: MediaSource | undefined, type: string) =>
    (source?.MediaStreams ?? []).filter((stream) => stream.Type === type);

function videoLabel(stream: MediaStream): string {
    if (stream.DisplayTitle) return stream.DisplayTitle;
    const parts: string[] = [];
    if (stream.Width && stream.Height) {
        parts.push(`${stream.Height}p`);
    }
    if (stream.Codec) parts.push(String(stream.Codec).toUpperCase());
    return parts.join(' ');
}

export function useTrackSelection(
    item: DetailItem | undefined,
    translate: (key: string) => string
): TrackSelection {
    const sources = useMemo(
        () => (item?.MediaSources ?? []) as MediaSource[],
        [item]
    );
    const isOffered = Boolean(item && canSelectMediaSource(item));

    const defaultSourceId = sources[0]?.Id ?? '';
    const [sourceOverride, setSourceOverride] = useState<string | null>(null);
    const selectedSourceId = sourceOverride ?? defaultSourceId;
    const selectedSource = sources.find(
        (source) => source.Id === selectedSourceId
    );

    const videoStreams = useMemo(
        () => streamsOfType(selectedSource, 'Video'),
        [selectedSource]
    );
    const audioStreams = useMemo(
        () =>
            [...streamsOfType(selectedSource, 'Audio')].sort(
                itemHelper.sortTracks
            ),
        [selectedSource]
    );
    const subtitleStreams = useMemo(
        () =>
            [...streamsOfType(selectedSource, 'Subtitle')].sort(
                itemHelper.sortTracks
            ),
        [selectedSource]
    );

    const defaultAudio =
        selectedSource?.DefaultAudioStreamIndex ?? audioStreams[0]?.Index;
    const defaultSubtitle =
        selectedSource?.DefaultSubtitleStreamIndex == null
            ? -1
            : selectedSource.DefaultSubtitleStreamIndex;

    const [audioOverride, setAudioOverride] = useState<string | null>(null);
    const [subtitleOverride, setSubtitleOverride] = useState<string | null>(
        null
    );

    // A source change resets the track choices to that source's declared defaults, which is what
    // the legacy `change` handler did by re-rendering all three selects.
    const selectSource = useCallback((id: string) => {
        setSourceOverride(id);
        setAudioOverride(null);
        setSubtitleOverride(null);
    }, []);

    return {
        isOffered,
        sources: sources.map((source) => ({
            value: source.Id ?? '',
            label: source.Name ?? ''
        })),
        videoTracks: videoStreams.map((stream) => ({
            value: String(stream.Index),
            label: videoLabel(stream)
        })),
        audioTracks: audioStreams.map((stream) => ({
            value: String(stream.Index),
            label: stream.DisplayTitle ?? String(stream.Index)
        })),
        subtitleTracks: [
            { value: '-1', label: translate('Off') },
            ...subtitleStreams.map((stream) => ({
                value: String(stream.Index),
                label: stream.DisplayTitle ?? String(stream.Index)
            }))
        ],
        selectedSourceId,
        selectedVideoIndex: String(videoStreams[0]?.Index ?? -1),
        selectedAudioIndex:
            audioOverride ?? (defaultAudio == null ? '' : String(defaultAudio)),
        selectedSubtitleIndex: subtitleOverride ?? String(defaultSubtitle),
        selectSource,
        selectAudio: setAudioOverride,
        selectSubtitle: setSubtitleOverride,
        selectedSource
    };
}
