# Open-mosaic brand acceptance

Date: 2026-10-19. Before: `053642646c53576c2f74bb8616e1c0603f415eb0`.

The screenshots below use actual production builds and the repository's server-free
`tests/m3Browser/support/fixtureApi.ts`. They show the same two authored libraries and server
name, with no media artwork. Desktop, legacy desktop and TV-mode captures are 1366 × 768;
the mobile drawer is 390 × 844. Browser: headless Chromium 153, controlled by Playwright 1.61.1.
The startup captures hold JavaScript before initialization so the real splash remains visible.

| Surface | Before | After |
| --- | --- | --- |
| Startup | [Before](startup-before.png) | [After](startup-after.png) |
| Modern desktop toolbar | [Before](desktop-before.png) | [After](desktop-after.png) |
| Modern mobile drawer | [Before](mobile-before.png) | [After](mobile-after.png) |
| Legacy desktop, light preset | [Before](desktop-legacy-before.png) | [After](desktop-legacy-after.png) |
| Legacy TV mode, dark preset | [Before](tv-before.png) | [After](tv-after.png) |

[Asset comparison sheet](open-mosaic-sheet.png): actual exports on light/dark surfaces,
monochrome variants, browser sizes and a circular crop of the maskable PWA icon.

## Verification

- `npm run validate:full`: PASS, including type checking, lint, stylelint, 3,658 passing tests
  (one existing skipped test), production build, delivery budgets and the SDK/security guards.
- `npm run verify:brand-assets`: all 19 committed exports match the SVG masters byte for byte.
- Browser checks: the modern toolbar and drawer images load at nonzero sizes; legacy light and
  TV headers resolve to the appropriate local logo. Captures were visually inspected.
- Static-resource checks at `/` and `/tesserafin/`: manifest identity is Tesserafin; Apple icon,
  SVG favicon, both normal PWA sizes, maskable icon and notification image return HTTP 200.
  The ICO is served successfully and its returned bytes decode in Chromium; Pillow also reads
  all four embedded sizes (16, 32, 48, 64). The startup logo resolves below both URL prefixes.
- Source inventory: no `@jellyfin/ux-web` reference remains in the runtime source, build config
  or dependency manifests. Its former notification PNG has been removed.

These are brand rendering and resource checks. The existing fixture does not implement the
WebSocket ticket endpoints; those unchanged requests are not playback or authentication
acceptance evidence. OS notification delivery and native Android/iOS PWA installation were
not exercised. Theme-package asset loading remains separate work in #117.
