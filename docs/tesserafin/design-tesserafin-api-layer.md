# Design — Couche API Reefin typée

- **Statut** : Draft
- **Date** : 2026-07-16
- **Auteur** : Reefin Team
- **Dépôt** : `reefin-web`
- **Dépend de** : `RFC-0001-vision-and-feasibility.md` (§6.4 couche API Reefin typée, §7 phase 2, §8
  stratégie upstream, §9 Q2) ; `design-web-playback-diagnostics.md` (premier pattern posé : types
  manuels miroir + appels axios bruts dans `features/playback/api/`) ; `branding-audit.md`
  (catégorie 1 — identifiant client protocolaire).
- **Portée** : design d'architecture. Répond à RFC-0001 §9 Q2 (« génération automatique ou
  maintenance manuelle ? »). Aucun code produit par ce document.
- **Implémentation** : PR1 pipeline de génération (commit `ce75215`), PR2 migration playback
  diagnostics (commit `1bcd6c6`), PR3 bascule connexion (parallèle, pas remplacement — voir §9) +
  migration `features/storage` — faites. Détail et écarts réels vs plan initial en §9.

---

## 1. Question posée

RFC-0001 §6.4 pose l'existence d'une « couche cliente typée dédiée (distincte de
`src/lib/jellyfin-apiclient/`) » sans trancher son mode de production, et §9 Q2 la formule
explicitement : *génération automatique depuis l'OpenAPI de `reefin`, ou maintien manuel en
synchronisation avec les PR serveur ?* `design-web-playback-diagnostics.md` a posé un premier
pattern concret pour répondre à un besoin immédiat (types manuels miroir des DTO C#, appels
`axios` bruts sur `api.axiosInstance`) tout en documentant explicitement que ce choix est un pis-aller
temporaire (§4.3 : « jusqu'à ce que RFC-0001 §9 Q2 tranche ») et un risque (§8 : « dérive silencieuse
sans génération OpenAPI »).

Ce document tranche Q2, et va plus loin : il pose l'architecture cible pour l'ensemble de la couche
API — pas seulement le prochain endpoint Reefin, mais le remplacement progressif de `@jellyfin/sdk`
(325 fichiers importeurs) et `jellyfin-apiclient` vendored (136 fichiers importeurs).

---

## 2. Constat vérifié

### 2.1 Côté serveur — l'OpenAPI existe, est testé, versionné et diffé en CI

**Verdict : l'infrastructure OpenAPI de `reefin` est complète, pas un vœu pieux.**

- Le serveur génère sa spec via Swashbuckle (`Reefin.Server/Filters/CachingOpenApiProvider.cs`,
  `SwaggerGenerator`/`ISwaggerProvider`), exposée à `/api-docs/openapi.json`, avec mise en cache
  mémoire (5 min) et verrou async pour éviter les générations concurrentes.
- Un test d'intégration dédié (`tests/Reefin.Server.Integration.Tests/OpenApiSpecTests.cs`) appelle
  cette route, vérifie le succès et le `Content-Type`, et **écrit le JSON sur disque** — c'est
  l'artefact que la CI publie.
- Preuve directe sur l'artefact généré localement
  (`tests/Reefin.Server.Integration.Tests/bin/Debug/net10.0/openapi.json`, 1.9 Mo) :

  ```
  openapi: 3.0.4
  info.title: "Reefin API"
  info.version: "12.0.0"           (= SharedVersion.cs, AssemblyVersion)
  info.x-tesserafin-version: "12.0.0"
  paths: 299
  components.schemas: 395
  ```

  Les routes `PlaybackDiagnostics` de PR92 y sont bien présentes (`/System/PlaybackDiagnostics/Sessions`,
  `.../{id}`, `.../{id}/Fixture`) avec leurs schémas (`PlaybackDiagnosticDetail`,
  `PlaybackSessionResponse`, `DiagnosticComparison`, etc.) — **et** les routes héritées de Jellyfin
  (`/Users`, `/Users/AuthenticateByName`, `/Items/Filters`, `/Items/{itemId}/Images`, …) cohabitent
  dans la **même** spec. **La spec `reefin` est un superset de l'API Jellyfin stock, pas une spec
  Reefin-only.** C'est le fait le plus structurant de ce document : il rend un remplacement complet
  de `@jellyfin/sdk` (pas seulement un complément pour les routes Reefin) réellement possible depuis
  une seule source de vérité.

- Pipeline CI complet, quasi identique à ce qu'utilise Jellyfin upstream pour publier
  `repo.jellyfin.org` :
  - `.github/workflows/openapi-generate.yml` : job réutilisable, fait tourner
    `OpenApiSpecTests`, publie `openapi.json` en artefact GitHub Actions.
  - `.github/workflows/openapi-pull-request.yml` (« OpenAPI Check ») : génère la spec sur la base
    **et** sur la tête de chaque PR, puis lance `openapitools/openapi-diff:2.1.6` (Docker) en mode
    `--state -l ERROR`, publie un rapport Markdown commenté automatiquement sur la PR
    (`openapi-workflow-run.yml`). **C'est un gate de breaking change de facto au niveau du contrat
    HTTP**, exécuté sur *chaque* PR serveur, avant même de toucher au web.
  - `.github/workflows/openapi-merge.yml` (« OpenAPI Publish ») : publie deux canaux distincts vers
    un serveur de dépôt (`/srv/repository/main/openapi/`) — `unstable/` (horodaté, à chaque push sur
    `master`) et `stable/` (à chaque tag `v*`), avec des symlinks `reefin-openapi-unstable.json` /
    `reefin-openapi-stable.json` + `..._previous.json` pour un rollback simple. C'est très exactement
    le mécanisme que `@jellyfin/sdk` consomme côté Jellyfin upstream pour ses propres builds
    `0.0.0-unstable.<date>`.

- **Il n'existe en revanche aucun document de politique de versionnement API** (recherche dans
  `docs/tesserafin/*.md` côté serveur : aucun résultat pour « politique de version », « breaking API »,
  etc.). Ce qui existe est un **mécanisme de facto plutôt qu'une politique écrite** : une seule
  spec Swagger (`api-docs`) versionnée par `info.version` = version d'assembly globale
  (`SharedVersion.cs`, `12.0.0`), plus des champs de version *dans* certains payloads
  (`PlaybackSessionResponse.DecisionVersion`, sentinel `0` = `LegacyDecisionVersion` ;
  `PlaybackRequestContext.EngineVersion`) documentés au cas par cas dans PR91/PR92, pas de manière
  transversale. **Constat additionnel** : le web consomme aujourd'hui `MINIMUM_VERSION` depuis
  `@jellyfin/sdk/lib/versions` (`'10.10.0'`, un numéro de version **Jellyfin**, pas Reefin) pour son
  garde-fou de compatibilité serveur (`connectionManager.js` L67) — un exemple concret de dérive déjà
  présente : le web valide la compatibilité contre un schéma de version qui n'est plus celui du
  serveur qu'il cible. La couche API Reefin doit corriger ce point (§4.1).

### 2.2 Côté web — `@jellyfin/sdk` est un générateur openapi-generator-cli pointé sur Jellyfin, pas sur Reefin

- `node_modules/@jellyfin/sdk/package.json` confirme le pipeline : `build:generated-client` lance
  `openapi-generator-cli generate` (template `typescript-axios`, configuré ailleurs dans ce paquet)
  puis `build:sdk` construit avec Rollup les classes `Jellyfin`/`Api` qui enveloppent le client
  généré (`fix-schema` corrige la spec source avant génération). C'est exactement le même modèle
  d'outillage que celui déjà en place côté `reefin` serveur (§2.1) — Reefin n'a pas besoin
  d'inventer un pipeline, il peut forker celui que `@jellyfin/sdk` utilise déjà et le pointer sur sa
  propre spec.
- Le paquet installé dans `reefin-web` (`package.json` : `"@jellyfin/sdk": "0.0.0-unstable.202607090422"`)
  est résolu depuis le registre npm public (`registry.npmjs.org`), donc généré depuis l'OpenAPI
  **Jellyfin** upstream, pas Reefin — vérifié : zéro occurrence de `PlaybackDiagnostics` dans
  `node_modules/@jellyfin/sdk/dist/lib/generated-client`. C'est la preuve directe pourquoi
  `design-web-playback-diagnostics.md` a dû créer un mirror manuel : la seule source de types
  disponible aujourd'hui ne connaît pas les routes Reefin, alors même que le serveur les expose
  officiellement dans sa propre spec (§2.1).
- **Points d'entrée de connexion**, tracés dans le code :
  - `src/hooks/useApi.tsx` : contexte React exposant à la fois `api?: Api` (instance `@jellyfin/sdk`)
    et `__legacyApiClient__?: ApiClient` (instance `jellyfin-apiclient`) — les deux mondes coexistent
    déjà dans l'API interne la plus consommée du dépôt (`useApi()`).
  - `src/lib/jellyfin-apiclient/ServerConnections.js` + `connectionManager.js` (846 lignes) :
    gèrent la découverte serveur, le multi-serveur, l'authentification (`authenticateUserByName`,
    Quick Connect), le stockage des credentials, la reconnexion, et le WebSocket
    (`apiClient.subscribe = apiClient._sdk.subscribe.bind(apiClient._sdk)`, L56). Rien de tout cela
    n'est généré ni générable depuis une spec OpenAPI — c'est de la logique de session/protocole,
    pas des DTO/endpoints REST.
  - `src/utils/jellyfin-apiclient/compat.ts` (`toApi()`) : **le point d'articulation exact** entre
    les deux mondes. Il instancie `new Jellyfin({ clientInfo, deviceInfo }).createApi(serverAddress,
    accessToken)` à partir des champs de l'`ApiClient` legacy — c'est ici, et seulement ici, que
    l'identifiant client (`appName`) et l'appareil (`deviceName`/`deviceId`) traversent la frontière
    entre connexion et SDK typé. `connectionManager.js` a une deuxième occurrence du même pattern
    (`apiClient._sdk ??= toApi(apiClient)`, appelée à 3 endroits).
  - `src/components/apphost.js:11` : `const appName = 'Jellyfin Web'`, propagé via
    `appHost.appName()` jusqu'à `toApi()` puis jusqu'au header `Authorization: ... Client="Jellyfin
    Web"`. Couplage documenté par `branding-audit.md` catégorie 1 avec `src/utils/image.ts:84`
    (`case 'Jellyfin Web':` pour l'icône d'appareil) — un renommage de cette chaîne sans coordination
    serveur casse la reconnaissance de session/device côté serveur.

### 2.3 Chevauchement réel — trois catégories, pas un bloc « 325+136 »

Le chiffre « 325 fichiers `@jellyfin/sdk` + 136 fichiers `jellyfin-apiclient` » (`branding-audit.md`)
est un compte d'*importeurs*, pas une mesure homogène de travail de migration. En creusant les
imports réels, trois catégories bien distinctes émergent, avec des traitements différents :

| Catégorie | Nature | Exemple constaté | Traitement |
| --- | --- | --- | --- |
| **(a) Appels `@jellyfin/sdk` générés** | REST typé pur, classes par tag (`getUserApi(api).getCurrentUser()`, etc.) — 325 fichiers | Quasi tout `apps/dashboard`, `apps/modern` | Migration **mécanique** : même forme d'appel après régénération sur la spec Reefin, seul le point de construction change (§4). |
| **(b) Méthodes REST héritées de `jellyfin-apiclient` (`ApiClient`)** | API pré-SDK, écrite à la main, non générée, sous-ensemble des 136 | `apiClient.getCurrentUserId()` (63+ sites, dont `playbackmanager.js` 12×, `itemDetails/index.js` 16×), `apiClient.getUrl()`, `apiClient.getScaledImageUrl()`, `apiClient.getItem()`, `apiClient.getJSON()` — concentrés dans `apps/legacy`, `components/`, `plugins/` | **Vraie réécriture**, pas un swap d'import : ces méthodes n'ont pas d'équivalent 1:1 dans le SDK généré (ex. `getUrl()` construit une URL signée, `getScaledImageUrl()` fait de la logique de redimensionnement). Migrent tranche par tranche vers le SDK généré + utilitaires dédiés. |
| **(c) Connexion/session `jellyfin-apiclient`** | Découverte serveur, credentials multi-serveur, auth, Quick Connect, WebSocket, reconnexion | `ConnectionManager`, `ServerConnections`, `Credentials` | **Non générable depuis OpenAPI** par nature (protocole de session, pas endpoints REST documentés en tant que tels). Reste du code écrit à la main dans les deux scénarios — seul son nom et son point d'interfaçage avec le SDK typé changent. |

Cette distinction est structurante pour tout le reste du document : le débat « générer ou écrire à
la main » ne s'applique qu'aux catégories (a) et (b). La catégorie (c) est hors sujet pour la
génération OpenAPI — elle est simplement renommée/réécrite en tant que telle, cf. §4.2.

---

## 3. Options évaluées

| Option | Description | Verdict |
| --- | --- | --- |
| **(a) Génération complète depuis l'OpenAPI Reefin** | Fork du pipeline `openapi-generator-cli` (déjà utilisé par `@jellyfin/sdk` lui-même) pointé sur la spec `reefin` (superset, §2.1) | **Retenue**, avec les précisions de §4 |
| **(b) Types manuels par feature (pattern `playback/api/`)** | Continuer d'étendre le pattern déjà posé par `design-web-playback-diagnostics.md` à chaque nouvel endpoint Reefin | **Rejetée comme politique par défaut** — voir argumentaire ci-dessous |
| **(c) Hybride : génération pour les types, clients fins manuels par feature** | Générer les *types* seulement (ex. `openapi-typescript`), garder des fonctions d'appel manuelles par feature au-dessus | **Rejetée en l'état** au profit d'une variante différente de « génération complète », voir ci-dessous |

### Pourquoi pas (b) en politique générale

`design-web-playback-diagnostics.md` §8 documente déjà le risque : *« sans génération OpenAPI, le
miroir manuel peut diverger silencieusement si le DTO serveur change »*. Ce n'était pas un problème
pour un seul endpoint expérimental — ça devient une dette proportionnelle au nombre de tranches
verticales qui touchent des routes Reefin, alors que RFC-0001 pose justement des breaking changes
serveur **fréquents et assumés** comme politique produit (§3, §8). Maintenir des DTO à la main contre
un serveur qui change intentionnellement et souvent est le pire terrain pour cette approche. Le
pattern reste néanmoins légitime comme **filet transitoire** (§4.3), pas comme politique de fond.

### Pourquoi pas l'hybride « types seuls + fetch manuel » (variante `openapi-typescript`/`orval`/`hey-api`)

C'est la question qui aurait pu faire pencher la balance différemment si la spec Reefin n'était
qu'un **complément** aux routes Jellyfin stock (scénario où `@jellyfin/sdk` continuerait de couvrir
l'essentiel et un petit outil léger couvrirait seulement le delta Reefin). Ce n'est pas le cas
constaté en §2.1 : **la spec `reefin` est un superset complet**, donc l'objectif réaliste n'est pas
d'ajouter un deuxième outil à côté de `@jellyfin/sdk`, c'est de **le remplacer** à terme par son
équivalent généré depuis Reefin. Dans ce cadre :

- Un outil « léger » (types + fetch typé façon `openapi-fetch`) change le **paradigme d'appel** —
  `client.GET('/Users/{userId}', { params })` au lieu de `getUserApi(api).getUserById(userId)`.
  Chaque site parmi les 325 imports `@jellyfin/sdk` migrés devrait être **réécrit**, pas juste
  re-pointé, et les deux paradigmes cohabiteraient dans le code pendant toute la durée de la
  migration (des années, vu le volume et la politique de tranches verticales de RFC-0001 §6.5).
- Un fork du générateur `@jellyfin/sdk` lui-même (même template `typescript-axios`, mêmes classes
  `Api` par tag, même enveloppe `Jellyfin`/`createApi`) produit un client **de la même forme**. La
  migration d'un site d'appel devient : changer l'import de la classe `*Api` (nouvelle source de
  génération) et le point de construction (`toApi`/`getApi`), sans toucher à la forme de l'appel
  lui-même dans la majorité des cas — un swap mécanique, automatisable en bonne partie par un
  script de réécriture d'imports plutôt qu'une relecture ligne à ligne de 325 fichiers.

Le coût d'outillage plus lourd d'`openapi-generator-cli` (dépendance Java, ~300 fichiers générés) est
déjà payé aujourd'hui via `@jellyfin/sdk` — ce n'est pas un coût ajouté, c'est un coût substitué à
l'identique. Le bénéfice (migration mécanique de 325 sites plutôt que 325 réécritures) l'emporte
largement dans ce contexte spécifique de remplacement à grande échelle.

### Recommandation ferme

**Option (a) précisée : génération complète, avec le même outillage `openapi-generator-cli`/template
`typescript-axios` que `@jellyfin/sdk`, pointée sur la spec `reefin` (superset), produisant un client
local qui remplace `@jellyfin/sdk` par tranches — combinée à une réécriture manuelle ciblée (pas
générée) de la couche connexion/session héritée de `jellyfin-apiclient` (catégorie (c) de §2.3).** Le
pattern « types manuels par feature » de `design-web-playback-diagnostics.md` est conservé comme
filet transitoire ponctuel (nouvelle route Reefin mergée serveur avant la prochaine régénération
web), jamais comme politique de fond une fois le pipeline de génération en place.

---

## 4. Architecture retenue

### 4.1 Génération

- Nouveau module local **`src/lib/tesserafin-sdk/`**, sous-dossier `generated/` produit par
  `openapi-generator-cli` (template `typescript-axios`), **committé** dans le dépôt (pas
  `.gitignore`) pendant toute la phase de coexistence — pour que chaque régénération soit un diff de
  code review normal, symétrique du gate `openapi-diff` déjà en place côté serveur (§2.1, §6).
- Source de la spec : canal `unstable` (`reefin-openapi-unstable.json`) en développement, `stable`
  sur les branches de release — reproduisant le canal dual déjà publié par
  `.github/workflows/openapi-merge.yml`.
- Script npm dédié (`generate:tesserafin-sdk`) qui télécharge la spec, corrige les incompatibilités
  connues du générateur si besoin (miroir de `fix-schema` dans `@jellyfin/sdk`), génère, puis
  applique le même type de wrapper `Jellyfin`/`Api`/`createApi` que le SDK actuel — **de sorte que le
  point de construction reste un seul appel** (`createApi(serverAddress, accessToken)`), condition
  nécessaire au swap mécanique décrit en §3.
- Corrige au passage le constat de §2.1 : `MINIMUM_VERSION` doit être dérivé de la version Reefin
  réelle (`x-tesserafin-version` / `SharedVersion.cs`), pas resté sur la constante Jellyfin `10.10.0`
  héritée de `@jellyfin/sdk`.
- Nom de paquet : `tesserafin-sdk` en local le temps de la coexistence (pas de publication npm tant
  qu'un seul dépôt le consomme) ; l'éventuelle publication externe est hors périmètre de ce document.

### 4.2 Couche connexion (successeur de `jellyfin-apiclient`)

- La catégorie (c) de §2.3 (`ConnectionManager`, `ServerConnections`, `Credentials`, WebSocket,
  Quick Connect) n'est **pas générée** — elle est conservée et progressivement réécrite/renommée,
  ancrée dans `src/lib/reefin-connection/` (successeur de `src/lib/jellyfin-apiclient/`), en dehors
  du périmètre de ce document (RFC de renommage dédié, cohérent avec RFC-0001 §3 politique de
  breaking change).
- Le seul changement structurel exigé par ce document : son point de sortie vers le SDK typé
  (aujourd'hui `toApi()` dans `compat.ts`, appelé depuis `connectionManager.js`) doit construire une
  instance `tesserafin-sdk` plutôt que `@jellyfin/sdk`, sans changer sa propre logique interne
  d'authentification/session.

### 4.3 Clients fins manuels par feature — statut résiduel

- Le pattern posé par `design-web-playback-diagnostics.md` (`features/playback/api/types.ts` +
  `playbackDiagnosticsApi.ts`) reste légitime **uniquement** comme filet transitoire pour une route
  serveur qui vient d'être mergée mais que la génération web n'a pas encore absorbée. Dès que
  `tesserafin-sdk` est régénéré et inclut la route, le mirror manuel est supprimé au profit du client
  généré — c'est explicitement le premier cas d'usage prévu (§7, PR2).
- Aucune nouvelle route Reefin ne doit donner lieu à un nouveau dossier `features/*/api/types.ts`
  mirroir une fois le pipeline de génération en place (§7, PR1) — sauf urgence documentée
  explicitement dans la PR concernée.

### 4.4 Identifiant client — point d'articulation (pas le renommage lui-même)

`branding-audit.md` catégorie 1 interdit à raison de renommer `'Jellyfin Web'` sans coordination
serveur (Quick Connect, gestion des appareils, capacités client en dépendent). Ce document ne
tranche pas ce renommage — il garantit seulement que la nouvelle couche API a **un seul point
d'articulation** au lieu des deux aujourd'hui couplés (`apphost.js:11` *et* `image.ts:84`) :

- Aujourd'hui : `appHost.appName()` → `'Jellyfin Web'` → `ApiClient.appName()` → `toApi()` →
  `Jellyfin({ clientInfo: { name } })` → header `Authorization` — et séparément, `image.ts:84` doit
  connaître la même chaîne littérale pour l'icône d'appareil.
- Cible : une constante unique (ex. `TESSERAFIN_CLIENT_IDENTITY`, nom logique + éventuel nom d'affichage
  séparé) injectée **une fois** au point de construction du SDK (`tesserafin-sdk`'s `createApi`
  équivalent), consommée par la couche connexion (§4.2). `image.ts` doit dériver son mapping du même
  point de vérité plutôt que de dupliquer la chaîne littérale — élimine le couplage à deux endroits
  identifié par `branding-audit.md`, sans effectuer le renommage lui-même (qui reste un changement
  serveur+web coordonné, hors périmètre ici).

---

## 5. Arborescence cible

```
src/
  lib/
    tesserafin-sdk/                       # remplace progressivement @jellyfin/sdk
      generated/                      # sortie openapi-generator-cli (committée), régénérée par script
      index.ts                        # ré-export + wrapper Jellyfin/Api/createApi (miroir du SDK actuel)
      versions.ts                     # MINIMUM_VERSION dérivé de x-tesserafin-version, pas de la constante Jellyfin héritée
    reefin-connection/                 # successeur de lib/jellyfin-apiclient/ (catégorie (c), non généré)
      ConnectionManager.ts
      ServerConnections.ts
      credentials.ts
      websocket.ts
      compat.ts                        # point d'articulation unique : construit l'Api tesserafin-sdk (§4.4)
  apps/
    dashboard/
      features/
        playback/
          api/                         # PR2 : mirror manuel remplacé par tesserafin-sdk généré
        <feature>/
          api/                         # nouveau : uniquement filet transitoire (§4.3), pas la norme
  hooks/
    useApi.tsx                         # évolue pour exposer l'Api tesserafin-sdk (nom de champ à décider en PR3)
scripts/
  generate-tesserafin-sdk.ts               # script CI/local : télécharge la spec, génère, applique le wrapper
.github/workflows/
  tesserafin-sdk-contract-check.yml        # PR1 : job openapi-diff web, cf. §6
```

`src/lib/jellyfin-apiclient/` et `src/utils/jellyfin-apiclient/` ne sont pas supprimés dans ce
document — ils disparaissent au fil des tranches verticales qui migrent, comme prévu par RFC-0001
§6.2/§6.5, jamais par une suppression en masse dédiée.

---

## 6. Tests de contrat contre l'OpenAPI serveur

Le mécanisme le plus fort déjà disponible est **côté serveur** (§2.1) : `openapi-diff` en CI sur
chaque PR serveur, avec sortie `ERROR` sur breaking change. La couche API Reefin le réutilise plutôt
que d'en réinventer un :

1. **Pin de version** : `tesserafin-sdk/generated/` embarque (ou un fichier `tesserafin-sdk/spec-version.json`
   à côté) la version/l'horodatage de la spec utilisée pour la dernière génération.
2. **Job CI web dédié** (`tesserafin-sdk-contract-check.yml`) : télécharge la spec `unstable` (ou
   `stable` selon la branche cible) courante depuis le serveur de dépôt Reefin, la compare via la
   même image `openapitools/openapi-diff:2.1.6` à la spec pinnée dans le dépôt. Un diff `ERROR` ne
   fait pas échouer la PR silencieusement — il pose un commentaire automatique (même mécanisme que
   `openapi-workflow-run.yml` côté serveur) invitant à régénérer `tesserafin-sdk`.
3. **Test de fraîcheur du généré** : un script (`verify:tesserafin-sdk-fresh`) régénère dans un dossier
   temporaire à partir de la spec pinnée et diffe contre le contenu committé — empêche une édition
   manuelle du code généré qui serait écrasée à la prochaine régénération légitime.
4. Le test de fixture proposé par `design-web-playback-diagnostics.md` §7.2 (fixtures
   `tests/PlaybackCompat/` désérialisées contre les types TS) reste pertinent, mais son périmètre se
   réduit : utile pour la portion de contrat **non capturée** par le typage OpenAPI pur (ex. la
   sémantique `DecisionVersion === 0` comme sentinel « source legacy », qu'un schéma JSON ne peut pas
   exprimer aussi précisément qu'un test de fixture réel) — pas pour vérifier que les champs
   existent, ce que la génération garantit par construction.

---

## 7. Stratégie de migration progressive

**Principe** : aucune campagne de migration API dédiée et séparée du travail produit. Chaque tranche
verticale (RFC-0001 §6.5) qui touche une route migre ses propres appels vers `tesserafin-sdk` /
`reefin-connection` en même temps qu'elle livre sa fonctionnalité — jamais une PR qui migre des
imports sans toucher à un écran réel.

- **Règle de bascule** : à l'intérieur d'un même fichier, un appel utilise soit l'ancien SDK soit le
  nouveau, jamais les deux pour la même route — la bascule est all-or-nothing au niveau
  fichier/feature, pas ligne à ligne. Le point de construction (`useApi()`, §4.2) peut exposer les
  deux instances en parallèle pendant la transition (comme il expose déjà `api` et
  `__legacyApiClient__` aujourd'hui) sans que ce soit un problème — c'est l'état actuel du dépôt, pas
  une régression.
- **Ordre de migration**, aligné sur la roadmap RFC-0001 §7 et sur la structure §1.2/§6.3 du RFC :
  1. `apps/dashboard` (181 fichiers, ~99 % TS/TSX, petit rayon de blast, déjà le terrain de la
     première tranche playback diagnostics) — meilleur terrain de validation de la mécanique de swap
     (§3), avant de généraliser.
  2. `apps/modern` (114 fichiers), **à l'exception explicite** des 12 composants qui importent encore
     directement `playbackmanager.js` — ceux-là attendent l'encapsulation prévue par RFC-0001 §6.2
     avant de pouvoir migrer proprement (migrer l'API sans encapsuler `playbackmanager.js` d'abord
     créerait un composant qui parle aux deux mondes pour la même fonctionnalité).
  3. `components/`, `elements/`, `apps/legacy` — catégorie (b) de §2.3 en majorité (méthodes
     `ApiClient` hand-written, pas de simples appels SDK) : migrent au cas par cas, seulement quand
     une tranche verticale les traverse, jamais en campagne dédiée (cohérent avec RFC-0001 §6.2 in
     fine).
- **Suivi** : un tableau de progression (fichier markdown simple dans `docs/tesserafin/`, ou label
  GitHub sur les PR de migration) trace la bascule fichier par fichier — pas d'outillage
  supplémentaire nécessaire pour ce périmètre.
- **Fin de vie** : `src/lib/jellyfin-apiclient/`, `src/utils/jellyfin-apiclient/`, et la dépendance
  npm `@jellyfin/sdk`/`jellyfin-apiclient` sont retirés seulement quand plus aucun fichier ne les
  importe — pas de suppression forcée avant, pas de date fixée arbitrairement dans ce document.

---

## 8. Les 3 premières étapes (PR-sized)

**PR1 — Pipeline de génération, aucune migration — ✅ Fait (`ce75215`)**
- Script `generate:tesserafin-sdk`, dossier `src/lib/tesserafin-sdk/generated/` produit et committé, wrapper
  `Jellyfin`/`Api`/`createApi` compatible en forme avec l'usage actuel de `@jellyfin/sdk`.
- Job CI `tesserafin-sdk-contract-check.yml` (§6) et script `verify:tesserafin-sdk-fresh`.
- `versions.ts` : `MINIMUM_VERSION` dérivé de `x-tesserafin-version`, corrige le constat de §2.1.
- Rien dans le reste du dépôt ne change — vérifiable indépendamment, testable contre un serveur
  `reefin` de dev réel (spec `unstable`).
- **Écart réel vs plan** : le job CI `tesserafin-sdk-contract-check.yml` et `verify:tesserafin-sdk-fresh`
  n'ont **pas** été livrés dans ce PR (§9.4) — tout le reste l'a été. Deux passes de normalisation
  de spec non anticipées ont dû être ajoutées au script (§9.1).

**PR2 — Premier consommateur réel : remplacer le mirror manuel playback diagnostics — ✅ Fait (`1bcd6c6`)**
- Supprime `features/playback/api/types.ts` (mirror manuel de PR91/PR92) et
  `playbackDiagnosticsApi.ts` (appels `axios` bruts), les remplace par les classes générées
  `tesserafin-sdk` pour `PlaybackDiagnosticsSessionsController` (`PlaybackSessionResponse`,
  `PlaybackDiagnosticDetail`, etc. — déjà confirmés présents dans la spec, §2.1).
- Referme directement la question ouverte §9.2 de `design-web-playback-diagnostics.md` (« mirror
  local à la feature, ou lib partagée dès un deuxième cas d'usage ») : la réponse devient « ni l'un
  ni l'autre, génération centralisée » — la question elle-même disparaît.
- Preuve de concept end-to-end de tout ce document sur un cas déjà designé et testé plutôt que sur
  du code jamais éprouvé.
- **Écart réel vs plan** : `types.ts` n'a pas disparu comme annoncé — il existe toujours, mais son
  contenu est dérivé des types générés (`DeepRequired<T>`) plutôt que retapé à la main ; un pont
  (`systemApiFor`) reste nécessaire à l'appel (§9.2). Le principe (génération = source de vérité,
  plus de mirror manuel du DTO C#) est respecté ; la promesse littérale « le fichier disparaît »
  ne l'était pas.

**PR3 — Bascule du point de construction + premier module `apps/dashboard` existant migré — ✅ Fait**
- `compat.ts`/`connectionManager.js` (§4.2) construisent une instance `tesserafin-sdk` en parallèle de
  `@jellyfin/sdk` (les deux exposées via `useApi()`, comme `api`/`__legacyApiClient__` le sont déjà
  aujourd'hui). **Confirmé exactement comme prévu ici — voir §9.3 pour pourquoi une bascule
  complète (remplacer `api` plutôt que le compléter) a été explicitement écartée.**
- Un module `apps/dashboard` déjà consommateur de `@jellyfin/sdk` sur des routes **héritées**
  Jellyfin (`features/storage` — devinée juste en §8 d'origine) migre entièrement vers `tesserafin-sdk` —
  test de la promesse centrale de §3 : un swap mécanique de classe `*Api` et de point de
  construction, sans réécriture de la logique métier du composant. **Confirmé mécanique en
  pratique** : seuls les imports (`@jellyfin/sdk` → `lib/tesserafin-sdk`) et le champ lu sur `useApi()`
  (`api` → `reefinApi`) ont changé dans `useSystemStorage.ts`/`StorageListItem.tsx`/`space.ts`/
  `space.test.ts` — zéro changement de logique, zéro changement de JSX, zéro changement de test
  autre que l'import.

---

## 9. État d'implémentation et écarts réels

PR1-3 sont faites (§8). Cette section documente ce qui a divergé du plan initial en le construisant
réellement, et ce qui reste — pas une nouvelle ronde de design, un constat après coup.

### 9.1 PR1 — deux passes de normalisation de spec non anticipées

Le plan (§4.1) prévoyait « corrige les incompatibilités connues du générateur si besoin (miroir de
`fix-schema` dans `@jellyfin/sdk`) » au conditionnel — en pratique, deux corrections concrètes ont
été nécessaires dans `scripts/generate-tesserafin-sdk.mjs`, toutes deux des artefacts
Swashbuckle/`openapi-generator-cli`, pas de la logique métier Reefin :

1. **Enums avec `allOf`+`enum` redondants** : Swashbuckle émet `{ enum: [...], allOf: [{ $ref }] }`
   pour tout paramètre/propriété de type enum (257 occurrences dans la spec courante).
   `openapi-generator-cli` 7.11.0 (template `typescript-axios`) ne sait pas résoudre cette forme —
   il tente d'importer chaque *valeur* d'enum comme un nom de type
   (`import type { 'Drop' } from '../models';`, TypeScript invalide). Fix : supprimer l'`enum`
   inline, garder le `$ref` (porte la même information).
2. **Identifiants forts « wrapper »** : Reefin utilise des ID typés côté serveur (ex.
   `PlaybackSessionId { Value: string }`) qui sérialisent comme une simple chaîne via un convertisseur
   custom que Swashbuckle ignore — le schéma généré reflète donc la forme *C#* (objet), pas la forme
   *wire* (chaîne), et le paramètre de route généré (`id: PlaybackSessionId`) produirait
   `"[object Object]"` une fois interpolé dans l'URL. Fix : `unwrapIdSchemas()` déplie tout schéma
   `components.schemas` à une seule propriété `Value` vers le schéma de cette propriété — générique
   (pas un cas spécial `PlaybackSessionId`), donc couvre tout futur wrapper du même genre sans
   modification du script.

Les deux sont documentées en détail (rationale complet) dans `scripts/generate-tesserafin-sdk.mjs` et
`src/lib/tesserafin-sdk/README.md`. Aucune des deux n'est spécifique à une route Reefin métier — ce sont
des frictions Swashbuckle ↔ `openapi-generator-cli` génériques, à revalider (pas forcément à
réécrire) à chaque montée de version du générateur.

### 9.2 PR2 — deux ponts non prévus par le plan initial

Le plan (§4.3, §8) annonçait une suppression pure et simple du mirror manuel. En pratique, deux
mécanismes de pont ont été nécessaires, documentés en tête de fichier à chaque endroit :

- **`asContract<T>()` (`playbackDiagnosticsApi.ts`) et `DeepRequired<T>` (`types.ts`)** : les modèles
  générés marquent **tous** les champs optionnels (`'Foo'?: T`), y compris ceux que le contrat wire
  garantit toujours présents — Swashbuckle ne marque pas les propriétés C# non-nullables comme
  `required` dans le schéma OpenAPI ici (contrairement à `FolderStorageDto`/`SystemStorageDto`,
  §9.3, où il le fait correctement — l'inconsistance elle-même est un fait à noter, pas un bug d'un
  côté ou l'autre). `DeepRequired<T>` restaure le required/nullable exact que le mirror manuel
  encodait à la main, dérivé désormais de la structure générée plutôt que retapé depuis le source
  C#. `asContract<T>()` est le seul endroit où ce pont est franchi côté exécution (un cast documenté
  à la frontière du client généré). Un seul champ reste réellement retapé à la main :
  `DiagnosticTimelineEntry.Stage` (généré en `string` brut, cinq valeurs non modélisées comme enum
  côté serveur).
- **`systemApiFor(api: Api): SystemApi` (`playbackDiagnosticsApi.ts`)** : construit le `SystemApi`
  généré à partir de la session `@jellyfin/sdk` **existante** (`api.basePath`/`axiosInstance`/
  `authorizationHeader`), plutôt que via `createTesserafinApi()` (le point de construction indépendant
  du wrapper `tesserafin-sdk`, §4.1). Nécessaire parce qu'au moment de PR2 le point de construction
  n'était pas encore basculé (PR3) — construire une identité indépendante à ce stade aurait risqué
  un second `DeviceId` pour la même session. Ce pont disparaît une fois `usePlaybackSessions`/
  `usePlaybackSessionDetail`/`useExportFixture` migrés vers `reefinApi` (§9.5, backlog).

### 9.3 PR3 — bascule connexion : parallèle, pas remplacement (décision motivée, avec preuves)

Le message qui a déclenché ce PR demandait explicitement d'évaluer si une bascule complète (`api`
remplacé par `TesserafinApi` dans `useApi()`/`toApi()`/`compat.ts`) était trop risquée, et de préférer la
version minimale sûre du §8 PR3 d'origine (construction **parallèle**) en le documentant si c'était
le cas. Audit fait avant d'écrire du code :

- **~134 fichiers appellent `useApi()`**, ~147 sites d'appel.
- **`api.subscribe(...)` (WebSocket) est utilisé dans 15+ fichiers** pour des fonctionnalités
  temps réel non négociables : SyncPlay (`serverNotifications.js`), sessions et tâches live du
  dashboard admin (`useLiveSessions.ts`, `useLiveTasks.ts`), indicateurs de rafraîchissement
  d'image (`emby-itemrefreshindicator`), invalidation de cache sur `UserDataChanged`/
  `TimerCreated`/etc. (`ItemsContainer.tsx`, `emby-itemscontainer.js`), contrôle à distance de
  lecture (`playbackmanager.js`), minuteries du guide TV (`guide.js`, `recordingfields.js`).
- **`TesserafinApi` n'a pas de WebSocket** (choix assumé du wrapper, §4.1/§4.2 — c'est une préoccupation
  de couche connexion, pas de SDK typé) et **`connectionManager.js` mute `_sdk` en place via
  `.update()`** (pas de reconstruction) sur re-login/refresh de token — deux mécanismes que
  `TesserafinApi` ne reproduisait pas nativement.

**Conclusion** : remplacer `api` aurait cassé silencieusement tout ce qui précède (aucune erreur
`tsc` en JS non typé, échec seulement à l'exécution). C'est exactement le risque que le message
demandait d'évaluer avant d'agir — la version minimale sûre a donc été retenue, **comme prévu par
le plan d'origine**, pas comme un repli de dernière minute.

**Ce qui a été construit** (additif, zéro ligne existante modifiée dans `connectionManager.js` —
uniquement des lignes ajoutées en miroir des lignes `_sdk` existantes) :

- `TesserafinApi.update(data)` — même rôle que `Api.update()` de `@jellyfin/sdk`, sans la partie
  WebSocket (`TesserafinApi` n'en a pas).
- `toTesserafinApi(apiClient): TesserafinApi` (`utils/jellyfin-apiclient/compat.ts`) — miroir exact de
  `toApi()`, même `serverAddress`/`accessToken`/`deviceName`/`deviceId` (donc **même `DeviceId`**,
  exigence explicite du message), seule différence délibérée : `clientInfo.name` vient de
  `TESSERAFIN_CLIENT_IDENTITY.name` plutôt que d'être re-dérivé via `apiClient.appName()` → même valeur
  littérale (`'Jellyfin Web'`) aujourd'hui, donc **aucun changement observable côté serveur** — c'est
  le point d'articulation unique de §4.4, maintenant réellement câblé.
- `connectionManager.js` : `apiClient._reefinSdk ??= toTesserafinApi(apiClient)` ajouté aux 2 sites de
  création qui exposent l'instance à un consommateur externe (`addApiClient`, `_getOrAddApiClient`,
  plus la méthode `getTesserafinApi(serverId)` elle-même qui fait le lazy-create) ; `apiClient._reefinSdk
  ?.update(...)` ajouté aux 2 sites où `apiClient._sdk?.update(...)` existe déjà (les deux points de
  login). `getTesserafinApi(serverId)` ajouté en miroir de `getApi(serverId)`.
- `useApi()` expose `reefinApi?: TesserafinApi`, calculé dans le même effet et sur le même déclencheur
  que `api` (changement de `legacyApiClient`) — additif, `api`/`__legacyApiClient__` inchangés.
- Question ouverte §11.1 (nom de champ) **tranchée** : `reefinApi`, à côté de `api`.

**Limite résiduelle assumée** : `reefinApi` est tenu à jour par mutation en place
(`_reefinSdk.update(...)`), donc toujours current au moment de l'appel (même mécanisme que `_sdk`,
pas de re-render nécessaire) — **sauf** si un futur consommateur ignore `.update()` et snapshotte
`reefinApi.accessToken`/`authorizationHeader` dans une variable au lieu de les lire au moment de
l'appel. Même piège que `@jellyfin/sdk`'s `api` aujourd'hui, pas un piège nouveau introduit ici — mais
à rappeler dans toute revue de code d'un futur consommateur `reefinApi`.

### 9.4 CI contract-check (§6) — toujours pas fait

Ni PR1 ni PR2 ni PR3 n'ont livré `tesserafin-sdk-contract-check.yml`/`verify:tesserafin-sdk-fresh` (§6). Le
script de génération produit déjà `spec/version.json` (tout ce qu'il faut pour un futur job de diff),
mais le job CI lui-même reste à écrire. Ne bloque rien de ce qui a été fait jusqu'ici — signalé comme
dette explicite, pas oublié silencieusement.

Point d'attention noté sans être bloquant (rappel §2.1/README) : la spec utilisée pour générer
provient d'un checkout local `reefin` encore en version serveur `12.0.0`, alors que `reefin-web`
(`package.json`) est passé à `13.0.0` entre-temps. C'est exactement le genre de dérive que le job CI
de ce paragraphe détecterait automatiquement une fois écrit.

### 9.5 Prochaines étapes de migration — ordre proposé

`features/storage` (§8 PR3) a validé la mécanique sur un module à un seul endpoint, lecture seule,
sans WebSocket. Audit du volume `@jellyfin/sdk` restant par feature `apps/dashboard/features/*`
(nombre de fichiers avec un import `@jellyfin/sdk`) pour proposer un ordre — **backlog indicatif, pas
une campagne dédiée** (§7 reste le principe : une feature migre quand une tranche verticale la
traverse, pas par lot séparé) :

| Ordre | Feature | Fichiers `@jellyfin/sdk` | Pourquoi ce rang |
| --- | --- | --- | --- |
| ✅ | `playback` | 0 (migré PR2) | Fait |
| ✅ | `storage` | 0 (migré PR3) | Fait |
| 1 | `metrics`, `branding`, `settings` (`useLocalizationOptions`) | 1 chacun | Même profil que `storage` : un seul fichier, une seule route GET, pas de mutation, pas de WebSocket — prochaine preuve la moins chère. |
| 2 | `system` (`useShutdownServer`/`useRestartServer`), `logs` | 2-3 | Toujours pas de WebSocket ; `system` introduit une route d'action (POST sans body complexe), `logs` un premier cas à plusieurs fichiers cohérents. |
| 3 | `keys` | 3 | Premier candidat avec de vraies mutations (create/revoke), bon test de la promesse « mécanique » au-delà du GET simple. |
| 4 | `devices`, `livetv` | 4-5 | Volume modéré, à auditer un par un pour du WebSocket avant de migrer (pas vérifié ici). |
| **Exclus pour l'instant** | `sessions`, `tasks` | 9, 12 | Utilisent `api.subscribe(...)` (`useLiveSessions.ts`, `useLiveTasks.ts`) — **bloqués tant que `TesserafinApi`/`reefin-connection` n'a pas de WebSocket** (§4.2, hors périmètre de ce document). Ne pas migrer partiellement (le endpoint REST sur `reefinApi`, le WebSocket resté sur `api`) sans re-vérifier que ça ne viole pas la règle « bascule all-or-nothing au niveau fichier » de §7. |
| Non auditées ici | `activity`, `backups`, `libraries`, `users`, `plugins` | 6-17 | Plus gros volume, à auditer avant de proposer un ordre fin — probable présence de WebSocket/mutations complexes vu la taille. |

---

## 10. Risques et limites connues

- **Dépendance Java/`openapi-generator-cli`** : coût d'outillage réel (déjà payé par `@jellyfin/sdk`
  aujourd'hui, mais devient un choix explicite de `reefin-web` plutôt qu'une dépendance transitive
  invisible). À documenter dans le README de développement lors de PR1.
- **Divergence de spec pendant la fenêtre de régénération** : entre un merge serveur et la prochaine
  régénération web, une route Reefin nouvelle n'est pas encore disponible dans `tesserafin-sdk` — le
  filet transitoire de §4.3 couvre ce cas, mais suppose une discipline de suppression rapide une fois
  la génération rattrapée (sinon on recrée le problème que ce document résout).
- **Couplage du swap au wrapper `Jellyfin`/`Api`** : la promesse de migration mécanique (§3) dépend
  de la fidélité du wrapper généré à la forme actuelle de `@jellyfin/sdk`. Si le fork du générateur
  dérive de cette forme (ex. changement de convention de nommage des classes par tag), le coût de
  migration de chaque site remonte vers celui d'une réécriture — PR3 est justement conçue pour
  détecter ce risque tôt, sur un seul module, avant généralisation.
- **Pas de politique de version écrite côté serveur** (§2.1) : ce document s'appuie sur des
  mécanismes de facto (canaux stable/unstable, gate `openapi-diff`) qui fonctionnent aujourd'hui mais
  ne sont garantis par aucun texte — une évolution de ces mécanismes côté `reefin` (ex. suppression
  du canal `unstable`) casserait le pipeline de génération web sans préavis contractuel. À surveiller,
  pas bloquant pour démarrer.

---

## 11. Questions ouvertes

1. ~~Nom de champ définitif exposé par `useApi()`~~ **Tranchée (§9.3)** : `reefinApi`, additif à côté
   de `api`/`__legacyApiClient__` — pas un remplacement, voir §9.3 pour l'audit qui a motivé ce choix.
2. Faut-il publier `tesserafin-sdk` comme paquet npm interne séparé dès que `reefin-web` n'est plus l'unique
   consommateur (ex. futur client TV/mobile maintenu par Reefin), ou rester en module local
   indéfiniment ? Hors périmètre tant qu'un seul dépôt le consomme (RFC-0001 §5 exclut déjà les
   clients tiers du périmètre direct de `reefin-web`).
3. Cadence de régénération : sur chaque merge serveur touchant l'OpenAPI (bruyant), sur une cadence
   fixe (hebdomadaire), ou à la demande d'une tranche verticale qui en a besoin ? Le job CI de §6
   fonctionne dans les trois cas (il détecte la dérive quelle que soit la cadence choisie) — la
   cadence elle-même n'a pas besoin d'être tranchée avant PR1. **Toujours ouverte** : le job lui-même
   n'est pas encore écrit (§9.4).
4. Renommage effectif de l'identifiant client (`'Jellyfin Web'` → identité Reefin, §4.4) : ce document
   prépare le point d'articulation unique mais ne le déclenche pas — nécessite son propre RFC
   coordonné avec le serveur (migration de sessions actives, Quick Connect), comme
   `branding-audit.md` catégorie 1 le pose déjà. **Toujours ouverte** : le point d'articulation
   (`TESSERAFIN_CLIENT_IDENTITY`) est maintenant réellement câblé (§9.3), mais sa valeur n'a pas changé.
5. **Nouvelle (§9.3)** : `TesserafinApi`/`reefin-connection` doit-il un jour porter le WebSocket, pour
   débloquer la migration de `sessions`/`tasks` (§9.5) ? Pas tranché ici — dépend du RFC de
   renommage/réécriture de la couche connexion évoqué en §4.2, hors périmètre de ce document.
