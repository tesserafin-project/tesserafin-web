# tesserafin-design (provisional name)

Cross-platform design token socle for Reefin, specified in `docs/tesserafin/RFC-0005-design-system-
themes-and-catalog.md` §3.2. It is distinct from `src/ui/` (the React design system): this
directory owns only what must be shared across the future Web/Android/iOS/TV clients — the theme
schema, the design tokens, and the official themes — not any platform-specific implementation.

> The name `tesserafin-design` is provisional (RFC-0005 §3.2 explicitly flags it as such). It has not
> been decided whether this becomes its own package (`@reefin/design`?) once more than one renderer
> exists.

## Structure

```
tesserafin-design/
├── schema/
│   ├── theme.schema.json    # ThemeDefinition manifest schema (RFC-0005 §7.3)
│   └── tokens.schema.json   # Design tokens schema (color/typography/shape/spacing/elevation/
│                             # motion/density/blur, RFC-0005 §7.1)
├── themes/
│   └── classic/
│       ├── theme.json       # Reefin Classic manifest (RFC-0005 §8.1)
│       └── tokens.json       # Reefin Classic tokens, light + dark
├── scripts/
│   ├── validate-schema.mjs        # Dependency-free JSON Schema (draft 2020-12 subset) validator
│   └── generate-web-tokens.mjs    # Web renderer: theme dir -> src/ui/tokens/<id>.{css,ts}
└── __tests__/                     # Vitest coverage for the socle itself
```

`themes/classic/` doubles as the W13.6 reference fixture (RFC-0005 §11): it is the canonical
serialization of Reefin Classic in the universal theme format, consumable as a golden file by
future Android/iOS renderers even though only the Web renderer exists today.

## Generating platform output

The Web renderer is implemented first (RFC-0005 §3.2); Compose/SwiftUI renderers arrive when the
corresponding native apps start. To (re)generate the Web output for every theme under
`tesserafin-design/themes/`:

```sh
npm run generate:tokens
```

This validates each theme's `theme.json`/`tokens.json` against `schema/*.schema.json` (failing
loudly, with the full list of violations, if either is non-conformant) and writes, per theme:

- `src/ui/tokens/<themeId>.css` — `--rf-*` custom properties. See the header comment of a generated
  file for the exact `[data-rf-theme]`/`[data-rf-mode]` scoping rule.
- `src/ui/tokens/<themeId>.ts` — the same tokens as a `TesserafinTokens` object (typed against the
  hand-written `src/ui/tokens/types.ts`), for MUI theme wiring.

The generator is deterministic and has no side effect beyond writing those two files per theme —
running it twice with unchanged inputs produces zero diff.

## No new runtime dependency

`tesserafin-design/scripts/validate-schema.mjs` is a small, purpose-built JSON Schema validator
covering only the keywords used by the two schemas in this directory (see its file header) — not a
general-purpose implementation. This is intentional: adding `ajv` (or similar) was judged
unnecessary for the validation surface WP1 needs.
