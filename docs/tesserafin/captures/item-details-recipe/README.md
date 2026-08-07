# Item Details recipe captures — #129 Step 2

Every image here was produced by Chromium against the **real production bundle**, served by
`tests/reader/serve.mjs` with the same-origin fixture API. No Reefin server, no account, no network.

```
npm run build:production && npm run test:item-details-browser
```

The suites that write them are `tests/itemDetailsBrowser/itemDetails.browser.spec.ts` (the
platform-default set, unchanged since Step 1b) and
`tests/itemDetailsBrowser/itemDetails.recipe.browser.spec.ts` (both official recipes, added by
Step 2).

---

## 1. The platform default is unchanged — proven by checksum, not by eye

`platform-default/` was captured from the PROPOSED HEAD. The identical set captured from the start
commit `1486760c76150970fa8aab7d24d3919a6a7197fa` is **byte-for-byte the same file**:

| Capture | SHA-256 (start commit **and** proposed head) |
| --- | --- |
| `capture-movie.png` | `467ed3adc59c06237c66a3ba497db02306fb2e6a2e52498b1e5cd8aba74e1246` |
| `capture-series.png` | `0980668fd4bc1c231e650c1aa327ca79d42dd66e92e17aac5fcabb3f4e61d36d` |
| `capture-season.png` | `686d1250cfbffdd543a58ca99a96285473158e656cf77b06592d17f4666ba53c` |
| `capture-episode.png` | `2ca76207bd64fa26a6c09761d0f27a179be66212f6de90ba3e2c344963361e63` |
| `capture-music-album.png` | `1a2248718894bcc9f272eff32027ab74af7e810112c562df0fd65958ded54af9` |
| `capture-person.png` | `c3f31fa25ceb7624eabc7ca6a7a6a7a081a1251af3dadd1d97fa5ba90a662438` |
| `capture-series-timer.png` | `8e43f675325afa39530e4fa62a7556f1f9508de7a9a17461218b4c4000dfb491` |

A "before" directory is therefore not included: it would be seven duplicate files. The equality is
the evidence, and it is reproducible — check out the start commit, run the command above, and
compare.

`platform-default-movie-desktop.png` is the same page reached with **no applied record at all**, so
the provider falls back to `PLATFORM_DEFAULT_PRESENTATION`. It is byte-identical to
`capture-movie.png`.

## 2. The two official recipes

`classic/` and `glass/` each carry seven subjects × two viewports, plus one TV-shaped focus state:

| | desktop 1440×1000 | narrow mobile 390×844 | TV 1920×1080, keyboard |
| --- | --- | --- | --- |
| movie | ✓ | ✓ | ✓ (`*-movie-tv-focus.png`) |
| series | ✓ | ✓ | |
| season | ✓ | ✓ | |
| episode | ✓ | ✓ | |
| music album | ✓ | ✓ | |
| person | ✓ | ✓ | |
| series timer | ✓ | ✓ | |

Classic reproduces the platform default exactly, so `classic/*-desktop.png` is what an untouched
install looks like. Frosted Glass differs in two visible ways:

- **hero** — `poster` rather than `backdrop`, so the decorative backdrop band is absent;
- **order** — the cast is lifted to second and the fact panel (`mediaInfo`) moves to last.

Both expose **every applicable content family**; neither suppresses anything.

---

## Review checklist

Compare `classic/<subject>-desktop.png` with `glass/<subject>-desktop.png` and check:

1. **Default unchanged.** `platform-default/capture-*.png` matches what you remember of `/details`
   today. (The checksum table above already says the bytes are identical; this is the human check
   that the bytes were of the right thing.)
2. **Materially distinct.** Classic and Glass read as two designs, not as one design with a
   different tint.
3. **Nothing lost.** Every section visible in Classic is visible somewhere in Glass, and vice
   versa.
4. **Actions and selectors.** The play button, the played/favourite controls and the
   source/audio/subtitle selectors sit together above the content in BOTH, and neither theme has
   pushed them below the fold.
5. **Poster and backdrop.** A poster in every capture. A backdrop band in Classic, none in Glass.
   `person` has no backdrop in either.
6. **Long and sparse pages.** `movie` is the long one and `series-timer` the sparse one; check
   neither collapses or strands whitespace under either theme.
7. **Narrow mobile.** `*-mobile.png` — one column, no horizontal scrolling, the poster above the
   name, and the reordering still legible.
8. **Keyboard.** `*-movie-tv-focus.png` shows where the first Tab lands. It must be the play
   button under both themes.

Automated checks already cover: zero axe 4.12.1 violations at every severity under both recipes, no
horizontal overflow at either width, and the play button reachable by Tab alone. **Visual
acceptance is not inferred from any of them.**
