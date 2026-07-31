#!/usr/bin/env node
/**
 * Deterministic controls for EPUB.js's non-browser XML path
 * (tesserafin-project/tesserafin#95, C2).
 *
 * WHY THIS EXISTS. `package.json` pins `@xmldom/xmldom` to 0.8.13 *only under
 * epubjs*, above the `^0.7.5` range EPUB.js declares, because every 0.7.x and
 * every 0.8.x below 0.8.13 carries unfixed high-severity advisories. Going
 * outside a dependency's declared range is a claim about behaviour, and a claim
 * about behaviour has to be tested rather than asserted from the fact that the
 * two versions export the same three names.
 *
 * WHAT IT COVERS, EXACTLY. EPUB.js reaches for xmldom in two places, both
 * importing `DOMParser` from the package root:
 *
 *   src/utils/core.js  parse()          native DOMParser unless it is
 *                                       undefined, or forceXMLDom is set
 *   src/section.js     render()         native XMLSerializer unless it is
 *                                       undefined, or the UA is IE
 *
 * In a browser both natives exist, so xmldom is never entered; the chunk still
 * ships, which is why the pinned version matters even though this code path
 * does not run there. Under Node neither global exists, so xmldom *is* the
 * parser, and that is what this suite drives.
 *
 * WHAT IT DOES NOT COVER, AND WHY NOT. It does not open an EPUB archive.
 * EPUB.js cannot do that off a browser at all: `lib/archive.js` getText()
 * dereferences `window`, and `lib/book.js` request() dereferences
 * `XMLHttpRequest`. Shimming those would manufacture a code path that exists in
 * neither environment and would prove nothing about either. The archive,
 * rendering and navigation behaviour of the real reader is proven where it
 * actually runs, by the Chromium suite in tests/reader - see
 * tests/reader/README.md. This file is the other half: the XML layer, in the
 * environment that reaches xmldom.
 *
 * The documents parsed here are the *same bytes* the archive carries.
 * tests/reader/fixtures/make-fixtures.mjs emits both from one set of
 * constants, so a fixture drift cannot silently decouple them.
 *
 * Usage:
 *   node scripts/epub-xmldom-fallback.test.mjs [--emit FILE]
 *
 * `--emit` writes the semantic snapshot as JSON. Running it once per resolved
 * xmldom version and diffing the two files is how the 0.7.x -> 0.8.13 move was
 * cleared: the assertions below pin what must not change, and the snapshot
 * shows everything else that did.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(REPO_ROOT, 'tests', 'reader', 'fixtures', 'xml');

const require = createRequire(import.meta.url);

const argv = process.argv.slice(2);
const emitIndex = argv.indexOf('--emit');
const emitPath = emitIndex === -1 ? null : argv[emitIndex + 1];

if (emitIndex !== -1 && !emitPath) {
    console.error('epub-xmldom-fallback: --emit needs a file path');
    process.exit(2);
}

let failures = 0;

const ok = (message) => {
    console.log(`  PASS: ${message}`);
};

const bad = (message) => {
    failures += 1;
    console.log(`  FAIL: ${message}`);
};

/** Structural equality against a literal, reported with both sides on failure. */
function same(actual, expected, description) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a === b) {
        ok(description);
    } else {
        bad(`${description}\n        expected ${b}\n        actual   ${a}`);
    }
}

const is = (actual, expected, description) => {
    if (actual === expected) {
        ok(description);
    } else {
        bad(`${description} (expected ${expected}, got ${actual})`);
    }
};

/* ------------------------------------------------- the absent globals -- */

/**
 * The whole suite is meaningless if a DOM global is in scope: EPUB.js would
 * take the native branch and xmldom would never be exercised. Node has never
 * defined either of these, but "has never" is not "cannot", so they are
 * removed rather than assumed away, and the removal is asserted.
 */
delete globalThis.DOMParser;
delete globalThis.XMLSerializer;

is(typeof globalThis.DOMParser, 'undefined', 'globalThis.DOMParser is absent');
is(
    typeof globalThis.XMLSerializer,
    'undefined',
    'globalThis.XMLSerializer is absent'
);

/* ------------------------------------------------------- the versions -- */

const xmldomVersion = require('@xmldom/xmldom/package.json').version;
const epubjsVersion = require('epubjs/package.json').version;
const epubjsDeclaredRange = require('epubjs/package.json').dependencies[
    '@xmldom/xmldom'
];

const xmldom = require('@xmldom/xmldom');

console.log(
    `\nepubjs ${epubjsVersion} (declares @xmldom/xmldom ${epubjsDeclaredRange})` +
        `\n@xmldom/xmldom ${xmldomVersion} resolved` +
        `\nnode ${process.version}\n`
);

same(
    Object.keys(xmldom).sort(),
    ['DOMImplementation', 'DOMParser', 'XMLSerializer'],
    'the xmldom package root exports exactly the three documented names'
);

/* -------------------------------------------------- EPUB.js internals -- */

const core = require('epubjs/lib/utils/core.js');
const Container = require('epubjs/lib/container.js').default;
const Packaging = require('epubjs/lib/packaging.js').default;
const Navigation = require('epubjs/lib/navigation.js').default;

const fixture = (name) => readFileSync(join(FIXTURES, name), 'utf8');

/**
 * EPUB.js's own parse(), reached with no DOM global in scope. Asserting the
 * result came from xmldom rather than from something else is the difference
 * between testing this dependency and testing an assumption about it.
 */
function parse(name, mime = 'application/xml') {
    const doc = core.parse(fixture(name), mime);
    if (doc?.constructor?.name !== 'Document') {
        bad(`${name}: parse() did not return an xmldom Document`);
    }
    return doc;
}

/* ------------------------------------------------------- container.xml -- */

const container = new Container(parse('container.xml'));

is(
    container.packagePath,
    'OEBPS/content.opf',
    'container.xml: the package path is read through the OCF namespace'
);
is(container.directory, 'OEBPS', 'container.xml: the package directory');

// `Container.encoding` is `containerDocument.xmlEncoding`, a Document property
// xmldom is free not to implement. It is recorded in the snapshot and not
// asserted: EPUB.js itself never reads it back, so its value cannot change what
// a reader does.
console.log(
    `  NOTE: container.encoding = ${JSON.stringify(container.encoding)} ` +
        '(Document.xmlEncoding, recorded not asserted)'
);

/**
 * CRLF is where xmldom 0.8 became spec-correct: XML 1.0 §2.11 requires a
 * parser to normalise CRLF to LF, and 0.7 did not. The fixture pair exists so
 * that difference is measured rather than assumed, and the assertion is on the
 * *semantic* result - which must be identical either way, because line endings
 * around markup carry no meaning.
 */
const containerCrlf = new Container(parse('container-crlf.xml'));

is(
    containerCrlf.packagePath,
    container.packagePath,
    'container-crlf.xml: CRLF line endings give the same package path'
);
is(
    containerCrlf.directory,
    container.directory,
    'container-crlf.xml: CRLF line endings give the same directory'
);

/* ----------------------------------------------- EPUB 2 package + NCX -- */

const packaging2 = new Packaging(parse('package-epub2.opf'));

same(
    {
        title: packaging2.metadata.title,
        creator: packaging2.metadata.creator,
        language: packaging2.metadata.language,
        identifier: packaging2.metadata.identifier,
        rights: packaging2.metadata.rights
    },
    {
        title: 'Tesserafin EPUB Fixture',
        creator: 'Tesserafin project',
        language: 'en',
        identifier: 'urn:uuid:tesserafin-epub-fixture',
        rights: 'Written for this repository. No third-party content.'
    },
    'EPUB 2 package: Dublin Core metadata'
);

same(
    Object.keys(packaging2.manifest).sort(),
    ['chapter1', 'chapter2', 'css', 'ncx'],
    'EPUB 2 package: manifest ids'
);

same(
    Object.entries(packaging2.manifest)
        .map(([id, item]) => [id, item.href, item.type])
        .sort(),
    [
        ['chapter1', 'chapter1.xhtml', 'application/xhtml+xml'],
        ['chapter2', 'chapter2.xhtml', 'application/xhtml+xml'],
        ['css', 'style.css', 'text/css'],
        ['ncx', 'toc.ncx', 'application/x-dtbncx+xml']
    ],
    'EPUB 2 package: manifest hrefs and media types'
);

same(
    packaging2.spine.map((item) => [item.idref, item.index, item.linear]),
    [
        ['chapter1', 0, 'yes'],
        ['chapter2', 1, 'yes']
    ],
    'EPUB 2 package: spine order, indices and linearity'
);

is(packaging2.ncxPath, 'toc.ncx', 'EPUB 2 package: the NCX path');
is(packaging2.navPath, false, 'EPUB 2 package: no EPUB 3 navigation document');
is(
    packaging2.uniqueIdentifier,
    'urn:uuid:tesserafin-epub-fixture',
    'EPUB 2 package: the unique identifier resolves through unique-identifier'
);

const ncx = new Navigation(parse('toc.ncx'));

same(
    ncx.toc.map((item) => [item.label.trim(), item.href]),
    [
        ['Chapter One', 'chapter1.xhtml'],
        ['Chapter Two', 'chapter2.xhtml']
    ],
    'EPUB 2 NCX: navMap order, labels and targets'
);

/* ------------------------------------------------ EPUB 3 package + nav -- */

const packaging3 = new Packaging(parse('package-epub3.opf'));

same(
    {
        title: packaging3.metadata.title,
        creator: packaging3.metadata.creator,
        description: packaging3.metadata.description,
        modified_date: packaging3.metadata.modified_date
    },
    {
        // `&amp;` and `&#8212;` are resolved by the parser, not by EPUB.js.
        title: 'Tesserafin EPUB 3 Fixture & Friends',
        creator: 'Tesserafin project — readers team',
        // CDATA content reaches the caller literally, unescaped and unparsed.
        description: 'Angle brackets <b>stay literal</b> inside CDATA.',
        modified_date: '1980-01-01T00:00:00Z'
    },
    'EPUB 3 package: entities, character references and CDATA in metadata'
);

is(
    packaging3.navPath,
    'nav.xhtml',
    'EPUB 3 package: the navigation document is found by properties="nav"'
);
is(packaging3.ncxPath, false, 'EPUB 3 package: no NCX');

same(
    packaging3.spine.map((item) => [item.idref, item.index]),
    [
        ['chapter1', 0],
        ['chapter2', 1]
    ],
    'EPUB 3 package: spine order and indices'
);

const nav = new Navigation(parse('nav.xhtml', 'application/xhtml+xml'));
const navToc = nav.toc.map((item) => [item.label.trim(), item.href]);

/**
 * EPUB.js's EPUB 3 nav parser walks `element.children`, a DOM4 property xmldom
 * does not have to provide; without it `parseNavList` returns early and the toc
 * is empty. So the outcome that must hold is not "two entries" but "either
 * nothing, or exactly the right thing" - an empty toc is a known EPUB.js/xmldom
 * limitation off a browser, a *wrong* toc would be corruption. Chromium parses
 * this document natively and is where the nav toc is proven populated.
 */
const NAV_EXPECTED = [
    ['Chapter One', 'chapter1.xhtml'],
    ['Chapter Two', 'chapter2.xhtml']
];

if (navToc.length === 0) {
    ok(
        'EPUB 3 nav: toc is empty - xmldom does not implement Element.children, ' +
            "which EPUB.js's nav parser walks (known limitation, browser path unaffected)"
    );
} else {
    same(navToc, NAV_EXPECTED, 'EPUB 3 nav: toc order, labels and targets');
}

/* ------------------------------------------ entities, escapes, spaces -- */

const entities = parse('entities.xml');
const textOf = (tag) => core.qs(entities, tag).textContent;
const attributes = core.qs(entities, 'attributes');

is(
    textOf('predefined'),
    `& < > " '`,
    'entities: the five XML-predefined entities are resolved'
);
is(
    textOf('numeric'),
    'é é —',
    'entities: decimal and hexadecimal character references are resolved'
);
is(
    textOf('cdata'),
    'a < b && c > d',
    'entities: CDATA content is delivered literally'
);
is(
    attributes.getAttribute('escaped'),
    'a & b < c "quoted"',
    'entities: escapes inside an attribute value are resolved'
);
is(
    attributes.getAttribute('x:qualified'),
    'ns value',
    'entities: a namespace-qualified attribute is readable by qualified name'
);
is(
    core.qs(entities, 'whitespace').getAttribute('keep'),
    '  two  spaces  ',
    'entities: significant whitespace inside an attribute value is preserved'
);

/* ------------------------------------------------- serialize and back -- */

/**
 * EPUB.js's own serialize path (Section.render) cannot be driven here, and not
 * because of the environment: `src/section.js` imports xmldom's *DOMParser*
 * under the alias `XMLDOMSerializer` and then calls `serializeToString` on it.
 * That is an upstream defect, it is identical in 0.7.x and 0.8.13, and this
 * suite records it rather than papering over it - see the snapshot's
 * `sectionSerializerDefect`.
 *
 * What is exercised instead is the round trip EPUB.js would rely on if that
 * defect were fixed: serialize a parsed package document, parse it again, and
 * require the extracted meaning to survive. Raw bytes are deliberately not
 * compared - 0.8 changed attribute-whitespace serialisation on purpose.
 */
const serialized = new xmldom.XMLSerializer().serializeToString(
    parse('package-epub2.opf')
);
const reparsed = new Packaging(core.parse(serialized, 'application/xml'));

same(
    {
        metadata: reparsed.metadata.title,
        manifest: Object.keys(reparsed.manifest).sort(),
        spine: reparsed.spine.map((i) => i.idref),
        ncxPath: reparsed.ncxPath
    },
    {
        metadata: packaging2.metadata.title,
        manifest: Object.keys(packaging2.manifest).sort(),
        spine: packaging2.spine.map((i) => i.idref),
        ncxPath: packaging2.ncxPath
    },
    'round trip: serialising and reparsing the package preserves its meaning'
);

/** The upstream defect, pinned so a future EPUB.js that fixes it is noticed. */
const sectionSerializerDefect = (() => {
    try {
        new xmldom.DOMParser().serializeToString(parse('container.xml'));
        return { throws: false, kind: null };
    } catch (error) {
        return { throws: true, kind: error?.constructor?.name ?? 'unknown' };
    }
})();

is(
    sectionSerializerDefect.throws,
    true,
    "upstream defect intact: xmldom's DOMParser has no serializeToString, so " +
        'Section.render() cannot serialise off a browser'
);

/* ------------------------------------------------- malformed rejection -- */

/**
 * Recorded, not asserted. xmldom 0.7 warned and carried on where 0.8 reports
 * the error, and neither is "the" correct answer for a caller that must decide
 * what a broken EPUB does. What matters is that the reader can tell - which it
 * can, in both versions, from the parsererror element. A difference here is
 * expected and documented; a difference in manifest, spine, navigation or
 * metadata above is not.
 */
const malformed = (() => {
    try {
        const doc = core.parse(fixture('malformed.xml'), 'application/xml');
        const errors = doc?.getElementsByTagName?.('parsererror') ?? [];
        return {
            threw: false,
            parsererrorNodes: errors.length,
            documentElement: doc?.documentElement?.nodeName ?? null
        };
    } catch (error) {
        return {
            threw: true,
            error: error?.constructor?.name ?? 'unknown',
            parsererrorNodes: 0
        };
    }
})();

console.log(
    `  NOTE: malformed XML -> ${JSON.stringify(malformed)} ` +
        '(recorded not asserted; see the comment above)'
);

// What *is* asserted is the other side of it: a well-formed document must not
// carry a parsererror. Without that, "0.7 reports nothing" and "this fixture is
// fine" would be indistinguishable.
is(
    parse('container.xml').getElementsByTagName('parsererror').length,
    0,
    'a well-formed document carries no parsererror element'
);

/* -------------------------------------------------------- the snapshot -- */

const snapshot = {
    epubjs: epubjsVersion,
    epubjsDeclaredRange,
    xmldom: xmldomVersion,
    // Deliberately not process.version: the snapshot is compared across two
    // installs on one machine, and a Node upgrade between them would show up
    // as a diff in every field's provenance rather than in the field itself.
    xmldomExports: Object.keys(xmldom).sort(),
    container: {
        packagePath: container.packagePath,
        directory: container.directory,
        encoding: container.encoding
    },
    containerCrlf: {
        packagePath: containerCrlf.packagePath,
        directory: containerCrlf.directory,
        encoding: containerCrlf.encoding
    },
    packaging2: {
        metadata: packaging2.metadata,
        manifest: packaging2.manifest,
        spine: packaging2.spine,
        spineNodeIndex: packaging2.spineNodeIndex,
        navPath: packaging2.navPath,
        ncxPath: packaging2.ncxPath,
        coverPath: packaging2.coverPath,
        uniqueIdentifier: packaging2.uniqueIdentifier
    },
    packaging3: {
        metadata: packaging3.metadata,
        manifest: packaging3.manifest,
        spine: packaging3.spine,
        spineNodeIndex: packaging3.spineNodeIndex,
        navPath: packaging3.navPath,
        ncxPath: packaging3.ncxPath,
        coverPath: packaging3.coverPath,
        uniqueIdentifier: packaging3.uniqueIdentifier
    },
    ncxToc: ncx.toc,
    navToc: nav.toc,
    entities: {
        predefined: textOf('predefined'),
        numeric: textOf('numeric'),
        cdata: textOf('cdata'),
        escapedAttribute: attributes.getAttribute('escaped'),
        qualifiedAttribute: attributes.getAttribute('x:qualified'),
        whitespaceAttribute: core
            .qs(entities, 'whitespace')
            .getAttribute('keep')
    },
    // Raw serialiser output, kept in full. 0.8 changed attribute-whitespace
    // serialisation deliberately, and the point of a snapshot is to show that
    // rather than to hide it behind a normalising comparison.
    serialized,
    sectionSerializerDefect,
    malformed
};

if (emitPath) {
    writeFileSync(emitPath, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(`\n  snapshot written to ${emitPath}`);
}

console.log(
    `\n  failures: ${failures}\n` +
        `  verdict: ${failures === 0 ? 'EPUB.js XML layer intact on xmldom ' + xmldomVersion : 'REGRESSION'}\n`
);

process.exit(failures === 0 ? 0 : 1);
