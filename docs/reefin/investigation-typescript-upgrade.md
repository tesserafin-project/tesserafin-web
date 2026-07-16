# Investigation — Upgrade TypeScript (5.9.3 → 6.x / 7.x)

Date : 16 juillet 2026. Contexte : RFC-0002 (toolchain evergreen, Biome adopté, ESLint retiré — étape 5 exécutée). Version en place : `typescript@5.9.3`, `ts-loader@9.6.2` (`transpileOnly: true`), Babel assure le downleveling réel vers la baseline evergreen.

## 1. État de l'art (vérifié web, juillet 2026)

- **TypeScript 6.0** (23/03/2026, patchs jusqu'à 6.0.3) : dernière release du compilateur JS historique. Pas de versions 6.1–6.5.
- **TypeScript 7.0 GA** (08/07/2026, patch 7.0.2 le 14/07) : portage natif Go (« Project Corsa »). Perf annoncée : 8–12× sur build complet, type-check VS Code 125 s → < 11 s sur projets de référence.
- **Limitation critique TS 7.0** : le paquet npm `typescript` 7.x ne livre que le binaire CLI `tsc` — l'API programmatique JS (`ts.sys`, language-service host) a disparu. Retour prévu en **7.1 (~octobre 2026)**. Paquet de compat `@typescript/typescript6` (binaire `tsc6` + ré-export API 6.0) disponible pour cohabitation.
- Conséquence écosystème : tooling embarqué (Vue/Volar, Svelte, Astro, MDX) bloqué sur TS 6.0 ; seuls les usages CLI purs (`tsc`, `tsc --noEmit`) fonctionnent avec 7.0 aujourd'hui.

Sources :
- https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/
- https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- https://www.theregister.com/devops/2026/07/09/speedier-type-checks-in-typescript-70-as-first-stable-go-release-ships/5268828
- https://www.techtimes.com/articles/320049/20260710/typescript-7-now-stable-10-faster-builds-not-vue-svelte-yet.htm
- https://visualstudiomagazine.com/articles/2026/03/23/typescript-6-0-ships-as-final-javascript-based-release-clears-path-for-go-native-7-0.aspx
- https://github.com/microsoft/TypeScript/issues/62196

## 2. Changements notables 6.0 / 7.0

**6.0 (release pont)** :
- Nouveautés : meilleure inférence des fonctions this-less, subpath imports `#/`, `moduleResolution: bundler` combinable avec `module: commonjs`, types Temporal API / `Map.getOrInsert` / `RegExp.escape`, flag `--stableTypeOrdering` (préparation 7.0).
- Défauts modifiés : `strict` par défaut, `types: []` par défaut (plus d'inclusion automatique de tout `@types/*`), `module: esnext`, `target: es2025`.
- Dépréciations (erreurs en 6.0 via `ignoreDeprecations: "6.0"` contournables, **supprimées définitivement en 7.0**) : `target: es5`/`es3` (minimum ES2015), `downlevelIteration`, `moduleResolution: node`/`node10`.

**7.0** : gain de perf pur (compilateur Go) ; changement architectural (pas d'API JS) plutôt que changement de langage.

## 3. Impact sur ce repo

- **`tsconfig.json` utilise exactement les trois options supprimées en 7.0** : `target: ES5`, `moduleResolution: node`, `downlevelIteration: true`. Les trois sont **vestigiales** : `ts-loader` est en `transpileOnly` (il ne fait que dégager les types) et Babel (`@babel/preset-env` + browserslist evergreen, sans `useBuiltIns`/`corejs`) fait le vrai downleveling. Nettoyage à risque faible.
- **Verrou : `ts-loader@9.6.2` casse avec TS 7** (API JS disparue). `ts-loader` v10 compatible TS 7 **pas encore publié** au 16/07/2026. Alternative : `esbuild-loader` (spike en cours, question ouverte RFC-0002 §6.1).
- **Deux usages découplés** : `ts-loader` (build webpack, bloqué) et `tsc --noEmit` (script `build:check`, job CI `__quality_checks.yml`, exécuté sur chaque push/PR) sont indépendants. Le CLI `tsc` de TS 7.0 peut servir `build:check` dès aujourd'hui, par ex. via alias npm (`"typescript7": "npm:typescript@7.0.2"`) pointé par ce seul script — gain 8–12× sur le type-check du repo (~2000+ fichiers src) sans toucher au pipeline webpack.
- Pas d'impact du défaut `types: []` (pas de `@types/node` ni de globals ambiants Node dans `src/`). `@types/react` et autres `@types/*` : agnostiques. Biome : non concerné (ne dépend pas de `tsc`). `@jellyfin/sdk` : pas de peer-dep TypeScript contraignante identifiée.

## 4. Recommandation

1. **Nettoyer `tsconfig.json` maintenant** (indépendant de la version TS) : `target: ES2020`+, `moduleResolution: bundler`, retirer `downlevelIteration`. Risque faible, prérequis à 6.0 comme à 7.0.
2. **Bump `typescript@6.0.3`** : compatible ts-loader, purge la dette de dépréciation avant que 7.0 n'en fasse des erreurs dures. → **Inscrit au plan RFC-0002 §5.4 (étape 7).**
3. **Optionnel, gain immédiat** : alias npm TS 7.0.2 pour le seul `build:check` (type-check CI 8–12×).
4. **Upgrade complet TS 7 : différé.** Débloqué soit par `ts-loader` v10 (~octobre 2026, hors de notre contrôle), soit par la migration `esbuild-loader` (spike §6.1 en cours). Revisiter en octobre 2026 (TS 7.1, API programmatique de retour).

Effort estimé : points 1+2 = quelques heures (surface de régression faible, repo déjà evergreen-only) ; point 3 = configuration d'alias, quelques heures.
