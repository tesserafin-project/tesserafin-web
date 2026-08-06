# Item Details migration — side-by-side captures

Evidence for owner visual acceptance of tesserafin-web#129 Step 1b.

Both sides are the **real production bundle** in a real Chromium, served by the tracked
server-free harness (`playwright.itemDetails.config.ts`) against the same same-origin fixture API.
No Reefin server is involved, so the two sides differ only in the code under test.

- **`.before.png`** — `origin/main` at `61ee617bd844bd097a4c2db238a1c299743c725e`, the legacy
  view-manager controller.
- **`.after.png`** — the migrated async React route.

| # | Class | Before | After |
| --- | --- | --- | --- |
| 01 | Movie | ✅ | ✅ |
| 02 | Series | ✅ | ✅ |
| 03 | Season | ✅ | ✅ |
| 04 | Episode | ✅ | ✅ |
| 05 | Music Album | ✅ | ✅ |
| 06 | Person | ✅ | ✅ |
| 07 | SeriesTimer | ✅ | ✅ |
| 08 | Movie, narrow mobile (390×844) | — | ✅ |
| 09 | Movie, TV viewport (1920×1080) | — | ✅ |
| 10 | Malformed `/details` URL | — | ✅ |

Rows 08–10 have no "before" because they are states the legacy route did not have a capture for:
the P5 browser evidence was desktop-only, and a malformed URL left the legacy route showing a
spinner forever rather than reaching a renderable state (`SUSPECT` #1, delta D2).

## What to look for

This is a **migration, not a redesign**. The composition, the section order, the actions and the
gates are asserted against the frozen P5 contract by
`tests/itemDetails/itemDetails.characterization.test.tsx`, so what these pictures are for is the
part no assertion covers: whether the page still reads as the same product.

Known intentional visual differences, all recorded in
`docs/tesserafin/item-details-migration.md` §6:

- cards are `src/ui`'s `MediaCard` rather than `components/cardbuilder` markup (invariant 11);
- the name block is one `h1` with a plain parent line, replacing the legacy `h1`/`h3`/`h4`
  sequence that axe reported as `heading-order` (delta D9);
- section headings are real `h2` elements, so eight classes show a heading the legacy markup
  rendered in an element the P5 reader could not see (delta D16);
- three classes no longer show an empty "Special Features" strip (delta D15).

Nothing here is bound to a presentation recipe. `presentation.page.itemDetails` is still unread and
still off `WEB_RENDERER_CAPABILITIES`; binding it is Step 2.
