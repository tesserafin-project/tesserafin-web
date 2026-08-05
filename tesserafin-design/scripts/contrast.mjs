/**
 * WCAG 2.2 relative-luminance and contrast-ratio maths for the token palettes (RFC-0007 §6.4).
 *
 * Dependency-free and side-effect-free, for the same reason `validate-schema.mjs` is: this runs in
 * Node (the palette gate) and in the browser (the Theme Studio's live validation), and one
 * implementation used by both is the only way those two can agree about whether a palette passes.
 *
 * ## Alpha is composited, not ignored
 *
 * Several semantic tokens are declared as `rgba(...)` — Classic's `textMuted` is
 * `rgba(255,255,255,0.7)`. Measuring such a token as if it were opaque reports a contrast the user
 * never sees. Every colour is therefore composited over what is actually behind it before the ratio
 * is computed: the pair's background over the theme's `background`, then the foreground over that.
 */

/**
 * @typedef {[number, number, number, number]} Rgba r,g,b in 0-255, a in 0-1.
 */

/**
 * Parses the colour notations `tokens.schema.json#/$defs/colorValue` admits: #rgb, #rgba, #rrggbb,
 * #rrggbbaa, rgb(), rgba(), hsl(), hsla().
 *
 * @param {string} value
 * @returns {Rgba | null} `null` for anything unparseable — the caller decides whether that is a
 *   failure or a skip, rather than this function inventing black.
 */
export function parseColor(value) {
    if (typeof value !== 'string') return null;
    const input = value.trim();
    if (input.startsWith('#')) return parseHex(input.slice(1));
    return parseFunctional(input);
}

function parseHex(digits) {
    const hex =
        digits.length === 3 || digits.length === 4
            ? digits
                  .split('')
                  .map((c) => c + c)
                  .join('')
            : digits;
    if (hex.length !== 6 && hex.length !== 8) return null;
    if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
    const n = Number.parseInt(hex.slice(0, 6), 16);
    const alpha =
        hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

function parseFunctional(input) {
    const rgbMatch = /^rgba?\(([^)]+)\)$/i.exec(input);
    if (rgbMatch) return parseRgbArgs(splitArgs(rgbMatch[1]));
    const hslMatch = /^hsla?\(([^)]+)\)$/i.exec(input);
    if (hslMatch) return parseHslArgs(splitArgs(hslMatch[1]));
    return null;
}

function splitArgs(body) {
    return body.split(/[,/]/).map((part) => part.trim());
}

function parseRgbArgs(args) {
    const [r, g, b] = args.slice(0, 3).map((part) => Number.parseFloat(part));
    if ([r, g, b].some((n) => Number.isNaN(n))) return null;
    return [r, g, b, parseAlpha(args[3])];
}

function parseHslArgs(args) {
    const h = Number.parseFloat(args[0]);
    const s = Number.parseFloat(args[1]) / 100;
    const l = Number.parseFloat(args[2]) / 100;
    if ([h, s, l].some((n) => Number.isNaN(n))) return null;
    return [...hslToRgb(h, s, l), parseAlpha(args[3])];
}

function parseAlpha(raw) {
    if (raw === undefined) return 1;
    const alpha = Number.parseFloat(raw);
    return Number.isNaN(alpha) ? 1 : alpha;
}

/** Sector table for the HSL->RGB conversion, indexed by `floor(hue / 60)`. */
const HSL_SECTORS = [
    (c, x) => [c, x, 0],
    (c, x) => [x, c, 0],
    (c, x) => [0, c, x],
    (c, x) => [0, x, c],
    (c, x) => [x, 0, c],
    (c, x) => [c, 0, x]
];

function hslToRgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = (((h % 360) + 360) % 360) / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    const [r1, g1, b1] = HSL_SECTORS[Math.min(Math.floor(hp), 5)](c, x);
    const m = l - c / 2;
    return [
        Math.round((r1 + m) * 255),
        Math.round((g1 + m) * 255),
        Math.round((b1 + m) * 255)
    ];
}

/**
 * Composites a possibly-translucent colour over an opaque one (source-over).
 *
 * @param {Rgba} foreground
 * @param {Rgba} background Assumed opaque; its alpha is ignored.
 * @returns {Rgba} An opaque colour.
 */
export function compositeOver(foreground, background) {
    const a = Math.min(Math.max(foreground[3], 0), 1);
    return [
        foreground[0] * a + background[0] * (1 - a),
        foreground[1] * a + background[1] * (1 - a),
        foreground[2] * a + background[2] * (1 - a),
        1
    ];
}

/**
 * WCAG 2.2 relative luminance.
 *
 * @param {Rgba} rgba Must be opaque — composite first.
 */
export function relativeLuminance(rgba) {
    const [r, g, b] = [rgba[0], rgba[1], rgba[2]].map((channel) => {
        const v = channel / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG 2.2 contrast ratio, 1..21.
 *
 * @param {Rgba} foreground Opaque.
 * @param {Rgba} background Opaque.
 */
export function contrastRatio(foreground, background) {
    const a = relativeLuminance(foreground);
    const b = relativeLuminance(background);
    const [lighter, darker] = a >= b ? [a, b] : [b, a];
    return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The pairs a palette is checked on, and the WCAG 2.2 threshold each must meet.
 *
 * 4.5 is SC 1.4.3 (contrast minimum, normal-size text). 3.0 is SC 1.4.11 (non-text contrast) — it
 * applies to the focus indicator and to colour that carries meaning in a UI component, not to a
 * decorative hairline, which is why `divider` is not on this list at all: a divider that met 3:1
 * would be a rule, not a divider, and WCAG does not ask for it.
 */
export const CONTRAST_REQUIREMENTS = [
    { foreground: 'text', background: 'background', min: 4.5, sc: '1.4.3' },
    { foreground: 'text', background: 'surface', min: 4.5, sc: '1.4.3' },
    {
        foreground: 'textMuted',
        background: 'background',
        min: 4.5,
        sc: '1.4.3'
    },
    { foreground: 'textMuted', background: 'surface', min: 4.5, sc: '1.4.3' },
    { foreground: 'onPrimary', background: 'primary', min: 4.5, sc: '1.4.3' },
    { foreground: 'primary', background: 'background', min: 3, sc: '1.4.11' },
    { foreground: 'accent', background: 'background', min: 3, sc: '1.4.11' },
    { foreground: 'error', background: 'background', min: 3, sc: '1.4.11' },
    { foreground: 'warning', background: 'background', min: 3, sc: '1.4.11' },
    { foreground: 'success', background: 'background', min: 3, sc: '1.4.11' },
    { foreground: 'focus', background: 'background', min: 3, sc: '1.4.11' },
    { foreground: 'focus', background: 'surface', min: 3, sc: '1.4.11' }
];

/**
 * Measures every {@link CONTRAST_REQUIREMENTS} pair for one mode of one palette.
 *
 * @param {Record<string, string>} colorGroup One `tokens.color.<mode>` group.
 * @returns {{pair: string, ratio: number, min: number, sc: string, passes: boolean}[]}
 */
export function measurePalette(colorGroup) {
    const pageBackground = parseColor(colorGroup.background);
    if (!pageBackground) {
        throw new Error(
            `Unparseable "background" colour: ${JSON.stringify(colorGroup.background)}`
        );
    }
    const opaquePageBackground = compositeOver(
        pageBackground,
        [255, 255, 255, 1]
    );

    return CONTRAST_REQUIREMENTS.map((requirement) => {
        const rawBackground = parseColor(colorGroup[requirement.background]);
        const rawForeground = parseColor(colorGroup[requirement.foreground]);
        if (!rawBackground || !rawForeground) {
            throw new Error(
                `Unparseable colour in pair ${requirement.foreground}/${requirement.background}`
            );
        }
        const background = compositeOver(rawBackground, opaquePageBackground);
        const foreground = compositeOver(rawForeground, background);
        const ratio = contrastRatio(foreground, background);
        return {
            pair: `${requirement.foreground}/${requirement.background}`,
            ratio: Math.round(ratio * 100) / 100,
            min: requirement.min,
            sc: requirement.sc,
            passes: ratio >= requirement.min
        };
    });
}
