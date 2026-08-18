/**
 * Web-owned media fixtures for the #153-A1 browser matrix.
 *
 * WHY THE WEB REPOSITORY SEEDS THESE. `ci/serve-e2e.sh` (server repository) seeds four video
 * fixtures. Direct audio, universal audio, attachments and fonts have none, so half the families
 * A1 migrated could not be exercised at all. Editing the rig means a SERVER branch and the whole
 * server gate set for what is purely test scaffolding — and it is unnecessary: the rig and the
 * browser share a host, and the server exposes library creation and encoding configuration through
 * its public API. Zero server files change.
 *
 * Everything here is synthesized with ffmpeg into a throwaway directory, added through
 * `POST /Library/VirtualFolders`, and removed again afterwards.
 */
import { spawnSync } from 'node:child_process';
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect } from '@playwright/test';

import type { Admin } from './rig';

/** A font that exists on any Debian-family host with `fonts-dejavu-core`. */
const SYSTEM_FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

function ffmpeg(args: string[]): void {
    const result = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], {
        encoding: 'utf8'
    });
    if (result.status !== 0) {
        // ffmpeg's stderr names the failure; it contains no credential.
        throw new Error(`ffmpeg failed: ${result.stderr?.slice(0, 400)}`);
    }
}

export interface SeededLibrary {
    /** The directory the server was pointed at. */
    root: string;
    /** Item names the library should expose once the scan settles. */
    itemNames: string[];
    dispose: () => void;
}

function authed(a: Admin) {
    return {
        Authorization: `MediaBrowser Client="Tesserafin Web", Device="a1-fixtures", DeviceId="a1-fixtures", Version="0.0.0", Token="${a.token}"`
    };
}

async function addLibrary(
    a: Admin,
    name: string,
    collectionType: string,
    path: string
): Promise<void> {
    const res = await a.api.post('/Library/VirtualFolders', {
        headers: { ...authed(a), 'Content-Type': 'application/json' },
        params: {
            name,
            collectionType,
            paths: path,
            refreshLibrary: 'true'
        },
        data: {
            LibraryOptions: {
                EnableRealtimeMonitor: false,
                EnableChapterImageExtraction: false,
                ExtractChapterImagesDuringLibraryScan: false
            }
        }
    });
    expect(res.ok(), `library "${name}" must be created`).toBe(true);
}

/**
 * The id of the seeded MEDIA item, never the folder.
 *
 * Each fixture lives in a directory named after it, so the scan produces BOTH a folder and the item
 * inside it. `itemIdByName` takes the first match, which was the folder — whose detail page has no
 * play control, and the matrix then waited ten minutes for a button that was never coming.
 */
export async function mediaItemIdByName(
    a: Admin,
    name: string,
    includeItemTypes: 'Video' | 'Audio'
): Promise<string> {
    const res = await a.api.get(`/Users/${a.userId}/Items`, {
        headers: authed(a),
        params: {
            searchTerm: name,
            recursive: 'true',
            includeItemTypes,
            limit: '10'
        }
    });
    expect(res.ok(), `media lookup for ${name}`).toBe(true);
    const items = (await res.json()).Items as Array<{
        Id: string;
        Name: string;
        Type: string;
    }>;
    const match = items.find((i) => i.Name.includes(name));
    expect(
        match,
        `a ${includeItemTypes} item named "${name}" must exist; found ${items
            .map((i) => `${i.Name}:${i.Type}`)
            .join(', ')}`
    ).toBeTruthy();
    return match!.Id;
}

/** Poll `/Items` until every expected name has indexed. The scan is asynchronous. */
async function waitForItems(
    a: Admin,
    names: string[],
    timeoutMs = 90_000
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const missing = new Set(names);
    while (Date.now() < deadline && missing.size > 0) {
        for (const name of [...missing]) {
            const res = await a.api.get(`/Users/${a.userId}/Items`, {
                headers: authed(a),
                params: { searchTerm: name, recursive: 'true', limit: '10' }
            });
            if (res.ok()) {
                const items = (await res.json()).Items as Array<{
                    Name: string;
                }>;
                if (items.some((i) => i.Name.includes(name)))
                    missing.delete(name);
            }
        }
        if (missing.size > 0) await new Promise((r) => setTimeout(r, 1_500));
    }
    expect(
        [...missing],
        'every seeded fixture must index before the matrix runs'
    ).toEqual([]);
}

/**
 * A music library with one real audio file.
 *
 * Exercises BOTH audio families: the web plays music through `/Audio/{id}/universal` (built before
 * any PlaybackInfo call, with a client-invented play session and no media source named), and falls
 * back to `/Audio/{id}/stream` when it direct-plays.
 */
export async function seedAudioLibrary(a: Admin): Promise<SeededLibrary> {
    const root = mkdtempSync(join(tmpdir(), 'a1-audio-'));
    const name = 'A1 Audio Probe';
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    ffmpeg([
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=8',
        '-c:a',
        'libmp3lame',
        '-b:a',
        '128k',
        '-metadata',
        `title=${name}`,
        join(dir, `${name}.mp3`)
    ]);
    await addLibrary(a, 'A1 Audio', 'music', root);
    await waitForItems(a, [name]);
    return {
        root,
        itemNames: [name],
        dispose: () => rmSync(root, { recursive: true, force: true })
    };
}

/**
 * A video with an ASS subtitle track AND an attached font.
 *
 * Both the attachment family and the fallback-font family are reached ONLY through
 * `htmlVideoPlayer.renderSsaAss`, which runs only when an ASS/SSA track actually renders through
 * libass. A font file on disk alone exercises nothing — one ASS fixture with an attachment unlocks
 * both.
 */
export async function seedAssLibrary(a: Admin): Promise<SeededLibrary> {
    if (!existsSync(SYSTEM_FONT)) {
        throw new Error(
            `the ASS fixture needs a system TTF at ${SYSTEM_FONT}; install fonts-dejavu-core`
        );
    }
    const root = mkdtempSync(join(tmpdir(), 'a1-ass-'));
    const name = 'A1 Subtitle Probe';
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });

    const ass = join(root, 'probe.ass');
    writeFileSync(
        ass,
        [
            '[Script Info]',
            'ScriptType: v4.00+',
            '',
            '[V4+ Styles]',
            'Format: Name, Fontname, Fontsize, PrimaryColour, Bold, Italic, Alignment, MarginL, MarginR, MarginV, Encoding',
            'Style: Default,DejaVu Sans,28,&H00FFFFFF,0,0,2,10,10,10,1',
            '',
            '[Events]',
            'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
            'Dialogue: 0,0:00:00.50,0:00:07.00,Default,,0,0,0,,A1 capability probe',
            ''
        ].join('\n'),
        'utf8'
    );

    ffmpeg([
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=320x240:rate=24:duration=8',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=8',
        '-i',
        ass,
        '-attach',
        SYSTEM_FONT,
        '-metadata:s:t:0',
        'mimetype=application/x-truetype-font',
        '-metadata:s:t:0',
        'filename=DejaVuSans.ttf',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-c:s',
        'ass',
        '-metadata',
        `title=${name}`,
        join(dir, `${name}.mkv`)
    ]);

    await addLibrary(a, 'A1 Subtitles', 'homevideos', root);
    await waitForItems(a, [name]);
    return {
        root,
        itemNames: [name],
        dispose: () => rmSync(root, { recursive: true, force: true })
    };
}

/**
 * Turn on the fallback font list and point it at a real directory.
 *
 * `htmlVideoPlayer` only fetches `/FallbackFont/Fonts` when the encoding configuration says
 * `EnableFallbackFont`, so without this the Fonts capability is never minted and the family cannot
 * be proven.
 */
export async function enableFallbackFont(
    a: Admin
): Promise<{ dispose: () => Promise<void> }> {
    const fontDir = mkdtempSync(join(tmpdir(), 'a1-fonts-'));
    copyFileSync(SYSTEM_FONT, join(fontDir, 'DejaVuSans.ttf'));

    const current = await a.api.get('/System/Configuration/encoding', {
        headers: authed(a)
    });
    expect(current.ok(), 'the encoding configuration must be readable').toBe(
        true
    );
    const before = await current.json();

    const res = await a.api.post('/System/Configuration/encoding', {
        headers: { ...authed(a), 'Content-Type': 'application/json' },
        data: { ...before, EnableFallbackFont: true, FallbackFontPath: fontDir }
    });
    expect(res.ok(), 'the fallback font must be enabled').toBe(true);

    return {
        dispose: async () => {
            await a.api.post('/System/Configuration/encoding', {
                headers: { ...authed(a), 'Content-Type': 'application/json' },
                data: before
            });
            rmSync(fontDir, { recursive: true, force: true });
        }
    };
}
