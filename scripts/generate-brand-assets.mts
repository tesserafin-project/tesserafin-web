/** Generate the built-in brand from its two outlined SVG masters. No runtime font dependency. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SOURCE = join(ROOT, 'tesserafin-design/branding');
const CHECK = process.argv.includes('--check');
const INK = '#050e22';
const PAPER = '#f7f8ff';
const BACKGROUND = '#050e22';
const output = new Map<string, Buffer>();

function master(name: string) {
    const source = readFileSync(join(SOURCE, name), 'utf8');
    const box = source.match(/viewBox="([^"]+)"/)?.[1];
    if (!box) throw new Error(`Missing viewBox in ${name}`);
    const body = source
        .replace(/^[\s\S]*?<svg[^>]*>/, '')
        .replace(/<\/svg>\s*$/, '')
        .replace(/\s*<title>[\s\S]*?<\/title>/g, '')
        .trim();
    return { box, body, width: Number(box.split(' ')[2]) };
}

function svg(box: string, body: string) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}">\n  <title>Tesserafin</title>\n  ${body}\n</svg>\n`;
}

function add(path: string, value: string | Buffer) {
    output.set(path, typeof value === 'string' ? Buffer.from(value) : value);
}

function png(source: string, width: number) {
    return Buffer.from(
        new Resvg(source, {
            fitTo: { mode: 'width', value: width },
            font: { loadSystemFonts: false }
        })
            .render()
            .asPng()
    );
}

const mark = master('mark.svg');
const wordmark = master('wordmark.svg');
const brand = 'src/assets/branding';
add(`${brand}/mark.svg`, svg(mark.box, mark.body));
for (const [name, color] of [
    ['light', PAPER],
    ['dark', INK]
]) {
    add(
        `${brand}/mark-${name}.svg`,
        svg(mark.box, mark.body.replace(/fill="#[a-f\d]+"/g, `fill="${color}"`))
    );
    const letters = wordmark.body.replaceAll('currentColor', color);
    add(`${brand}/wordmark-${name}.svg`, svg(wordmark.box, letters));
    add(
        `${brand}/logo-${name}.svg`,
        svg(
            `0 0 ${84 + wordmark.width} 64`,
            `${mark.body}\n  <g transform="translate(84 7)">${letters}</g>`
        )
    );
}

// A fixed opaque field keeps the icon legible in browser tabs and on OS launchers.
// Maskable artwork is 56% wide: even its corners fit the central 80%-diameter safe circle.
function appIcon(markWidth: number, rounded = false) {
    const offset = (100 - markWidth) / 2;
    return svg(
        '0 0 100 100',
        `<rect width="100" height="100"${rounded ? ' rx="16"' : ''} fill="${BACKGROUND}"/>\n  <g transform="translate(${offset} ${offset}) scale(${markWidth / 64})">${mark.body}</g>`
    );
}

const favicon = appIcon(88, true);
add('src/favicons/favicon.svg', favicon);
add('src/favicons/favicon.png', png(favicon, 256));
for (const size of [72, 114, 144, 180, 192, 512]) {
    add(`src/favicons/touchicon${size}.png`, png(appIcon(72), size));
}
add('src/favicons/touchicon.png', png(appIcon(72), 180));
add('src/favicons/maskable512.png', png(appIcon(56), 512));
add(`${brand}/notification.png`, png(svg(mark.box, mark.body), 256));

// ICO with PNG-encoded entries, supported by current browsers and OS shells.
const iconSizes = [16, 32, 48, 64];
const header = Buffer.alloc(6 + iconSizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(iconSizes.length, 4);
const frames = iconSizes.map((size) => png(favicon, size));
let offset = header.length;
for (const [index, size] of iconSizes.entries()) {
    const entry = 6 + index * 16;
    header[entry] = size;
    header[entry + 1] = size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(frames[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += frames[index].length;
}
add('src/favicons/favicon.ico', Buffer.concat([header, ...frames]));

const stale: string[] = [];
for (const [relative, value] of output) {
    const path = resolve(ROOT, relative);
    if (CHECK) {
        try {
            if (!readFileSync(path).equals(value)) stale.push(relative);
        } catch {
            stale.push(relative);
        }
    } else {
        mkdirSync(resolve(path, '..'), { recursive: true });
        writeFileSync(path, value);
    }
}
if (stale.length) {
    throw new Error(`Brand exports need regeneration: ${stale.join(', ')}`);
}
console.log(
    `${CHECK ? 'Verified' : 'Generated'} ${output.size} built-in brand assets.`
);
