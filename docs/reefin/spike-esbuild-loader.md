# Spike — esbuild-loader vs Babel + ts-loader (RFC-0002 §6.1)

Date : 16 juillet 2026. Exécuté en worktree isolé, `esbuild-loader@4.5.0`, `ForkTsCheckerWebpackPlugin` conservé.

## Mesures

| | Baseline (babel-loader + ts-loader) | Prototype (esbuild-loader, target es2020) |
| --- | --- | --- |
| Build prod à froid (sans cache) | ~163–167 s | 67–76 s, stable dès le premier run |
| Build prod à chaud (cache babel-loader) | 76–89 s | idem (~67–76 s, aucun cache requis) |
| `main.jellyfin.bundle.js` minifié | 1 086 621 o | 391 552 o |
| `dist/` total | ~53 MiB | ~52 MiB |

Gain à froid (scénario CI) : **~2,3×**. À chaud : ~10–15 %.

**Attribution de l'écart de taille** : vérifié en build unminifié — la baseline contient 78 occurrences de helpers de downlevel TS (`__awaiter`, `__generator`, `__extends`, `__spreadArray`) car `tsconfig.json` cible encore `ES5` et `ts-loader` downlevel à l'unité sans `importHelpers`/tslib (helpers dupliqués par fichier). Le prototype (target es2020) en contient 0. Ce gain vient donc surtout du changement de cible ES5→ES2020 — capturable en partie sous ts-loader par un simple changement de `tsconfig.json` (prévu de toute façon, plan §5.4 étape 7) — mais lever le verrou TypeScript 7 nécessite quand même de sortir de ts-loader.

## Diff webpack nécessaire (~26 lignes ajoutées / 11 retirées dans `webpack.common.js`)

- Bulk js/jsx (app + allow-list vendors `@mui/*`, `@tanstack/*`, `date-fns`, etc.) : `babel-loader` → `{ loader: 'esbuild-loader', options: { loader: 'jsx', target: 'es2020' } }`.
- `.ts` : `ts-loader` → esbuild-loader `loader: 'ts'` ; `.tsx` : règle **séparée** avec `loader: 'tsx'`.
- `ForkTsCheckerWebpackPlugin` inchangé.

## Points durs et limites

1. **Piège generics/JSX** : une règle unique `\.(ts|tsx)$` + loader `tsx` casse sur les génériques des fichiers `.ts` (ex. `const asContract = <T>(data: unknown): T => ...` dans `src/apps/dashboard/features/playback/api/playbackDiagnosticsApi.ts:42` — esbuild lit `<T>` comme du JSX). Fix : règles `.ts` et `.tsx` séparées.
2. **Cas irréductible — UMD** : la règle `pdfjs-dist`/`xmldom` (`webpack.common.js:362-379`, `@babel/plugin-transform-modules-umd`) n'a pas d'équivalent esbuild (sorties `iife`/`cjs`/`esm` seulement). Babel reste en périmètre résiduel minimal sur cette seule règle (mixage de loaders viable) — Babel n'est donc pas 100 % supprimé, contrairement à l'hypothèse initiale de §6.1.
   **Constat post-migration (nettoyage presets)** : la règle est aujourd'hui probablement un no-op fonctionnel — les 20 fichiers `.js` publiés par `pdfjs-dist` sont des bundles UMD/CJS pré-empaquetés sans déclaration `import`/`export` ES, et le chemin `node_modules/xmldom` de l'`include` ne matche rien (le paquet réel est `@xmldom/xmldom`, transitif d'epubjs). Règle conservée par prudence (une future version ESM de pdfjs-dist la réactiverait) ; sa suppression pure est un suivi possible.
3. **Risque TypeScript 7 déplacé, pas éliminé** : `fork-ts-checker-webpack-plugin` dépend aussi de l'API JS de `typescript` (Program/LanguageService). Après migration, la transpilation ne dépend plus de cette API, mais le type-check in-build si. Gain de résilience : si fork-ts-checker casse sous TS 7, il peut être désactivé sans casser le build (type-check glisse vers `build:check` CLI), alors qu'aujourd'hui ts-loader casse le build lui-même.
4. **Non testé** : HMR / webpack-dev-server en usage interactif réel (le build `webpack.dev.js` passe, l'usage watch/HMR n'a pas été exercé). À vérifier avant bascule définitive.

## Verdict

**Go, avec réserves** : (1) babel-loader résiduel pour la règle UMD ; (2) règles `.ts`/`.tsx` séparées ; (3) risque TS 7 sur fork-ts-checker à traiter séparément ; (4) vérification HMR/dev-server avant bascule.
