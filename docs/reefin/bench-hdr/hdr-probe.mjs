#!/usr/bin/env node
/**
 * HDR feasibility probe (reconnaissance only - issue #29, lane D).
 *
 * Drives a Chromium build over CDP (no npm deps: raw WebSocket from Node >= 22)
 * and reports, SEPARATELY:
 *   (a) DECODE  - `navigator.mediaCapabilities.decodingInfo` for concrete
 *                 codec + profile + transferFunction + colorGamut configurations,
 *                 each paired with an SDR twin that differs ONLY in the HDR fields;
 *   (b) DISPLAY - `matchMedia` for `dynamic-range` / `video-dynamic-range` /
 *                 `color-gamut`, with `.media` round-trip so an UNPARSED feature
 *                 (ABSENT) is distinguishable from a parsed-and-false one (NEGATIVE).
 *
 * Usage: node hdr-probe.mjs <chrome-binary> <label> [--headed]
 * Emits one JSON document on stdout.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [bin, label, ...rest] = process.argv.slice(2);
const headed = rest.includes('--headed');
if (!bin || !label) {
    console.error('usage: hdr-probe.mjs <chrome-binary> <label> [--headed]');
    process.exit(2);
}

const profileDir = mkdtempSync(join(tmpdir(), 'hdrprobe-'));
const port = 9222 + Math.floor(Math.random() * 500);
const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu-shader-disk-cache',
    'about:blank'
];
if (!headed) args.unshift('--headless=new');

const child = spawn(bin, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: process.env
});
let stderr = '';
child.stderr.on('data', (d) => {
    stderr += d.toString();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findWs() {
    for (let i = 0; i < 100; i++) {
        try {
            const r = await fetch(`http://127.0.0.1:${port}/json/version`);
            if (r.ok) return await r.json();
        } catch {
            /* not up yet */
        }
        await sleep(200);
    }
    throw new Error(
        `devtools never came up on ${port}\n${stderr.slice(-2000)}`
    );
}

// ---------------------------------------------------------------- probe body
// Runs INSIDE the page. Must be a self-contained async IIFE returning JSON.
const PROBE = `(async () => {
  const out = { ua: navigator.userAgent, uaData: null, screen: {}, media: {}, decode: [], errors: [] };
  try {
    if (navigator.userAgentData) {
      out.uaData = await navigator.userAgentData.getHighEntropyValues(['platform','platformVersion','fullVersionList','architecture']);
    }
  } catch (e) { out.errors.push('uaData: ' + e); }

  out.screen = {
    width: screen.width, height: screen.height,
    colorDepth: screen.colorDepth, pixelDepth: screen.pixelDepth,
    devicePixelRatio: window.devicePixelRatio
  };

  // --- DISPLAY half -------------------------------------------------------
  // MEASURED, Chromium 149: MediaQueryList.media echoes ANY query verbatim -
  // '(totally-bogus-feature: high)' does NOT serialise to 'not all'. So the
  // syntactic round-trip carries no ABSENT signal here; it is recorded only to
  // document that. ABSENT is inferred SEMANTICALLY below, from the partition
  // test: an implemented enumerated feature must match exactly one of its
  // values. Matching none => the feature is not implemented => ABSENT.
  const mq = (q) => {
    const m = window.matchMedia(q);
    return { query: q, serialised: m.media, matches: m.matches };
  };
  for (const q of [
    '(dynamic-range: high)', '(dynamic-range: standard)',
    '(video-dynamic-range: high)', '(video-dynamic-range: standard)',
    '(color-gamut: srgb)', '(color-gamut: p3)', '(color-gamut: rec2020)',
    '(prefers-color-scheme: dark)',           // control: implemented feature
    '(totally-bogus-feature: high)',          // control: ABSENT feature
    '(dynamic-range: bogusvalue)'             // control: implemented feature, bad value
  ]) { out.media[q] = mq(q); }

  out.partition = {};
  for (const f of ['dynamic-range', 'video-dynamic-range']) {
    const hi = out.media['(' + f + ': high)'].matches;
    const st = out.media['(' + f + ': standard)'].matches;
    out.partition[f] = {
      high: hi, standard: st,
      verdict: (hi && !st) ? 'POSITIVE (HDR display chain)'
             : (!hi && st) ? 'NEGATIVE (SDR display chain, feature implemented)'
             : (!hi && !st) ? 'ABSENT (feature not implemented - matches neither value)'
             : 'UNKNOWN (both values matched - contradictory)'
    };
  }

  // --- DECODE half --------------------------------------------------------
  const base = { width: 1920, height: 1080, bitrate: 12000000, framerate: 24 };
  const HDR10 = { transferFunction: 'pq', colorGamut: 'rec2020', hdrMetadataType: 'smpteSt2086' };
  const HLG   = { transferFunction: 'hlg', colorGamut: 'rec2020' };
  const SDR   = { transferFunction: 'srgb', colorGamut: 'srgb' };

  const cases = [
    // id, type, contentType, extra video fields
    ['h264-high-sdr',      'file', 'video/mp4; codecs="avc1.640028"', SDR],
    ['hevc-main-sdr',      'file', 'video/mp4; codecs="hvc1.1.6.L153.90"', SDR],
    ['hevc-main10-hdr10',  'file', 'video/mp4; codecs="hvc1.2.4.L153.90"', HDR10],
    ['hevc-main10-hlg',    'file', 'video/mp4; codecs="hvc1.2.4.L153.90"', HLG],
    ['hevc-main10-nohdrfields', 'file', 'video/mp4; codecs="hvc1.2.4.L153.90"', {}],
    ['vp9-p0-sdr',         'file', 'video/webm; codecs="vp09.00.10.08"', SDR],
    ['vp9-p2-hdr10',       'file', 'video/webm; codecs="vp09.02.10.10.01.09.16.09.01"', HDR10],
    // discrimination twins: SAME contentType, ONLY the HDR fields differ
    ['vp9-p2-sdrfields',   'file', 'video/webm; codecs="vp09.02.10.10.01.09.16.09.01"', SDR],
    ['vp9-p2-nofields',    'file', 'video/webm; codecs="vp09.02.10.10.01.09.16.09.01"', {}],
    ['vp9-p2-hdr10plus',   'file', 'video/webm; codecs="vp09.02.10.10.01.09.16.09.01"', { transferFunction: 'pq', colorGamut: 'rec2020', hdrMetadataType: 'smpteSt2094-40' }],
    ['vp9-p2-dovi-meta',   'file', 'video/webm; codecs="vp09.02.10.10.01.09.16.09.01"', { transferFunction: 'pq', colorGamut: 'rec2020', hdrMetadataType: 'smpteSt2094-10' }],
    ['av1-10bit-sdrfields','file', 'video/mp4; codecs="av01.0.09M.10.0.110.09.16.09.0"', SDR],
    ['av1-8bit-sdr',       'file', 'video/mp4; codecs="av01.0.09M.08"', SDR],
    ['av1-10bit-hdr10',    'file', 'video/mp4; codecs="av01.0.09M.10.0.110.09.16.09.0"', HDR10],
    ['hevc-main10-hdr10-mse', 'media-source', 'video/mp4; codecs="hvc1.2.4.L153.90"', HDR10],
    ['vp9-p2-hdr10-mse',   'media-source', 'video/webm; codecs="vp09.02.10.10.01.09.16.09.01"', HDR10],
    // controls
    ['CONTROL-bogus-codec','file', 'video/mp4; codecs="bogus.9.9.9"', SDR],
    ['CONTROL-bogus-tf',   'file', 'video/mp4; codecs="avc1.640028"', { transferFunction: 'definitely-not-a-transfer-function' }]
  ];

  if (!('mediaCapabilities' in navigator) || !navigator.mediaCapabilities ||
      typeof navigator.mediaCapabilities.decodingInfo !== 'function') {
    out.decode.push({ id: '*', verdict: 'API-ABSENT', detail: 'navigator.mediaCapabilities.decodingInfo missing' });
  } else {
    for (const [id, type, contentType, extra] of cases) {
      const config = { type, video: Object.assign({ contentType }, base, extra) };
      try {
        const r = await navigator.mediaCapabilities.decodingInfo(config);
        out.decode.push({ id, config, result: {
          supported: r.supported, smooth: r.smooth, powerEfficient: r.powerEfficient,
          keySystemAccess: r.keySystemAccess ? 'present' : null
        }, verdict: r.supported ? 'SUPPORTED' : 'NOT-SUPPORTED' });
      } catch (e) {
        out.decode.push({ id, config, verdict: 'THREW', detail: String(e && e.name) + ': ' + String(e && e.message) });
      }
    }
  }

  // --- canPlayType cross-check (what browserDeviceProfile.js already uses) --
  const v = document.createElement('video');
  out.canPlayType = {};
  for (const t of [
    'video/mp4; codecs="avc1.640028"',
    'video/mp4; codecs="hvc1.1.6.L153.90"',
    'video/mp4; codecs="hvc1.2.4.L153.90"',
    'video/webm; codecs="vp09.02.10.10.01.09.16.09.01"',
    'video/mp4; codecs="av01.0.09M.10.0.110.09.16.09.0"'
  ]) { out.canPlayType[t] = v.canPlayType(t); }

  out.mseIsTypeSupported = {};
  if (window.MediaSource) {
    for (const t of [
      'video/mp4; codecs="hvc1.2.4.L153.90"',
      'video/webm; codecs="vp09.02.10.10.01.09.16.09.01"'
    ]) { out.mseIsTypeSupported[t] = MediaSource.isTypeSupported(t); }
  } else { out.mseIsTypeSupported = 'MediaSource ABSENT'; }

  return JSON.stringify(out);
})()`;

async function main() {
    const version = await findWs();
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
        ws.onopen = res;
        ws.onerror = rej;
    });

    const pending = new Map();
    let nextId = 1;
    ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
        }
    };
    const send = (method, params = {}, sessionId) =>
        new Promise((res) => {
            const id = nextId++;
            pending.set(id, res);
            ws.send(JSON.stringify({ id, method, params, sessionId }));
        });

    const targets = await send('Target.getTargets');
    const page = targets.result.targetInfos.find((t) => t.type === 'page');
    const att = await send('Target.attachToTarget', {
        targetId: page.targetId,
        flatten: true
    });
    const sid = att.result.sessionId;

    // A real http(s)/file origin is not needed: mediaCapabilities + matchMedia
    // work on about:blank. Navigating to a data: URL keeps it hermetic.
    await send('Runtime.enable', {}, sid);
    const evalRes = await send(
        'Runtime.evaluate',
        { expression: PROBE, awaitPromise: true, returnByValue: true },
        sid
    );

    const payload = evalRes.result?.result?.value;
    const report = {
        label,
        mode: headed ? 'headed' : 'headless',
        binary: bin,
        browserFromCDP: version.Browser,
        cdpProtocolVersion: version['Protocol-Version'],
        env: {
            DISPLAY: process.env.DISPLAY ?? null,
            WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY ?? null,
            XDG_SESSION_TYPE: process.env.XDG_SESSION_TYPE ?? null
        },
        probe: payload
            ? JSON.parse(payload)
            : { error: JSON.stringify(evalRes).slice(0, 2000) }
    };
    console.log(JSON.stringify(report, null, 2));
    ws.close();
    child.kill('SIGKILL');
}

main().catch((e) => {
    console.error(String(e));
    child.kill('SIGKILL');
    process.exit(1);
});
