import darkColorScheme from '../dark';

/**
 * Reefin Classic (RFC-0005 §8.1) is, as of W13.6 WP3, a direct absorption of the legacy "Dark"
 * color scheme rather than a redefinition — the two are kept byte-identical by construction (a
 * re-export, not a copy) so they can never silently drift apart. Classic's "light" mode is, for
 * now, reachable as the separate legacy `light` preset (RFC-0005 §8.1 describes both as absorbed
 * into Classic's two modes; a unified single-id mode toggle is a follow-up, not part of this
 * tranche — see the W13.6 WP3 handoff notes).
 */
export default darkColorScheme;
