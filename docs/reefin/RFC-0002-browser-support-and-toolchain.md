# RFC-0002 — Abandon des cibles navigateurs legacy et adoption de Biome

- **Statut** : Draft
- **Date** : 2026-07-16
- **Auteur** : Reefin Team
- **Dépôt** : `reefin-web` (fork de `jellyfin-web`)
- **Relation** : s'appuie sur RFC-0001 (`docs/reefin/RFC-0001-vision-and-feasibility.md`) — §3 politique de breaking changes (critère 1, « supprime de l'architecture héritée »), §7 phase 2 (« mise en place d'une politique de synchronisation contrôlée avec l'upstream »), §8 (« dépendances tierces et outillage de build tant qu'ils ne bloquent pas la trajectoire TypeScript/React ciblée »).

---

## 1. Contexte et motivation

RFC-0001 pose que Reefin Web est un fork qui modernise intentionnellement, par tranches verticales, sans reconstruire le shell depuis zéro. Mais deux pans de l'outillage actuel tirent dans l'autre sens : la cible navigateurs héritée de `jellyfin-web` (TV ES5, IE-era) impose des transformations, polyfills et vérifications qui ralentissent chaque build et chaque contribution, et la chaîne ESLint (8 plugins, config flat de ~200+ lignes) est lente et redondante avec un outil plus simple. Ce RFC formalise une décision déjà validée par le mainteneur : abandonner la cible legacy et migrer vers Biome comme formatter + linter principal.

Ce changement remplit le **critère 1** de la politique de breaking changes de RFC-0001 (« il supprime de l'architecture héritée ») : la cible navigateur ES5 est explicitement identifiée en RFC-0001 §1.2/§6.2 comme dette à faire disparaître, pas comme une contrainte permanente du produit.

### 1.1 Inventaire concret de la cible legacy actuelle

**`package.json` → `browserslist`** :

```json
"browserslist": [
    "last 2 Firefox versions",
    "last 2 Chrome versions",
    "last 2 ChromeAndroid versions",
    "last 2 Safari versions",
    "iOS > 10",
    "last 2 Edge versions",
    "Chrome 27",
    "Chrome 38",
    "Chrome 47",
    "Chrome 53",
    "Chrome 56",
    "Chrome 63",
    "Edge 18",
    "Firefox ESR"
]
```

Les entrées `Chrome 27` à `Chrome 63` et `Edge 18` ne correspondent à aucun navigateur desktop/mobile actuel : ce sont des pins pour les moteurs Chromium embarqués dans les firmwares de TV LG webOS et Samsung Tizen (voir §2), et pour la Xbox One (Edge 18, EdgeHTML). `iOS > 10` étend la cible à des versions de Safari mobile antérieures à ES2017.

**`.escheckrc`** — vérifie que le bundle de production ne contient aucune syntaxe au-delà d'ES5 :

```json
{
    "ecmaVersion": "es5",
    "files": "./dist/**/*.js",
    "not": ["./dist/libraries/pdf.worker.js", "./dist/libraries/worker-bundle.js", "./dist/serviceworker.js"]
}
```

Exécuté en CI via `npm run build:es-check` (`build:production` + `escheck`), c'est un des 5 entrées de la matrice `quality` (`.github/workflows/__quality_checks.yml:35-41`), au même titre que `lint`, `stylelint`, `build:check`, `test`.

**`babel.config.js`** — `@babel/preset-env` avec `useBuiltIns: 'usage', corejs: 3` : Babel injecte automatiquement les polyfills `core-js` nécessaires pour chaque fichier source selon la cible browserslist, syntaxe par syntaxe.

**`webpack.common.js`** :
- `target: 'browserslist'` (ligne 45) — webpack lit directement la même config pour ses propres choix de transformation/chunking.
- Un plugin `@babel/plugin-transform-modules-umd` appliqué spécifiquement à `pdfjs-dist` et `xmldom` (ligne ~307) car « Babel casse leur transformation vers ESM » — contournement direct lié à la cible ES5/ES modules non supportés nativement.
- Liste `Assets` (ligne ~11) qui copie `native-promise-only/npo.js` en asset statique — polyfill Promise pour moteurs pré-ES2015.
- Longue liste d'inclusions babel-loader pour des paquets `node_modules/@mui/*`, `@tanstack/*`, etc. (lignes 196-244) car ces paquets publient de la syntaxe moderne que la cible ES5 ne peut pas consommer telle quelle — sans cette cible, la plupart de ces transpilations de dépendances tierces deviennent inutiles.

**`src/index.jsx`**, première ligne de code : `import 'lib/legacy';` — point d'entrée qui charge inconditionnellement, pour **tous** les utilisateurs, le bundle de polyfills. `src/lib/legacy/index.ts` :

```ts
import 'core-js/stable';
import 'regenerator-runtime/runtime';
import 'jquery';
import 'element-closest-polyfill';
import 'fast-text-encoding';
import 'intersection-observer';
import 'classlist.js';
import 'whatwg-fetch';
import 'abortcontroller-polyfill'; // requires fetch
import 'resize-observer-polyfill';
import 'proxy-polyfill';

import './domParserTextHtml';
import './elementAppendPrepend';
import './focusPreventScroll';
import './htmlMediaElement';
import './keyboardEvent';
import './patchHeaders';
import './vendorStyles';
```

`CONTRIBUTING.md:119` documente `src/lib/legacy` comme « Polyfills for legacy browsers » dans l'arborescence officielle. `src/lib/legacy/patchHeaders.js` cible nommément « Tizen 3, Tizen 4, webOS 4 ». Ces polyfills et shims (Fetch, AbortController, ResizeObserver, Proxy, `Element.closest`, `classList`, TextEncoder, IntersectionObserver, comportements DOM/clavier divergents) s'exécutent au chargement pour tout le monde, y compris les utilisateurs sur navigateurs evergreen où toutes ces API sont natives depuis des années.

**`eslint-plugin-compat`** — un des 8 plugins de `eslint.config.mjs` (`compat.configs['flat/recommended']`), qui vérifie statiquement que le code ne référence pas d'API DOM/JS absentes de la cible `browserslist`. `eslint.config.mjs` contient aussi une règle manuelle liée : `no-restricted-properties` sur `replaceChildren` avec le message « replaceChildren is not supported in all target browsers » — un garde-fou codé à la main pour la même raison.

Résumé de ce que la cible legacy coûte concrètement : 11 imports de polyfills chargés pour 100 % des utilisateurs, une transformation Babel/core-js à l'usage sur tout le code source et une bonne partie de `node_modules`, un plugin UMD dédié pour deux paquets, un job CI dédié (`build:es-check`, qui nécessite un build de production complet avant de pouvoir vérifier quoi que ce soit), un plugin ESLint dédié plus une règle manuelle, et une liste d'inclusions babel-loader dans `webpack.common.js` qui n'existerait pas sans la contrainte ES5.

---

## 2. Ce que la cible legacy sert réellement : les TV embarquées

`jellyfin-web` — et donc `reefin-web` en l'état — n'est pas seulement un site web desktop. Les applications LG webOS et Samsung Tizen officielles de Jellyfin **embarquent directement le bundle produit par ce dépôt** dans une WebView native (contrairement à Android TV, Swiftfin ou AppleTV, qui sont des codebases natives séparées). C'est pour cette raison que `src/` contient une détection et des contournements matériels très spécifiques, indépendants de la config browserslist/babel :

- `src/components/apphost.js` : branches dédiées `browser.tizen`, `browser.web0s`, `browser.orsay` (vieux Samsung Orsay, pré-Tizen), `browser.operaTv`, `browser.edgeUwp` (Xbox).
- `src/components/scrollManager.js:110-118` : trois comportements de scroll différents documentés pour webOS 2, webOS 3, webOS 4/Tizen 4, Tizen 5.
- `src/utils/subtitleStyles.ts:24-25` : « Tizen 5 doesn't support displaying secondary subtitles ».
- `src/plugins/htmlVideoPlayer/plugin.js:1322` : « Worker in Tizen 5 doesn't resolve relative path with async request ».
- `src/elements/emby-checkbox/emby-checkbox.js`, `emby-radio/emby-radio.js` : contournements clavier « Real (non-emulator) Tizen does nothing on Space ».
- `src/components/homesections/homesections.js:83`, `src/components/viewContainer.js:97` : timeouts spécifiques pour « polyfilled CustomElements (webOS 1.2) ».

C'est un inventaire de plus de 190 occurrences `tizen`/`web0s`/`webos`/`orsay`/`operaTv` dans `src/` (hors `node_modules`). **Ce RFC ne traite pas ce code** — il porte uniquement sur la cible de build (browserslist/babel/es-check/polyfills globaux) et sur l'outillage de lint/format. Le sort de ces branches de détection matérielle spécifique est une question séparée, notée en §6.

RFC-0001 §5 classe déjà « les clients Android, Swiftfin, AppleTV, Tizen, Vidaa » comme hors périmètre de `reefin-web` (« ne sont pas maintenus dans ce dépôt »). Pour Android/Swiftfin/AppleTV c'est sans ambiguïté : ce sont des codebases natives distinctes. Pour Tizen (et, non nommé explicitement dans RFC-0001, webOS), la situation est différente précisément parce que ces wrappers TV consomment le bundle de *ce* dépôt — abandonner la cible ES5 ici a un effet direct sur ces applications TV, pas seulement sur de vieux navigateurs desktop. Ce RFC assume ce choix explicitement (voir §3) plutôt que de le laisser implicite dans la lecture de RFC-0001 §5.

---

## 3. Décision — baseline navigateurs Reefin Web 13

**Baseline proposée** :

```
last 2 Chrome versions
last 2 Firefox versions
last 2 Safari versions
last 2 Edge versions
last 2 ChromeAndroid versions
last 2 iOS versions
Firefox ESR
not dead
```

Concrètement : navigateurs evergreen desktop et mobile uniquement, plus le pin explicite `Firefox ESR` déjà présent (conservé — utile pour les distributions Linux à cycle lent). Suppression de `iOS > 10`, `Chrome 27/38/47/53/56/63`, `Edge 18`. Cela relève la syntaxe minimale supportée à environ **ES2020/ES2022 natif** (modules ES natifs, optional chaining, nullish coalescing, `Promise.allSettled`, classes natives sans transpilation) — à confirmer précisément par `npx browserslist` une fois la liste modifiée, avant de décider si Babel reste nécessaire ou si sa suppression devient réaliste (voir §6, question ouverte).

**Ce qui est perdu, nommément** :
- TV LG webOS et Samsung Tizen dont le firmware embarque un Chromium correspondant aux pins retirés (`Chrome 27` à `Chrome 63` couvrent grossièrement webOS 1.x à 5.x / Tizen 2.3 à 5.5, soit des téléviseurs commercialisés jusqu'à ~2019-2020). L'app Jellyfin officielle sur ces TV cesserait de fonctionner si elle embarquait un bundle `reefin-web` construit sur cette nouvelle baseline.
- Vieux Safari iOS (< 11) et Xbox One (Edge 18/EdgeHTML).

**Pourquoi c'est acceptable pour ce fork** :
1. **RFC-0001 §3, critère 1** : la cible ES5 est de l'architecture héritée pure — elle ne sert aucun utilisateur desktop/mobile actuel (les entrées `last 2 X versions` couvrent déjà tout navigateur evergreen), elle ne sert que des firmwares TV figés qui ne seront plus mis à jour.
2. **Les utilisateurs de TV anciennes ne perdent pas l'accès à Jellyfin** : ils gardent `jellyfin-web` upstream (non-forké, toujours maintenu avec cette cible) et les apps TV officielles construites dessus. Reefin Web est un choix de fork explicite (RFC-0001 §1.1, « ce n'est pas un Jellyfin Web avec un thème différent ») ; rien n'oblige un utilisateur de TV 2018 à migrer vers Reefin.
3. **Le coût de maintien est concret et récurrent**, pas hypothétique : chaque nouvelle feature moderne (ex. tranches verticales du pilier 1, RFC-0001 §6.5) doit composer avec cette cible tant qu'elle reste active — c'est le genre de frein que RFC-0001 §1.2 identifie déjà comme structurel.

Ce RFC ne fixe **pas** de version minimale webOS/Tizen de remplacement (ex. « webOS ≥ 6 / Tizen ≥ 6 ») : le mapping exact firmware → moteur Chromium n'est pas vérifié dans ce document et mérite une validation dédiée contre de vrais appareils avant toute annonce publique de compatibilité TV (voir §6, question ouverte). La décision actée ici est seulement l'abandon des pins ES5/Chrome legacy dans `browserslist`, pas l'engagement sur une nouvelle matrice TV précise.

---

## 4. Conséquences toolchain

| Élément | Aujourd'hui | Après ce RFC |
| --- | --- | --- |
| `browserslist` (`package.json`) | 14 entrées dont 7 pins TV/legacy | Liste evergreen uniquement (§3) |
| `.escheckrc` + `es-check` (devDependency) | Job CI dédié, vérifie ES5 sur `dist/**/*.js` | Supprimé — la cible evergreen n'a plus besoin d'un check de syntaxe post-build séparé (le transpileur/webpack échoueraient de toute façon sur une régression grave, et le linter peut couvrir la syntaxe interdite si nécessaire) |
| `eslint-plugin-compat` (devDependency + 1 des 8 plugins ESLint) | Vérifie les API DOM contre la cible browserslist | Supprimé — sans cible ES5/TV, la surface d'API à valider correspond à ce que tout navigateur evergreen supporte nativement ; règle manuelle `no-restricted-properties` sur `replaceChildren` également retirable |
| `src/lib/legacy/*` (11 polyfills + 6 shims custom) | Chargé pour 100 % des utilisateurs à chaque démarrage | Supprimé en bloc : `core-js`, `regenerator-runtime`, `jquery` (si non utilisé ailleurs — à vérifier au moment du retrait), `element-closest-polyfill`, `fast-text-encoding`, `intersection-observer`, `classlist.js`, `whatwg-fetch`, `abortcontroller-polyfill`, `resize-observer-polyfill`, `proxy-polyfill`, `native-promise-only` deviennent des dépendances mortes à retirer de `package.json` |
| `babel.config.js` `useBuiltIns: 'usage', corejs: 3` | Injection automatique de polyfills `core-js` par usage de syntaxe | Simplifié au minimum (transpilation JSX/TS résiduelle uniquement) ou Babel retiré entièrement — question ouverte (§6) |
| `webpack.common.js` `@babel/plugin-transform-modules-umd` (pdfjs-dist, xmldom) | Contournement UMD pour 2 paquets qui cassent en ESM sous Babel/cible ES5 | À réévaluer — possiblement inutile si ces paquets sont consommés nativement en ESM sous la nouvelle cible |
| `webpack.common.js` inclusions babel-loader étendues (`@mui/*`, `@tanstack/*`, etc., lignes 196-244) | Nécessaires pour transpiler la syntaxe moderne publiée par ces paquets vers ES5 | Probablement réductibles — beaucoup de ces paquets publient déjà du JS moderne consommable tel quel par la nouvelle baseline ; à vérifier paquet par paquet, pas en bloc |
| `webpack.common.js` `target: 'browserslist'` | Piloté par la même config | Inchangé dans son fonctionnement, mais la cible effective change de nature |
| Taille du bundle initial | Polyfills + code transpilé ES5 chargés pour tous | Réduction attendue (pas chiffrée dans ce RFC — à mesurer via `build:analyze` avant/après comme critère d'acceptation de la PR de retrait) |

---

## 5. Adoption de Biome

### 5.1 État de l'art Biome (vérifié juillet 2026)

Biome couvre bien le remplacement du cœur ESLint + du formatage, avec des trous identifiés face aux 8 plugins actuels de `eslint.config.mjs` (`eslint.configs.recommended`, `tseslint.configs.recommended`, `comments.recommended`, `compat.configs['flat/recommended']`, `importPlugin.flatConfigs.errors`, `sonarjs.configs.recommended`, `reactPlugin.configs.flat.recommended`, `jsxA11y.flatConfigs.recommended`, plus `@stylistic/eslint-plugin`) :

- **Formatage / règles stylistiques** (`@stylistic/eslint-plugin`, ~25 règles dans `eslint.config.mjs`) : couverture native complète par le formatter Biome (équivalent Prettier avec ~97 % de compatibilité rapportée). C'est le remplacement le plus direct.
- **`eslint.configs.recommended` + `typescript-eslint` + règles JS/TS manuelles** (`no-var`, `prefer-const`, `no-shadow`, `no-unused-vars`, etc.) : bonne couverture native par le linter Biome (500+ règles portées depuis ESLint/typescript-eslint/autres sources).
- **`eslint-plugin-import`** (tri, résolution, `no-unresolved`) : couverture partielle via `organizeImports`/`useImportExtensions` ; la résolution de modules et certaines règles de dépendances n'ont pas d'équivalent 1:1 vérifié.
- **`eslint-plugin-react` + `eslint-plugin-react-hooks`** : couverture correcte, y compris `useHookAtTopLevel`, mais pas garantie exhaustive face à `eslint-plugin-react` (règles JSX plus obscures).
- **`eslint-plugin-jsx-a11y`** : **trou identifié** — Biome n'a qu'une couverture a11y basique (des règles a11y existent, en progression avec les rules HTML de Biome v2.4, mais très en retrait de la couverture de `eslint-plugin-jsx-a11y`, qui reste la référence pour de l'accessibilité sérieuse).
- **`eslint-plugin-sonarjs`** : **pas d'équivalent direct** — les règles de détection de bugs/complexité de sonarjs (`no-nested-functions`, `pseudo-random`, `fixme-tag`, etc., déjà configurées avec des dérogations dans `eslint.config.mjs`) n'ont pas de correspondance systématique côté Biome.
- **`@eslint-community/eslint-plugin-eslint-comments`** : pas d'équivalent (règle sur l'hygiène des directives `eslint-disable` elles-mêmes — n'a de sens que si ESLint reste présent).
- **`eslint-plugin-compat`** : sans objet après ce RFC (§4) — sa suppression est déjà actée indépendamment de Biome.
- **`biome migrate eslint --write`** : commande officielle qui lit `eslint.config.mjs` (flat config supportée) et porte automatiquement les règles équivalentes vers `biome.json`, avec option `--include-inspired` pour les règles approximatives. Point de départ de la migration, pas un résultat final : nécessite une revue manuelle des règles non portées.
- **CSS/SCSS** : le linter/formatter CSS de Biome est stable pour du CSS standard, mais **le support SCSS n'est pas encore livré** (sur la roadmap Biome 2026, pas disponible aujourd'hui). `stylelint` (`stylelint-scss`, `stylelint-config-rational-order`, `stylelint-order`, `@stylistic/stylelint-plugin`) reste donc nécessaire tel quel pour tout `src/**/*.scss` — ce n'est pas un choix conservateur temporaire, c'est une contrainte technique actuelle de Biome.

### 5.2 Portée retenue

- **Biome** : format + lint pour JS/TS/TSX (remplace `eslint` + `@stylistic/eslint-plugin` en formatage, et la majorité du linting).
- **ESLint résiduel** : conservé uniquement si la revue manuelle post-`migrate eslint` identifie des règles sans équivalent jugées non négociables — candidats concrets d'après §5.1 : couverture a11y (`jsx-a11y`) si jugée insuffisante côté Biome pour un produit qui affiche l'accessibilité clavier/télécommande comme un principe de conception dès le départ (RFC-0001 §2, pilier 1), et éventuellement une partie de `sonarjs` si des règles actives aujourd'hui (`no-inverted-boolean-check`, `no-alphabetical-sort`, etc.) sont jugées trop utiles pour être abandonnées sans filet. Si la revue conclut que rien ne justifie de garder ESLint en parallèle, il est retiré entièrement — c'est l'option par défaut, pas l'exception, étant donné le coût de maintenir deux linters actifs simultanément.
- **stylelint** : conservé sans changement pour `src/**/*.scss` (§5.1 — contrainte technique Biome, pas un choix révisable à court terme).

### 5.3 Stratégie de migration

1. `biome migrate eslint --write` pour générer `biome.json` à partir de `eslint.config.mjs`, avec `--include-inspired`.
2. Aligner manuellement `biome.json` sur le style déjà en vigueur (indentation 4 espaces, quotes simples, pas de virgule finale, etc. — voir les règles `@stylistic/*` de `eslint.config.mjs` §1) pour que le reformatage global de l'étape suivante produise le **plus petit diff possible**, pas un diff dicté par les défauts Biome.
3. **Un seul commit de reformatage global, isolé** : `biome format --write .` (ou `biome check --write .` si le linting auto-fixable est inclus) dans un commit dédié qui ne contient **aucun** changement fonctionnel. Ajouter son SHA à un fichier `.git-blame-ignore-revs` à la racine (actuellement absent du dépôt) et documenter `git config blame.ignoreRevsFile .git-blame-ignore-revs` dans `CONTRIBUTING.md` pour que `git blame` continue de pointer vers les auteurs réels au-delà de ce commit.
4. Revue manuelle des règles ESLint non migrées (§5.1) → décision garder/abandonner par catégorie, pas règle par règle.
5. Mise à jour des scripts npm : `"lint": "eslint"` → `"lint": "biome lint"` (ou `biome check` selon ce que couvre la commande finale), ajout d'un script `"format"` s'il n'existe pas déjà (aucun script `format` actuel dans `package.json` — le formatage passait implicitement par les règles `@stylistic/eslint-plugin` sans commande de fix dédiée séparée du lint).
6. Mise à jour de `.github/workflows/__quality_checks.yml` : la matrice `quality` (`command:` à la ligne 36, entrées lignes 37-41) référence `lint` par nom de script npm, donc le changement est transparent côté CI tant que `npm run lint` reste le point d'entrée — mais `build:es-check` (ligne 37) disparaît de la matrice (§4), et un job `format`/`biome ci` peut être ajouté si le format n'est pas déjà couvert par `lint`. Le job séparé `run-eslint` (`.github/workflows/pull_request.yml:42-64`, `CatChen/eslint-suggestion-action`) qui poste des suggestions ESLint en commentaires de PR doit être retiré ou remplacé par l'équivalent Biome s'il existe, sinon supprimé sans remplacement.

### 5.4 Plan d'exécution PR-sized

1. **RFC-0002 accepté** (ce document) — préalable à tout code, conformément à RFC-0001 §3.
2. **PR — retrait des cibles legacy** : `browserslist` (§3), `.escheckrc`, script `build:es-check` + job CI correspondant, `eslint-plugin-compat` + règle `no-restricted-properties(replaceChildren)`, `src/lib/legacy/*` et son import dans `src/index.jsx`, dépendances polyfills mortes de `package.json`. Mesure `build:analyze` avant/après comme preuve de gain. PR isolée, aucun changement de style/format.
3. **PR — `biome migrate eslint` + configuration** : génération de `biome.json`, alignement manuel du style, sans encore reformater le code. Biome coexiste avec ESLint (double config) le temps de valider que `biome check` ne casse rien d'inattendu sur un sous-ensemble du code.
4. **PR — reformatage global isolé** : commit unique `biome format --write .` (ou `biome check --write .`), entrée dans `.git-blame-ignore-revs`, doc `CONTRIBUTING.md`. Aucune autre modification dans cette PR.
5. **PR — retrait ESLint** (ou réduction à son périmètre résiduel défini en §5.2) : suppression des dépendances ESLint devenues inutiles, `eslint.config.mjs` supprimé ou réduit, scripts npm et workflows CI mis à jour (§5.3 point 5-6), job `run-eslint` de suggestion PR retiré/remplacé.
6. **PR — simplification Babel/webpack** (dépend des réponses aux questions ouvertes §6) : réduction ou suppression de `useBuiltIns`/`corejs`, réévaluation de `@babel/plugin-transform-modules-umd` et des inclusions babel-loader étendues.

Chaque PR reste revuable indépendamment ; l'ordre est contraint (le retrait des cibles legacy doit précéder le reformatage pour ne pas reformater du code qui va être supprimé, et le reformatage global doit être isolé pour préserver `git blame` sur tout le reste).

---

## 6. Questions ouvertes

1. **Babel → esbuild/swc ?** Une fois la cible ES2020+ actée, la transpilation restante (JSX, TS via `ts-loader` qui gère déjà le TS séparément — voir `webpack.common.js:284-293`) est-elle encore un cas d'usage justifiant Babel, ou `esbuild-loader`/`swc-loader` devient-il net plus rapide sans perte fonctionnelle ? Nécessite un spike séparé avant de trancher (impacte `webpack.common.js` et `babel.config.js` au-delà du périmètre de ce RFC).
2. **Version minimale webOS/Tizen exacte** : ce RFC abandonne les pins `Chrome 27-63`/`Edge 18` sans fixer de nouvelle matrice TV de remplacement (§3). Si Reefin souhaite conserver une story TV (wrapper webOS/Tizen embarquant ce bundle), quelle est la version de firmware minimale réaliste à valider contre de vrais appareils, et qui la maintient (Reefin ne fork pas aujourd'hui les dépôts wrapper `jellyfin-webos`/`jellyfin-tizen`) ?
3. **Politique pour `src/apps/legacy` et le code de détection matérielle TV** (§2 — `browser.tizen`/`web0s`/`orsay`/`operaTv`, ~190 occurrences) : ce RFC ne les traite pas. Faut-il un RFC dédié pour décider de leur sort une fois la cible de build modernisée, en cohérence avec RFC-0001 §6.2 (`src/apps/legacy` comme périmètre de remplacement par tranches verticales) ?
4. **Portée finale d'ESLint résiduel** (§5.2) : la revue manuelle post-`migrate eslint` doit trancher au cas par cas (a11y, sonarjs) — ce RFC pose le principe (rien par défaut, exceptions justifiées) mais pas la liste finale, qui dépend de l'exécution de l'étape 4 du plan (§5.4).
5. **`jquery` dans `src/lib/legacy/index.ts`** : jQuery y est importé comme si c'était un polyfill, mais c'est une dépendance réelle consommée ailleurs via l'effet de bord global qu'il installe (`window.$`) — au moins `src/scripts/editorsidebar.js` l'utilise (`$(document)`) sans import explicite. Son retrait de `lib/legacy` ne doit pas être confondu avec son retrait complet du dépôt : soit `editorsidebar.js` (et tout autre consommateur implicite à auditer) migre vers un import explicite de `jquery` avant la PR §5.4 point 2, soit `jquery` reste chargé globalement ailleurs — mais ne doit pas disparaître silencieusement avec le reste du bundle de polyfills.

---
