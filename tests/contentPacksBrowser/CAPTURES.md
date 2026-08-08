# Content packs — capture index (#138 §8)

Produced by `npm run test:content-packs-browser` (the three `*captures*` specs) against the **real
production build**, with no Reefin server: `npm run build:production` and a same-origin transport
fixture are the whole dependency set.

Artifacts: `test-results/content-packs-browser/captures/`
Machine-readable index: `index.desktop.json`, `index.mobile.json`, `index.tv.json` — one row per
PNG, carrying the theme the application actually resolved, the resolved token values, the resolved
presentation recipe, and the inspection point below.

File names are `<state>.<viewport>.<theme>.png`, themes being `official.classic` and
`official.glass` (Frosted Glass).

## What the harness refuses

A capture is evidence, so a bad one is worse than a missing one. `support/captures.ts` will not
write a file unless:

1. `data-rf-theme` on `<html>` is the theme that was **requested** — `useAppTheme` sets it from the
   theme it RESOLVED, so a silent fallback fails here rather than shipping a mislabelled picture;
2. the surface being captured is present and visible;
3. every image has loaded or failed — a half-loaded grid is a capture of the network;
4. animations and transitions are frozen, so the same state screenshots identically twice.

And per state, across the pair: the Classic and Frosted readings must differ in the **token** layer
AND in the resolved **presentation recipe**. Two captures that agree on both did not come from two
themes — which is exactly the "half a theme" defect this replaces. The one state where the recipe
half is not observable is `item-assignment`: the Item Details route and its dialog contain no
`Surface`/`MediaCard`, so nothing publishes a resolved recipe there. That state is proved on the
token layer alone and is flagged `recipeObservable: false` in the index rather than quietly passing.

This harness caught a real fault while being built: hash-only navigation does not reload the
document, so the second theme's init script never ran and the second capture wore the first theme.
The refusal fired; the fix was a real teardown between themes, not a relaxed assertion.

## The matrix

| State | Desktop | Mobile | TV/focus |
| --- | :---: | :---: | :---: |
| Populated mosaic | Classic + Frosted | Classic + Frosted | Classic + Frosted |
| Mixed-media pack | Classic + Frosted | Classic + Frosted | Classic + Frosted |
| Manager controls | Classic + Frosted | Classic + Frosted | — |
| Delete confirmation | Classic + Frosted | — | — |
| Item assignment | Classic + Frosted | Classic + Frosted | — |
| Non-manager state | Classic + Frosted | — | — |
| Empty state | Classic + Frosted | — | — |
| Error state | Classic + Frosted | — | — |

28 files. The TV rows are captured with TV **layout** actually enabled (`layout=tv`, the key
`layoutManager` reads), not merely at a 1920x1080 viewport, and with a control focused — what a TV
reviewer must judge is whether the focus ring reads from across a room, and an unfocused screenshot
cannot show that.

## What to look at, per state

| State | Inspection point |
| --- | --- |
| `populated-mosaic` | Hierarchy and density of the grid; the **server** order (Weeknights, Archive, Nothing yet), which is deliberately not alphabetical; the count under each card, including the `0`; the placeholder on `Archive`, whose representative the server declined to name. |
| `mixed-media-pack` | ONE aspect for the whole grid with a film, an episode, an album and a book side by side; the episode wearing its **series** artwork because it has none of its own; the heading and the server count `9`, deliberately larger than the four items shown — the surface must not hint that five more exist. |
| `manager-controls` | The management row: target size, the disabled first move-up and last move-down, and whether each control reads as belonging to the pack named beside it. |
| `delete-confirmation` | Whether the seven-part scope sentence reads as reassuring rather than alarming, and whether the pack being deleted is unmistakable. |
| `item-assignment` | Every accessible pack listed with the current membership marked; whether the row labels make the add/remove direction obvious. |
| `non-manager` | The same mosaic with **no** management surface — an absent row, not a disabled one. Does the page still read as complete rather than as something with a hole in it? |
| `empty-state` | The heading, the explanation, and the create control still offered: an empty list is where it matters most. |
| `error-state` | Whether the message and its retry read as recoverable, and whether the page still says where the viewer is. |
| `*.tv.*` | Focus visibility at TV distance, and whether the density still reads from a sofa. |
