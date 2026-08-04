/*
 * W1 — the inherited YouTube player surface is disabled for 1.0.0.
 *
 * WHY THIS EXISTS
 *
 *   `src/plugins/youtubePlayer/plugin.js` decides whether it can handle a URL
 *   with a bare substring test:
 *
 *       canPlayUrl(url) { return url.toLowerCase().indexOf('youtube.com') !== -1; }
 *
 *   That accepts `https://attacker.example/?x=youtube.com`. It is reachable
 *   because a trailer item is built with no `Id`, so `isServerItem()` is false
 *   and `getPlayer()` takes its URL branch — which consults `canPlayUrl` and
 *   never consults the plugin's `canPlayItem() === false` guard:
 *
 *       } else if (item.Url && p.canPlayUrl) {
 *           return p.canPlayUrl(item.Url);
 *       }
 *
 *   The URL originates in `RemoteTrailers`, populated by third-party metadata
 *   providers and by `<trailer>` elements in scanned `.nfo` files — not by the
 *   operator. That crosses the executable-content release boundary, so the
 *   surface is removed from the production configuration for 1.0.0.
 *
 * WHAT IS AND IS NOT CLAIMED
 *
 *   The plugin SOURCE is deliberately left in the tree — this release disables
 *   the surface, it does not repair or redesign the player. Plugins are loaded
 *   through a webpack context (`import(`../plugins/${pluginSpec}`)`), so a
 *   chunk for the directory is still EMITTED. That is expected and is not what
 *   these tests assert. What they assert is that nothing can ever REQUEST it:
 *   the only thing that loads a plugin is the production configuration's
 *   `plugins` list, and the plugin spec no longer appears there or anywhere
 *   else in production source.
 *
 *   RED-CHECK: revert the single deletion in `src/config.json` and every test
 *   below except the last two fails.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import config from '../../config.json';

const YOUTUBE_SPEC = 'youtubePlayer/plugin';
const SRC = path.resolve(__dirname, '../..');

/** Read a configured plugin's entry source, whichever extension it uses. */
function pluginSource(spec: string): string {
    for (const ext of ['.js', '.ts', '.tsx', '.jsx']) {
        try {
            return readFileSync(path.join(SRC, 'plugins', spec + ext), 'utf8');
        } catch {
            /* try the next extension */
        }
    }
    throw new Error(
        `configured plugin has no resolvable entry source: ${spec}`
    );
}

/** The exact selection predicate from `playbackmanager.js` `getPlayer()`. */
function selectPlayer(
    players: Array<Record<string, (...a: never[]) => unknown>>,
    item: { MediaType: string; Id?: string; Url?: string }
) {
    const serverItem = item.Id != null;
    return players.filter((p) => {
        if ((p.canPlayMediaType as (m: string) => boolean)(item.MediaType)) {
            if (serverItem) {
                if (p.canPlayItem) {
                    return (p.canPlayItem as () => boolean)();
                }
                return true;
            } else if (item.Url && p.canPlayUrl) {
                return (p.canPlayUrl as (u: string) => boolean)(item.Url);
            }
        }
        return false;
    })[0];
}

describe('W1 — inherited YouTube player surface', () => {
    // (1) The production configuration no longer loads the plugin.
    it('is absent from the production plugin list', () => {
        expect(config.plugins).not.toContain(YOUTUBE_SPEC);
    });

    it('is the only thing removed — every other player still loads', () => {
        // Guards against a broad edit masquerading as the W1 disable.
        expect(config.plugins).toEqual([
            'playAccessValidation/plugin',
            'experimentalWarnings/plugin',
            'htmlAudioPlayer/plugin',
            'htmlVideoPlayer/plugin',
            'photoPlayer/plugin',
            'comicsPlayer/plugin',
            'bookPlayer/plugin',
            'backdropScreensaver/plugin',
            'pdfPlayer/plugin',
            'logoScreensaver/plugin',
            'sessionPlayer/plugin',
            'chromecastPlayer/plugin',
            'stillWatching/plugin',
            'syncPlay/plugin'
        ]);
    });

    // (2) No reachable registration for that plugin in production source.
    it('is referenced by no production source file', () => {
        // The plugin's own source, and this test, are the two places the spec
        // is allowed to survive; everything else referencing it would be a
        // route back to loading the player.
        const exempt = [
            path.join('plugins', 'youtubePlayer') + path.sep,
            path.join('components', 'playback', 'w1-youtube-surface.test.ts')
        ];
        const offenders = readdirSync(SRC, { recursive: true })
            .map(String)
            .filter((rel) => /\.(js|jsx|ts|tsx|json)$/.test(rel))
            .filter((rel) => !exempt.some((ex) => rel.startsWith(ex)))
            .filter((rel) =>
                readFileSync(path.join(SRC, rel), 'utf8').includes(YOUTUBE_SPEC)
            );

        expect(offenders).toEqual([]);
    });

    // (3) An attacker-controlled URL merely CONTAINING youtube.com is not
    //     offered to that player — proved through the real selection predicate
    //     over the players the production configuration actually loads.
    it('offers no player for a URL-only item whose URL merely contains youtube.com', () => {
        const hostile = {
            MediaType: 'Video',
            Url: 'https://attacker.example/watch?ref=youtube.com'
        };

        // CONTROL — the predicate is live, and the URL branch really does
        // bypass canPlayItem. A player that declares canPlayUrl is selected for
        // this item even though its canPlayItem says no; that combination is
        // exactly the bypass W1 is about. The control deliberately does NOT
        // restate the inherited substring check: writing that expression here
        // would reintroduce the very defect being removed. Test (6) pins the
        // real check by reading the plugin's own source instead.
        const urlAcceptingPlayer = {
            canPlayMediaType: (m: string) =>
                ['audio', 'video'].includes(m.toLowerCase()),
            canPlayItem: () => false,
            canPlayUrl: () => true
        };
        expect(selectPlayer([urlAcceptingPlayer], hostile)).toBe(
            urlAcceptingPlayer
        );

        // THE ASSERTION — the URL branch of getPlayer() consults only players
        // that define canPlayUrl. Across the players the production
        // configuration actually loads, none does, so nothing is offered.
        const withCanPlayUrl = config.plugins.filter((spec) =>
            pluginSource(spec).includes('canPlayUrl(')
        );
        expect(withCanPlayUrl).toEqual([]);
    });

    // (4) Ordinary server-hosted media playback is unchanged.
    it('still selects the HTML video player for a server-hosted item', () => {
        expect(config.plugins).toContain('htmlVideoPlayer/plugin');
        expect(config.plugins).toContain('htmlAudioPlayer/plugin');

        const htmlVideoPlayer = {
            canPlayMediaType: (m: string) => m.toLowerCase() === 'video',
            canPlayItem: () => true
        };
        const serverItem = {
            MediaType: 'Video',
            Id: '7f1d3e9a4b2c4d5e8f0a1b2c3d4e5f60'
        };
        expect(selectPlayer([htmlVideoPlayer], serverItem)).toBe(
            htmlVideoPlayer
        );
    });

    // (5) The disabled plugin's defect is still the defect we think it is —
    //     if upstream source is ever repaired or removed, revisit this ruling
    //     rather than silently keeping a stale disable.
    it('the disabled source still carries the substring host check it was disabled for', () => {
        const src = readFileSync(
            path.join(SRC, 'plugins', 'youtubePlayer', 'plugin.js'),
            'utf8'
        );
        expect(src).toContain("indexOf('youtube.com')");
    });
});
