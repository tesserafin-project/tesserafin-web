# Built-in Tesserafin brand

The open mosaic retains the website's four tile colors (earth `#9a7048`, water `#3d6e78`,
fire `#c45c32`, air `#c5c8c0`). Chamfered inner corners create a central opening that remains
recognizable in one color. The mark is drawn on a 64-unit square, with 4-unit joints and
3-unit outer corner radii.

## Sources and exports

- `mark.svg`: the editable geometry and color master.
- `wordmark.svg`: outlined lowercase Figtree Medium, from `@fontsource/figtree@5.3.0`.
  Its letter outlines and the i-dot use one color. The font is licensed under the SIL Open
  Font License; retain `OFL-Figtree.txt` when redistributing its outlines.
- `../../scripts/generate-brand-assets.mts`: combines those sources and rasterizes local exports
  with the pinned development-only `@resvg/resvg-js` dependency. No font is loaded or fetched.

From the repository root:

```sh
npm run generate:brand-assets
npm run verify:brand-assets
```

Commit both sources and generated outputs. The verification command compares all 19 exports
byte for byte, and is part of `validate:full`. Editing an export directly is temporary: edit
the source and regenerate instead.

`src/assets/branding/` contains the transparent full-color symbol, light/dark monochrome symbols,
light/dark wordmarks and horizontal logos, and the notification PNG. Here `light` means light
foreground for a dark surface; `dark` means dark foreground for a light surface. Horizontal
logos have a 20-unit gap between their 64-unit symbol and 50-unit-high lettering.

`src/favicons/` contains SVG and ICO browser icons, PNG fallbacks, Apple touch icons, and PWA
icons. Favicons use a larger symbol for small-size legibility. Launcher icons use an opaque
navy field. The separately declared maskable icon fits the entire symbol inside the central
safe circle: a 56%-wide square has a diagonal below the circle's 80% diameter. Keep the background
opaque and unrounded on maskable exports; the launcher owns cropping.

## Integration boundary

These are the application's built-in defaults, used by both shells, legacy header presets,
the startup splash, browser notifications, the logo screensaver and installed-app metadata.
All URLs stay local and work below a server URL prefix. Server-provided custom splash artwork
continues through `/Branding/Splashscreen`.

This does not implement theme-package asset loading (`assets.roles`, tracked separately in #117),
change theme palettes or change media artwork. The brand symbol remains the same across themes;
the legacy light/dark header variants select the corresponding readable wordmark.
