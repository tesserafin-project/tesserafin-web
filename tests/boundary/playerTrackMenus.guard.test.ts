import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * DEBT-WEB-2 moved the player's audio and subtitle menus out of the legacy video controller into
 * `apps/modern/features/playerTracks` (React, behind a typed adapter), and DEBT-WEB-3 its settings
 * menu. This keeps them out.
 *
 * The controller may still READ subtitle tracks and still owns the stats and subtitle-sync
 * overlays, but it must not offer a choice, change a track or a setting, or build a menu: one path
 * per menu, or the next fix lands on the wrong one. Comments are stripped, so prose explaining the
 * move does not trip it.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../../src');
const CONTROLLER = join(SRC, 'apps/legacy/controllers/playback/video');
const FEATURE = join(SRC, 'apps/modern/features/playerTracks');

const code = (file: string) =>
    readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

describe('the player track menus stay migrated', () => {
    it.each([
        ['an action sheet', /actionSheet|actionsheet/],
        ['a track-menu row builder', /trackMenuItem/],
        ['a track command', /set(Audio|Subtitle|SecondarySubtitle)StreamIndex/],
        [
            'the old menu functions',
            /show(AudioTrack|SubtitleTrack)Selection|showSecondarySubtitlesMenu/
        ],
        [
            'the old trigger buttons',
            /btnAudio|btnSubtitles|btnVideoOsdSettings/
        ],
        [
            'the old settings menu',
            /playersettingsmenu|onSettingsButtonClick|onSettingsOption/
        ],
        [
            'a settings command',
            /playbackManager\.(set(AspectRatio|PlaybackRate|MaxStreamingBitrate|RepeatMode)|enableShowingSubtitleOffset)\b/
        ]
    ])('the legacy video controller has no %s', (_what, pattern) => {
        for (const file of ['index.js', 'index.html']) {
            expect(
                code(join(CONTROLLER, file)),
                `${file} reintroduces what playerTracks now owns`
            ).not.toMatch(pattern);
        }
    });

    it('the action-sheet settings menu is gone, not merely unused', () => {
        expect(
            existsSync(join(SRC, 'components/playback/playersettingsmenu.js'))
        ).toBe(false);
    });

    it('the React menus do not fall back on the legacy dialogs', () => {
        for (const file of readdirSync(FEATURE)) {
            if (!/\.(ts|tsx)$/.test(file) || file.includes('.test.')) continue;
            expect(code(join(FEATURE, file)), file).not.toMatch(
                /actionSheet|dialogHelper|renderComponent/
            );
        }
    });
});
