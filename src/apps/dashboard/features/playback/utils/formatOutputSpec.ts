import type { OutputSpec } from '../api/types';

/**
 * Renders an `OutputSpec` as a short human-readable summary for table/list display, e.g.
 * `MP4 · H264 · 1920x1080 · AAC`. Fields absent on the DTO (nullable, e.g. Direct Play often
 * leaves everything but `Protocol` unset) are simply skipped rather than shown as placeholders.
 */
export const formatOutputSpec = (output: OutputSpec): string => {
    const parts = [
        output.Container?.toUpperCase(),
        output.VideoCodec?.toUpperCase(),
        output.Resolution ? `${output.Resolution.Width}x${output.Resolution.Height}` : undefined,
        output.AudioCodec?.toUpperCase()
    ].filter((part): part is string => !!part);

    return parts.length > 0 ? parts.join(' · ') : '—';
};
