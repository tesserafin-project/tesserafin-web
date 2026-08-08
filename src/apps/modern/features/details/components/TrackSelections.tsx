import React, { type FC } from 'react';

import globalize from 'lib/globalize';

import type { TrackOption, TrackSelection } from '../hooks/useTrackSelection';
import type { DetailSelectorName } from '../constants/sections';

interface SelectorProps {
    name: DetailSelectorName;
    label: string;
    options: TrackOption[];
    value: string;
    disabled?: boolean;
    onChange?: (value: string) => void;
}

/**
 * One track selector.
 *
 * Rendered even when it has no options, because the frozen contract records all four as OFFERED
 * for every class whose track form is shown — `minimal-video` has no media streams at all and still
 * lists four selectors. An empty selector is `hidden`, so it is out of the accessibility tree and
 * invisible, exactly as the legacy hidden container was.
 */
const Selector: FC<SelectorProps> = ({
    name,
    label,
    options,
    value,
    disabled,
    onChange
}) => (
    <div className='rf-item-details__track' hidden={options.length === 0}>
        <label htmlFor={`itemDetails-${name}`}>{label}</label>
        <select
            id={`itemDetails-${name}`}
            data-detail-select={name}
            value={value}
            disabled={disabled || options.length === 0}
            onChange={(event) => onChange?.(event.target.value)}
        >
            {options.map((option) => (
                <option key={option.value} value={option.value}>
                    {option.label}
                </option>
            ))}
        </select>
    </div>
);

interface TrackSelectionsProps {
    tracks: TrackSelection;
}

/**
 * Media-source, video, audio and subtitle selection.
 *
 * The video selector is offered and DISABLED. `SUSPECT` #3 records that it is never read; the
 * migration preserves it rather than silently dropping a recorded control, and
 * `docs/tesserafin/item-details-migration.md` §5 records why that needs an owner ruling.
 *
 * There is no `<form>` and no submit handler: the legacy one existed only to swallow an implicit
 * submit from an `emby-select` inside a form.
 */
const TrackSelections: FC<TrackSelectionsProps> = ({ tracks }) => (
    <div className='rf-item-details__tracks'>
        <Selector
            name='selectSource'
            label={globalize.translate('LabelVersion')}
            options={tracks.sources}
            value={tracks.selectedSourceId}
            onChange={tracks.selectSource}
        />
        <Selector
            name='selectVideo'
            label={globalize.translate('Video')}
            options={tracks.videoTracks}
            value={tracks.selectedVideoIndex}
            disabled
        />
        <Selector
            name='selectAudio'
            label={globalize.translate('Audio')}
            options={tracks.audioTracks}
            value={tracks.selectedAudioIndex}
            disabled={tracks.audioTracks.length <= 1}
            onChange={tracks.selectAudio}
        />
        <Selector
            name='selectSubtitles'
            label={globalize.translate('Subtitles')}
            options={tracks.subtitleTracks}
            value={tracks.selectedSubtitleIndex}
            disabled={tracks.subtitleTracks.length <= 1}
            onChange={tracks.selectSubtitle}
        />
    </div>
);

export default TrackSelections;
