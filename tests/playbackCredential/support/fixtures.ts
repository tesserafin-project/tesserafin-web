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
    /**
     * Remove the temporary media AND the virtual folder.
     *
     * Deleting only the directory is what every version of these fixtures used to do, and it is
     * why a rig that has run one spec twice starts failing: the folder survives, the scan still
     * lists the DISPOSED item, `mediaItemIdByName` resolves it, and playback answers 404 on a
     * file that is not there any more. Async because removing the folder is a server call.
     */
    dispose: () => Promise<void>;
}

/** Remove a virtual folder, ignoring the case where it is already gone. */
async function removeLibrary(a: Admin, name: string): Promise<void> {
    await a.api
        .delete('/Library/VirtualFolders', {
            headers: authed(a),
            params: { name, refreshLibrary: 'false' }
        })
        .catch(() => undefined);
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
 *
 * `label` NAMES THE LIBRARY, and two callers in one server run must not share one. `dispose()`
 * deletes the temp directory but leaves the library registered, so a second caller reusing the same
 * name re-seeds a library whose old item still resolves - and that dead item answers 404 for its
 * media. Measured: adding a second audio-seeding spec made `matrix.spec.ts` fail with a 404 on
 * `/Audio/{id}/universal` while the spec that ran first passed.
 */
export async function seedAudioLibrary(
    a: Admin,
    label = 'A1 Audio'
): Promise<SeededLibrary> {
    const root = mkdtempSync(join(tmpdir(), 'a1-audio-'));
    const name = `${label} Probe`;
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
    await addLibrary(a, label, 'music', root);
    await waitForItems(a, [name]);
    return {
        root,
        itemNames: [name],
        dispose: async () => {
            await removeLibrary(a, label);
            rmSync(root, { recursive: true, force: true });
        }
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
export async function seedAssLibrary(
    a: Admin,
    label = 'A1 Subtitles'
): Promise<SeededLibrary> {
    if (!existsSync(SYSTEM_FONT)) {
        throw new Error(
            `the ASS fixture needs a system TTF at ${SYSTEM_FONT}; install fonts-dejavu-core`
        );
    }
    const root = mkdtempSync(join(tmpdir(), 'a1-ass-'));
    // The NAME is derived from the label, not fixed: two specs sharing one name made whichever
    // ran second resolve the first one's disposed item and time out on a video that can never
    // load. Same defect `seedAudioLibrary` already carries a note about.
    const name = `${label} Probe`;
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

    await addLibrary(a, label, 'homevideos', root);
    await waitForItems(a, [name]);
    return {
        root,
        itemNames: [name],
        dispose: async () => {
            await removeLibrary(a, label);
            rmSync(root, { recursive: true, force: true });
        }
    };
}

/**
 * A video long enough for trickplay, in a library that asks for trickplay extraction.
 *
 * Two details are load-bearing.
 *
 *   * The RUNTIME. `TrickplayManager.CanGenerateTrickplay` refuses anything shorter than the
 *     configured interval, which is 10 s by default; a 60 s fixture clears it with room to spare
 *     and yields six tiles.
 *   * The LIBRARY NAME is unique per call, and the virtual folder is removed on dispose. Every
 *     other fixture here leaves its folder behind, and a repeat run then resolves the PREVIOUS
 *     run's item — whose files were deleted — so playback never starts and the spec fails on a
 *     timeout that says nothing about trickplay. Measured three times before this was fixed.
 */
export interface SeededTrickplayLibrary {
    root: string;
    label: string;
    itemName: string;
    dispose: () => Promise<void>;
}

export async function seedTrickplayLibrary(
    a: Admin,
    prefix = 'A1 Trickplay'
): Promise<SeededTrickplayLibrary> {
    const label = `${prefix} ${Math.random().toString(36).slice(2, 8)}`;
    const itemName = `${label} Probe`;
    const root = mkdtempSync(join(tmpdir(), 'a1-trick-'));
    const dir = join(root, itemName);
    mkdirSync(dir, { recursive: true });
    ffmpeg([
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=640x360:rate=24:duration=60',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=60',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-metadata',
        `title=${itemName}`,
        join(dir, `${itemName}.mp4`)
    ]);

    const res = await a.api.post('/Library/VirtualFolders', {
        headers: { ...authed(a), 'Content-Type': 'application/json' },
        params: {
            name: label,
            collectionType: 'homevideos',
            paths: root,
            refreshLibrary: 'true'
        },
        data: {
            LibraryOptions: {
                EnableRealtimeMonitor: false,
                EnableTrickplayImageExtraction: true,
                ExtractTrickplayImagesDuringLibraryScan: true,
                SaveTrickplayWithMedia: false
            }
        }
    });
    expect(res.ok(), `trickplay library "${label}" must be created`).toBe(true);
    await waitForItems(a, [itemName]);

    return {
        root,
        label,
        itemName,
        dispose: async () => {
            await a.api
                .delete('/Library/VirtualFolders', {
                    headers: authed(a),
                    params: { name: label, refreshLibrary: 'false' }
                })
                .catch(() => undefined);
            rmSync(root, { recursive: true, force: true });
        }
    };
}

/** Run the server's REAL trickplay task and wait until the item reports tiles. */
export async function generateTrickplay(
    a: Admin,
    itemId: string
): Promise<Record<string, unknown>> {
    const tasks = await a.api.get('/ScheduledTasks', { headers: authed(a) });
    expect(tasks.ok(), 'the scheduled task list must be readable').toBe(true);
    const task = (
        (await tasks.json()) as Array<{ Id: string; Key: string }>
    ).find((t) => t.Key === 'RefreshTrickplayImages');
    expect(
        task,
        'the server must expose the RefreshTrickplayImages task'
    ).toBeTruthy();
    const started = await a.api.post(`/ScheduledTasks/Running/${task!.Id}`, {
        headers: authed(a)
    });
    expect(started.ok(), 'the trickplay task must start').toBe(true);

    let resolutions: Record<string, unknown> = {};
    await expect
        .poll(
            async () => {
                const res = await a.api.get(
                    `/Users/${a.userId}/Items/${itemId}`,
                    {
                        headers: authed(a)
                    }
                );
                if (!res.ok()) return 0;
                const body = await res.json();
                resolutions = (body.Trickplay ?? {}) as Record<string, unknown>;
                return Object.keys(resolutions).length;
            },
            {
                timeout: 300_000,
                intervals: [5000],
                message: 'the trickplay task must produce tiles for the fixture'
            }
        )
        .toBeGreaterThan(0);
    return resolutions;
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
