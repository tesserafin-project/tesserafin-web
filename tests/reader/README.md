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

## Fixtures

`fixtures/make-fixtures.mjs` builds every fixture from scratch and reproduces
it byte for byte. Nothing here is copied from a third party and there is no
copyrighted content.

```sh
node tests/reader/fixtures/make-fixtures.mjs   # git diff must stay empty
```

- `sample.pdf` — 3 pages, Helvetica, real cross-reference offsets.
- `sample.epub` — EPUB 2, 2 chapters, store-only zip entries so the bytes do
  not depend on a zlib version. It has no spec driving it yet: the EPUB reader
  gate lands with the `epubjs` remediation, which is still an open owner
  decision (see the pull request). The fixture is committed now so that
  decision is not also blocked on producing test input.
