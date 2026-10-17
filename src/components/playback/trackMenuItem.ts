/**
 * The player's audio and subtitle menus, one row per track.
 *
 * The server's `DisplayTitle` packs everything into one dash-joined string in the server's
 * language ("French - Default - SUBRIP"), so a French viewer read English language names, a raw
 * codec id, and the flag that matters buried mid-string. A row here leads with the language in the
 * viewer's own locale, keeps the author's track title (or, without one, what tells two tracks of a
 * language apart) as secondary text, and moves Default / Forced / External to the aside.
 */

export interface TrackStream {
    Index: number;
    Language?: string | null;
    Title?: string | null;
    DisplayTitle?: string | null;
    Codec?: string | null;
    Channels?: number | null;
    IsDefault?: boolean;
    IsForced?: boolean;
    IsExternal?: boolean;
}

export interface TrackMenuItem {
    name: string;
    secondaryText?: string;
    asideText?: string;
}

const CODEC_NAMES: Record<string, string> = {
    subrip: 'SRT',
    pgssub: 'PGS',
    dvdsub: 'VobSub',
    webvtt: 'WebVTT',
    mov_text: 'Timed Text'
};

const CHANNELS: Record<number, string> = {
    1: '1.0',
    2: '2.0',
    6: '5.1',
    8: '7.1'
};

/** `fra` → "Français" in a French UI; undefined for an absent or undetermined language. */
export function languageName(
    code: string | null | undefined,
    locale: string
): string | undefined {
    if (!code || code === 'und' || code === 'zxx') return undefined;
    try {
        const name = new Intl.DisplayNames([locale], {
            type: 'language',
            fallback: 'none'
        }).of(code);
        return name
            ? name.charAt(0).toLocaleUpperCase(locale) + name.slice(1)
            : undefined;
    } catch {
        return undefined;
    }
}

export function trackMenuItem(
    stream: TrackStream,
    locale: string,
    translate: (key: string) => string
): TrackMenuItem {
    const language = languageName(stream.Language, locale);
    const title = stream.Title?.trim();
    const codec = stream.Codec
        ? (CODEC_NAMES[stream.Codec] ?? stream.Codec.toUpperCase())
        : '';
    const technical = [
        codec,
        stream.Channels
            ? (CHANNELS[stream.Channels] ?? `${stream.Channels} ch`)
            : ''
    ]
        .filter(Boolean)
        .join(' ');

    const flags = [
        stream.IsDefault && translate('MediaInfoDefault'),
        stream.IsForced && translate('MediaInfoForced'),
        stream.IsExternal && translate('MediaInfoExternal')
    ]
        .filter(Boolean)
        .join(' · ');

    // No language to lead with: the author's title, then the server's string, still beat nothing.
    const name = language ?? title ?? stream.DisplayTitle ?? technical;
    const secondary =
        title &&
        title !== name &&
        title.toLocaleLowerCase(locale) !== language?.toLocaleLowerCase(locale)
            ? title
            : technical;

    return {
        name,
        ...(secondary && secondary !== name
            ? { secondaryText: secondary }
            : {}),
        ...(flags ? { asideText: flags } : {})
    };
}
