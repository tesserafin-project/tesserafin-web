#!/usr/bin/env node
/**
 * Builds the reader fixtures from scratch, byte-deterministically.
 *
 * The fixtures are project-owned: nothing here is copied from a third party,
 * there is no copyrighted content, and no binary blob enters the repository
 * that this script cannot reproduce. Run it and `git diff` must be empty:
 *
 *     node tests/reader/fixtures/make-fixtures.mjs
 *
 * sample.pdf  -- 3 pages, Helvetica text, no images, no fonts embedded.
 * sample.epub -- EPUB 2 archive, 2 chapters, uncompressed (stored) entries so
 *                the byte output does not depend on a zlib version.
 * xml/*       -- loose XML documents for the Node xmldom fallback harness
 *                (scripts/epub-xmldom-fallback.test.mjs). They are the same
 *                document shapes an EPUB carries, kept outside the archive
 *                because that harness drives EPUB.js's XML layer directly:
 *                EPUB.js cannot open an archive off a browser (see the
 *                harness header).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ PDF -- */

const PAGE_TEXTS = [
    'Tesserafin PDF fixture page one',
    'Tesserafin PDF fixture page two',
    'Tesserafin PDF fixture page three'
];

/** A 3-page PDF with a cross-reference table computed from real byte offsets. */
function buildPdf() {
    const objects = [];
    const add = (body) => {
        objects.push(body);
        return objects.length; // 1-based object number
    };

    // 1 catalog, 2 pages tree, 3 font, then per page: page object + content
    const catalogNum = 1;
    const pagesNum = 2;
    const fontNum = 3;
    objects.push(null, null, null); // placeholders for 1..3

    const pageNums = [];
    for (const text of PAGE_TEXTS) {
        const stream = 'BT\n/F1 24 Tf\n72 700 Td\n(' + text + ') Tj\nET\n';
        const contentNum = add(
            `<< /Length ${stream.length} >>\nstream\n${stream}endstream`
        );
        const pageNum = add(
            `<< /Type /Page /Parent ${pagesNum} 0 R ` +
                `/MediaBox [0 0 612 792] ` +
                `/Resources << /Font << /F1 ${fontNum} 0 R >> >> ` +
                `/Contents ${contentNum} 0 R >>`
        );
        pageNums.push(pageNum);
    }

    objects[catalogNum - 1] = `<< /Type /Catalog /Pages ${pagesNum} 0 R >>`;
    objects[pagesNum - 1] =
        `<< /Type /Pages /Count ${pageNums.length} ` +
        `/Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] >>`;
    objects[fontNum - 1] =
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

    let pdf = '%PDF-1.4\n';
    const offsets = [];
    objects.forEach((body, i) => {
        offsets[i] = pdf.length;
        pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });

    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) {
        pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    }
    pdf +=
        `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNum} 0 R >>\n` +
        `startxref\n${xrefOffset}\n%%EOF\n`;

    return Buffer.from(pdf, 'latin1');
}

/* ----------------------------------------------------------------- EPUB -- */

const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c;
    }
    return table;
})();

function crc32(buf) {
    let c = -1;
    for (const byte of buf) {
        c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
    }
    return (c ^ -1) >>> 0;
}

/**
 * Minimal store-only ZIP writer. No compression, so the bytes depend on this
 * file and nothing else -- notably not on a zlib version. EPUB requires the
 * `mimetype` entry to be first and stored, which this satisfies by
 * construction.
 */
function buildZip(entries) {
    const locals = [];
    const central = [];
    let offset = 0;

    for (const { name, data } of entries) {
        const nameBuf = Buffer.from(name, 'utf8');
        const crc = crc32(data);

        const local = Buffer.alloc(30 + nameBuf.length);
        local.writeUInt32LE(0x04034b50, 0); // local file header
        local.writeUInt16LE(10, 4); // version needed
        local.writeUInt16LE(0, 6); // flags
        local.writeUInt16LE(0, 8); // method: stored
        local.writeUInt16LE(0, 10); // mod time
        local.writeUInt16LE(0x21, 12); // mod date (1980-01-01)
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28); // extra length
        nameBuf.copy(local, 30);

        const dir = Buffer.alloc(46 + nameBuf.length);
        dir.writeUInt32LE(0x02014b50, 0); // central directory header
        dir.writeUInt16LE(20, 4); // version made by
        dir.writeUInt16LE(10, 6); // version needed
        dir.writeUInt16LE(0, 8);
        dir.writeUInt16LE(0, 10);
        dir.writeUInt16LE(0, 12);
        dir.writeUInt16LE(0x21, 14);
        dir.writeUInt32LE(crc, 16);
        dir.writeUInt32LE(data.length, 20);
        dir.writeUInt32LE(data.length, 24);
        dir.writeUInt16LE(nameBuf.length, 28);
        dir.writeUInt16LE(0, 30);
        dir.writeUInt16LE(0, 32);
        dir.writeUInt16LE(0, 34);
        dir.writeUInt16LE(0, 36);
        dir.writeUInt32LE(0, 38);
        dir.writeUInt32LE(offset, 42);
        nameBuf.copy(dir, 46);

        locals.push(local, data);
        central.push(dir);
        offset += local.length + data.length;
    }

    const centralBuf = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralBuf.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);

    return Buffer.concat([...locals, centralBuf, end]);
}

const utf8 = (s) => Buffer.from(s, 'utf8');

const CHAPTERS = [
    {
        id: 'chapter1',
        href: 'chapter1.xhtml',
        title: 'Chapter One',
        body: 'Tesserafin EPUB fixture chapter one. This paragraph exists so a rendered chapter has visible text to assert on.'
    },
    {
        id: 'chapter2',
        href: 'chapter2.xhtml',
        title: 'Chapter Two',
        body: 'Tesserafin EPUB fixture chapter two. Navigating forward must land here and navigating back must return to chapter one.'
    }
];

function chapterXhtml({ title, body }) {
    return utf8(
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
            `<!DOCTYPE html>\n` +
            `<html xmlns="http://www.w3.org/1999/xhtml">\n` +
            `<head><title>${title}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>\n` +
            `<body><h1>${title}</h1><p>${body}</p></body>\n` +
            `</html>\n`
    );
}

const MANIFEST_ITEMS = CHAPTERS.map(
    (c) =>
        `    <item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml"/>`
).join('\n');

const SPINE_ITEMS = CHAPTERS.map((c) => `    <itemref idref="${c.id}"/>`).join(
    '\n'
);

const NAV_POINTS = CHAPTERS.map(
    (c, i) =>
        `    <navPoint id="nav-${c.id}" playOrder="${i + 1}">\n` +
        `      <navLabel><text>${c.title}</text></navLabel>\n` +
        `      <content src="${c.href}"/>\n` +
        `    </navPoint>`
).join('\n');

/**
 * The three XML documents an EPUB 2 reader parses. They are module-level
 * constants rather than inline literals so the loose `xml/` fixtures the Node
 * fallback harness reads are byte-identical to the archive's own entries -
 * a harness that parsed a different document than the reader would prove
 * nothing about the reader.
 */
const CONTAINER_XML =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n` +
    `  <rootfiles>\n` +
    `    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n` +
    `  </rootfiles>\n` +
    `</container>\n`;

const PACKAGE_OPF =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">\n` +
    `  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n` +
    `    <dc:title>Tesserafin EPUB Fixture</dc:title>\n` +
    `    <dc:creator>Tesserafin project</dc:creator>\n` +
    `    <dc:language>en</dc:language>\n` +
    `    <dc:identifier id="bookid">urn:uuid:tesserafin-epub-fixture</dc:identifier>\n` +
    `    <dc:rights>Written for this repository. No third-party content.</dc:rights>\n` +
    `  </metadata>\n` +
    `  <manifest>\n` +
    `    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n` +
    `    <item id="css" href="style.css" media-type="text/css"/>\n` +
    `${MANIFEST_ITEMS}\n` +
    `  </manifest>\n` +
    `  <spine toc="ncx">\n` +
    `${SPINE_ITEMS}\n` +
    `  </spine>\n` +
    `</package>\n`;

const TOC_NCX =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n` +
    `  <head><meta name="dtb:uid" content="urn:uuid:tesserafin-epub-fixture"/></head>\n` +
    `  <docTitle><text>Tesserafin EPUB Fixture</text></docTitle>\n` +
    `  <navMap>\n` +
    `${NAV_POINTS}\n` +
    `  </navMap>\n` +
    `</ncx>\n`;

function buildEpub() {
    const entries = [
        // MUST be first and stored -- EPUB OCF requirement.
        { name: 'mimetype', data: utf8('application/epub+zip') },
        { name: 'META-INF/container.xml', data: utf8(CONTAINER_XML) },
        { name: 'OEBPS/content.opf', data: utf8(PACKAGE_OPF) },
        { name: 'OEBPS/toc.ncx', data: utf8(TOC_NCX) },
        {
            name: 'OEBPS/style.css',
            data: utf8('body { font-family: serif; margin: 1em; }\n')
        },
        ...CHAPTERS.map((c) => ({
            name: `OEBPS/${c.href}`,
            data: chapterXhtml(c)
        }))
    ];

    return buildZip(entries);
}

/* ----------------------------------------------- XML fallback fixtures -- */

/**
 * An EPUB 3 package document: `properties="nav"` on the navigation item, the
 * EPUB 3 `<meta property="dcterms:modified">` refinement, and metadata that
 * carries the four things a parser can get wrong independently of structure -
 * a predefined entity, a numeric character reference, an escaped attribute
 * value, and a CDATA section.
 */
const PACKAGE_OPF3 =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">\n` +
    `  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n` +
    `    <dc:title>Tesserafin EPUB 3 Fixture &amp; Friends</dc:title>\n` +
    `    <dc:creator>Tesserafin project &#8212; readers team</dc:creator>\n` +
    `    <dc:language>en</dc:language>\n` +
    `    <dc:identifier id="bookid">urn:uuid:tesserafin-epub3-fixture</dc:identifier>\n` +
    `    <dc:description><![CDATA[Angle brackets <b>stay literal</b> inside CDATA.]]></dc:description>\n` +
    `    <dc:rights>Written for this repository. No third-party content.</dc:rights>\n` +
    `    <meta property="dcterms:modified">1980-01-01T00:00:00Z</meta>\n` +
    `  </metadata>\n` +
    `  <manifest>\n` +
    `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n` +
    `    <item id="css" href="style.css" media-type="text/css"/>\n` +
    `${MANIFEST_ITEMS}\n` +
    `  </manifest>\n` +
    `  <spine>\n` +
    `${SPINE_ITEMS}\n` +
    `  </spine>\n` +
    `</package>\n`;

/** The EPUB 3 navigation document matching PACKAGE_OPF3. */
const NAV_XHTML =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">\n` +
    `<head><title>Contents</title></head>\n` +
    `<body>\n` +
    `  <nav epub:type="toc" id="toc">\n` +
    `    <h1>Contents</h1>\n` +
    `    <ol>\n` +
    CHAPTERS.map(
        (c) =>
            `      <li id="nav-${c.id}"><a href="${c.href}">${c.title}</a></li>`
    ).join('\n') +
    `\n` +
    `    </ol>\n` +
    `  </nav>\n` +
    `</body>\n` +
    `</html>\n`;

/**
 * Escaping and entity surface, isolated from EPUB structure so a difference
 * here cannot be confused with a manifest or spine difference. Every entity
 * used is XML-predefined or a numeric character reference: no DTD-declared
 * entity, which neither xmldom 0.7 nor 0.8 expands, and which a fixture has
 * no business depending on.
 */
const ENTITIES_XML =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<doc xmlns="urn:tesserafin:fixture" xmlns:x="urn:tesserafin:fixture:x">\n` +
    `  <predefined>&amp; &lt; &gt; &quot; &apos;</predefined>\n` +
    `  <numeric>&#233; &#xE9; &#8212;</numeric>\n` +
    `  <cdata><![CDATA[a < b && c > d]]></cdata>\n` +
    `  <attributes plain="one" escaped="a &amp; b &lt; c &quot;quoted&quot;" x:qualified="ns value"/>\n` +
    `  <whitespace keep="  two  spaces  ">  text  </whitespace>\n` +
    `</doc>\n`;

/** Not well formed: `<rootfiles>` is never closed. */
const MALFORMED_XML =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n` +
    `  <rootfiles>\n` +
    `    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n` +
    `</container>\n`;

const XML_FIXTURES = [
    ['container.xml', CONTAINER_XML],
    // Same document, CRLF line endings. xmldom 0.8 normalises XML line
    // endings the way the spec requires and 0.7 did not, so this pair is what
    // makes that difference visible instead of hidden.
    ['container-crlf.xml', CONTAINER_XML.replace(/\n/g, '\r\n')],
    ['package-epub2.opf', PACKAGE_OPF],
    ['package-epub3.opf', PACKAGE_OPF3],
    ['toc.ncx', TOC_NCX],
    ['nav.xhtml', NAV_XHTML],
    ['entities.xml', ENTITIES_XML],
    ['malformed.xml', MALFORMED_XML]
];

/* ---------------------------------------------------------------- write -- */

mkdirSync(join(HERE, 'xml'), { recursive: true });

for (const [name, data] of [
    ['sample.pdf', buildPdf()],
    ['sample.epub', buildEpub()],
    ...XML_FIXTURES.map(([name, text]) => [join('xml', name), utf8(text)])
]) {
    const target = join(HERE, name);
    writeFileSync(target, data);
    console.log(
        `${name}  ${data.length} bytes  sha256=${createHash('sha256')
            .update(data)
            .digest('hex')}`
    );
}
