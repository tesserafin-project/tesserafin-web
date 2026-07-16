import { describe, expect, it } from 'vitest';

import type { OutputSpec } from '../api/types';
import { formatOutputSpec } from './formatOutputSpec';

const EMPTY_OUTPUT: OutputSpec = {
    Container: null,
    VideoCodec: null,
    AudioCodec: null,
    Resolution: null,
    VideoRange: null,
    AudioChannels: null,
    TotalBitrate: null,
    VideoBitrate: null,
    AudioBitrate: null,
    Protocol: 'Http',
    SubtitleFormat: null
};

describe('formatOutputSpec()', () => {
    it('joins the available fields with a separator', () => {
        const output: OutputSpec = {
            ...EMPTY_OUTPUT,
            Container: 'mp4',
            VideoCodec: 'h264',
            Resolution: { Width: 1920, Height: 1080 },
            AudioCodec: 'aac'
        };

        expect(formatOutputSpec(output)).toBe('MP4 · H264 · 1920x1080 · AAC');
    });

    it('skips fields that are null', () => {
        const output: OutputSpec = {
            ...EMPTY_OUTPUT,
            Container: 'mkv',
            VideoCodec: 'hevc'
        };

        expect(formatOutputSpec(output)).toBe('MKV · HEVC');
    });

    it('returns a placeholder when no fields are available', () => {
        expect(formatOutputSpec(EMPTY_OUTPUT)).toBe('—');
    });
});
