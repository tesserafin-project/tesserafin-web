# Server-free reader suite

Real Chromium, real production build, no Reefin server and no mock of the
reader libraries.

```sh
npm run build:production
npm run test:readers
```

`playwright.reader.config.ts` starts `tests/reader/serve.mjs`, which serves
`dist/` at the origin root. That is the point: the pdf.js worker under test is
`dist/libraries/pdf.worker.mjs`, the artifact the build copied, fetched over
HTTP from the same origin as the page — so "the worker loads from the
Tesserafin origin", "it is served with a usable JavaScript MIME type" and
"nothing leaves this origin" are all checkable rather than asserted.

The suite deliberately does NOT mount the player plugins: they depend on
`appRouter`, `ServerConnections`, `dialogHelper` and the app shell, none of
which exists without a server. `tests/reader/harness/*.html` instead reproduces
the plugin's call sequence against the library exactly — same entry point, same
worker URL shape, same options, same viewport arithmetic — so an API change
that would break the plugin breaks this suite. It caught one during the
pdfjs-dist 3 -> 6 upgrade: `PDFDocumentProxy.destroy()` no longer exists.

## What each gate covers

- `pdf-reader.spec.ts` — pdf.js against `dist/libraries/pdf.worker.mjs`.
- `epub-reader.spec.ts` — EPUB.js against the installed package: archive,
  package document, manifest, spine, navigation, first-chapter render,
  next/prev, progress from `percentageFromCfi`, theme containment inside the
  sandboxed iframe, and clean destruction of rendition and book.

`epub-reader.spec.ts` also measures **which parser EPUB.js used**. EPUB.js picks
its parser at call time from the global `DOMParser`/`XMLSerializer`, falling back
to `@xmldom/xmldom` only when they are absent; the harness subclasses both
globals before EPUB.js loads and counts constructions, so "the browser used the
browser's parser" is a measurement rather than an assumption.

The other half of that — the `@xmldom/xmldom` fallback itself, which this
repository pins to 0.8.13 under an epubjs-scoped override — cannot run here,
because EPUB.js's archive and request layers dereference `window` and
`XMLHttpRequest`. It is covered by `scripts/epub-xmldom-fallback.test.mjs`
(`npm run test:epub-xmldom-fallback`), which drives EPUB.js's XML layer with no
DOM global in scope. Neither suite is evidence for the other's environment.

### Console errors the sandbox produces on purpose

EPUB.js renders each section in an iframe with `sandbox="allow-same-origin"` and
no `allow-scripts`. Chromium logs `Blocked script execution in 'about:srcdoc'`
once per such frame even though the content documents carry no script at all.
`support/origin.ts` tracks those separately from real console errors — counting
them as defects would mean the stricter the sandbox, the redder the suite.
Everything else still has to be silent.

## Fixtures

`fixtures/make-fixtures.mjs` builds every fixture from scratch and reproduces
it byte for byte. Nothing here is copied from a third party and there is no
copyrighted content.

```sh
node tests/reader/fixtures/make-fixtures.mjs   # git diff must stay empty
```

- `sample.pdf` — 3 pages, Helvetica, real cross-reference offsets.
- `sample.epub` — EPUB 2, 2 chapters, store-only zip entries so the bytes do
  not depend on a zlib version.
- `xml/` — the same container, package and NCX documents the archive carries,
  emitted loose from the same constants, plus an EPUB 3 package and navigation
  document, an entity/CDATA/escaping document, a CRLF copy of the container and
  a non-well-formed document. These are what the Node fallback harness parses;
  emitting them from the same constants is what stops the harness and the
  archive from drifting apart.
