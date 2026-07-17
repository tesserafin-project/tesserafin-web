# Design — Shell Reefin et routage

- **Statut** : Draft
- **Date** : 2026-07-17
- **Auteur** : Reefin Team
- **Dépôt** : `reefin-web`
- **Dépend de** : `RFC-0003-product-rupture.md` (§9.2 « Nouveau shell et nouvelles URLs », point 17 ;
  §12 anti-goals ; §13(c) — ce RFC demande explicitement « un nouveau design doc à écrire » pour ce
  point, non résolu au moment de sa rédaction) ; `RFC-0004-platform-scope-and-legacy-tv-removal.md`
  (Accepted — §4 branches génériques UX télévision à préserver) ; `design-reefin-api-layer.md`
  (`ReefinApi`, stratégie de migration progressive du SDK, §7).
- **Portée** : design d'architecture routage/shell. Répond à la question laissée ouverte par
  RFC-0003 §13(c) (« absorbé par `apps/dashboard`/`apps/modern` existants, ou nouveau répertoire
  `apps/*` séparé ? ») et fixe la mécanique de migration route par route. Pas de code produit par ce
  document — l'implémentation concrète de la première tranche (W13.4, `/home`) est un chantier
  séparé qui s'appuie sur les décisions ci-dessous.

---

## 1. Contexte et objectif

`reefin-web` monte aujourd'hui quatre applications sous `src/apps/` : `dashboard`, `modern`,
`legacy`, `wizard`. Le point d'entrée est `src/RootAppRouter.tsx`, qui construit un routeur unique :

```ts
const router = createHashRouter([
    {
        element: <RootAppLayout />,
        children: [
            ...(layoutManager.modern ? MODERN_APP_ROUTES : LEGACY_APP_ROUTES),
            ...DASHBOARD_APP_ROUTES,
            ...WIZARD_APP_ROUTES,
            {
                path: '!/*',
                Component: BangRedirect
            }
        ]
    }
]);
```

Deux faits structurants ressortent de cette lecture, avant toute décision :

1. **`createHashRouter`** : le routage est basé sur `#/...`, pas sur l'historique HTML5. Aucune
   configuration serveur de fallback SPA n'est nécessaire aujourd'hui — chaque URL est en réalité
   servie par le même document HTML, le hash n'atteint jamais le serveur.
2. **`layoutManager.modern ? MODERN_APP_ROUTES : LEGACY_APP_ROUTES`** est un **switch global unique**,
   pas un dispatch par route. `layoutManager.modern` (`src/components/layoutManager.js:41`) dérive
   du réglage de layout utilisateur/appareil (`src/constants/layoutMode.ts`) :
   `LegacyLayoutModes = new Set([DesktopLegacy, MobileLegacy, Tv])`. Autrement dit, **le layout TV
   utilise toujours le shell legacy aujourd'hui** — ce point revient en §3 et §7.

### Inventaire réel des routes (compté dans le code, pas estimé)

| Ensemble | Fichier | Routes async React | Routes `ViewManagerPage` (legacy) | Total |
| --- | --- | --- | --- | --- |
| `MODERN_APP_ROUTES` (user) | `apps/modern/routes/{asyncRoutes,legacyRoutes}/user.ts` | 16 | 8 | 24 |
| `MODERN_APP_ROUTES` (public) | `apps/modern/routes/{asyncRoutes,legacyRoutes}/public.ts` | 1 | 4 | 5 |
| `MODERN_APP_ROUTES` (hybride) | `apps/modern/routes/video/index.tsx` (`/video`) | 1 (combine contrôles neufs + vue legacy) | — | 1 |
| **Total hébergé par `apps/modern`** | | **18** | **12** | **30** |
| `LEGACY_APP_ROUTES` (user) | `apps/legacy/routes/{asyncRoutes,legacyRoutes}/user.ts` | 4 | 15 | 19 |
| `LEGACY_APP_ROUTES` (public) | `apps/legacy/routes/{asyncRoutes,legacyRoutes}/public.ts` | 1 | 4 | 5 |
| **Total hébergé par `apps/legacy`** | | **5** | **19** | **24** |
| `DASHBOARD_APP_ROUTES` | `apps/dashboard/routes/{_asyncRoutes,_legacyRoutes}.ts` + metadata + config | 29 | 2 | 34 (dont metadata + configurationpage + 1 redirect) |
| `WIZARD_APP_ROUTES` | `apps/wizard/routes/routes.tsx` | 0 | 6 | 6 (sous `/wizard`) |

**Constat le plus important de ce tableau** : `apps/modern` héberge déjà 12 routes qui restent des
`ViewManagerPage` — des pages jQuery legacy (contrôleur + vue HTML) simplement rendues sous le chrome
`AppLayout` moderne, pas des composants React. Le shell « moderne » et le contenu « moderne » sont
deux axes indépendants — c'est la distinction que ce document doit garder explicite tout du long
(voir §3, §4, §5).

`apps/dashboard` (181 fichiers, ~99 % TS/TSX — RFC-0001 §6.3, cité par RFC-0003 §9.1) et
`apps/wizard` (6 routes, onboarding borné) ne posent pas de problème d'architecture : ce sont des
domaines fonctionnels fermés, montés une fois pour toutes dans `RootAppRouter.tsx`. La question que
ce document tranche porte sur `apps/modern` vs `apps/legacy` : lequel absorbe l'autre, et comment,
route par route — exactement la question laissée ouverte par RFC-0003 §13(c).

---

## 2. Décisions

### 2.1 `apps/modern` devient le shell Reefin cible — pas de troisième shell

`apps/modern` héberge déjà le chrome complet (`AppLayout`, `AppToolbar`, `AppDrawer`, §3), le pattern
de données établi (`@tanstack/react-query` dans `apps/modern/features/*` — `useGetItemByType.ts`,
`useMovieRecommendations.ts`, `useAncestors.ts`, `useLibrary.tsx`), et la connexion à `ReefinApi` via
`useApi()` (`src/hooks/useApi.tsx`). RFC-0003 §11 point 3 qualifie déjà ce socle de suffisamment mûr
(« en cours » qualifie la maturité du socle, pas son absence). Construire un troisième shell
dupliquerait ce chrome pour zéro bénéfice.

**Alternative rejetée** : nouveau répertoire `apps/reefin` ou `apps/shell` séparé. Rejeté parce que
RFC-0003 §13(c) posait explicitement cette alternative sans trancher — ce document la ferme : aucun
gain à réécrire `AppLayout`/`AppToolbar`/`AppDrawer` à l'identique dans un nouveau dossier, et cela
fragmenterait encore plus le chrome (cohérent avec l'esprit anti-fragmentation de RFC-0003 §12,
même si ce point porte sur l'architecture serveur, pas le web).

Le renommage conceptuel (« shell Reefin ») ne s'accompagne d'aucun renommage de dossier dans cette
tranche — voir §7.

### 2.2 `apps/legacy` se vide route par route — aucune réécriture big-bang

24 routes restent hébergées exclusivement par `apps/legacy` (§1), dont 19 `ViewManagerPage`
directement couplées à des contrôleurs jQuery. Une réécriture d'un coup imposerait de livrer les 24
en même temps avant tout gain utilisateur visible — contraire à la stratégie de tranches verticales
déjà actée (RFC-0001 §6.5, rappelée par RFC-0003 §9.2 et §14). Le risque de couplage caché est réel :
même une route déjà « moderne » côté table de routage peut encore déléguer à du code legacy en
interne (`/home` en est la preuve directe, voir §5) — un big-bang sous-estimerait ce genre de dette.

**Alternative rejetée** : réécriture complète en une passe. Rejetée pour la raison ci-dessus, et
parce qu'elle interdirait tout retour arrière partiel en cas de régression détectée en production.

### 2.3 `apps/dashboard` et `apps/wizard` restent des domaines bornés réutilisés tels quels

Aucun problème à résoudre : `dashboard` est déjà TS strict à ~99 % et monté indépendamment
(`DASHBOARD_APP_ROUTES`, admin uniquement) ; `wizard` est un flux d'onboarding fermé à 6 routes
(`remoteaccess`, `finish`, `library`, `settings`, `start`, `user`). Les faire absorber par le shell
modifierait leur périmètre sans bénéfice identifié.

**Alternative rejetée** : fusionner `wizard` dans `modern` pour « unifier le shell ». Rejeté — le
wizard tourne avant authentification complète (`ConnectionRequired level='wizard'`), un contexte
différent du shell utilisateur authentifié que ce document vise à faire converger.

### 2.4 `HashRouter` reste transitoirement

`createHashRouter` (§1) évite tout besoin de configuration serveur de fallback SPA — chaque route
est servie par le même document HTML quel que soit le chemin après `#`. Des URLs propres
(`BrowserRouter`, sans `#`) exigent qu'un serveur (ici le serveur Reefin lui-même, ou son reverse
proxy) réponde `index.html` sur toute route inconnue au lieu de 404 — un changement côté
infrastructure serveur, hors périmètre de ce document et de cette tranche.

**Alternative rejetée** : bascule immédiate vers `BrowserRouter`. Rejetée — casserait le rafraîchissement
de page et les liens profonds sur tout déploiement sans réécriture serveur déjà en place,
indépendamment de la qualité du travail côté web.

### 2.5 Chaque route migrée bénéficie d'une redirection pendant au moins une version

Le dépôt a déjà ce pattern en place à plusieurs endroits : la redirection d'index
(`{ index: true, element: <Navigate replace to='/home' /> }`, `apps/modern/routes/routes.tsx:19`),
la redirection `dashboard/plugins/catalog` → `/dashboard/plugins`
(`apps/dashboard/routes/routes.tsx:30-35`), et `BangRedirect` pour l'ancien format `#!/...`. Réutiliser
`<Navigate replace to='...' />` par route retirée est donc une extension mécanique d'un pattern
existant, pas une nouvelle mécanique à inventer.

**Alternative rejetée** : suppression immédiate des anciens chemins. Rejetée — casse les favoris et
liens externes existants dès la version qui migre la route.

### 2.6 Playwright est introduit avec la première tranche produit (W13.4 `/home`), pas isolément

Aucune configuration Playwright n'existe dans le dépôt à ce jour (recherche `playwright*` hors
`node_modules` : aucun résultat). RFC-0003 §9.1 note déjà ce manque (« non présent... à instrumenter »)
sans fixer de calendrier. L'attacher à la première route migrée garantit un premier test qui vérifie
un vrai parcours utilisateur (connexion → `/home` → sections visibles), plutôt qu'un scaffold
d'infrastructure sans cible réelle à tester.

**Alternative rejetée** : ticket d'infrastructure Playwright séparé, en amont. Rejeté — risque de
configuration livrée sans test qui la justifie, et sans date de mise en usage réelle.

---

## 3. Architecture cible du shell

### 3.1 Chrome existant, réutilisé tel quel

`apps/modern/AppLayout.tsx` structure déjà le chrome cible : `Box` flex colonne pleine hauteur,
`OffsetAppBar` contenant `AppToolbar` (+ `LibraryToolbar` conditionnelle si `isLibraryPath`),
`AppDrawer` conditionnel (`isDrawerPath(location.pathname) && Boolean(user) && !isMediumScreen`),
puis `AppBody` contenant l'`Outlet` des routes enfants. `ThemeCss`/`CustomCss` et `LibraryProvider`
englobent l'ensemble.

- **`AppToolbar`** (`apps/modern/components/AppToolbar/index.tsx`) : masqué sur `/video` (OSD plein
  écran), masque les boutons utilisateur (`SyncPlayButton`, `RemotePlayButton`, `SearchButton`,
  `UserViewNav`) sur les chemins publics (`PUBLIC_PATHS`), affiche `ServerButton` sinon.
- **`AppDrawer`** (`apps/modern/components/drawers/AppDrawer.tsx`) : le menu de navigation principal
  est dérivé directement de la table de routes — `MAIN_DRAWER_ROUTES = [...ASYNC_USER_ROUTES,
  ...LEGACY_USER_ROUTES].filter(r => r.path !== 'video')`. Conséquence directe : **migrer une route
  vers un composant React réel ne change rien à sa présence dans le menu** — le drawer reste correct
  automatiquement tant que le `path` ne change pas (§4).

Aucun changement de ce chrome n'est requis par ce document : il est déjà la cible.

### 3.2 Deux mécanismes de route, indépendants du shell qui les héberge

- **`toAsyncPageRoute`** (`components/router/AsyncRoute.tsx`) : `lazy()` important dynamiquement un
  module sous `apps/{dashboard,modern,legacy}/routes/<page>`, avec `AppType` déterminant le
  répertoire cible. C'est le mécanisme des vrais composants React.
- **`toViewManagerPageRoute`** (`components/router/LegacyRoute.tsx`) : rend `<ViewManagerPage
  {...pageProps} />`, qui pilote un contrôleur + une vue HTML jQuery historiques — **indépendamment
  du shell qui l'héberge**. C'est pourquoi `apps/modern` peut légitimement contenir 12 routes
  `ViewManagerPage` (§1) : le shell React habille la page, mais le contenu reste piloté par du code
  legacy.

Cette distinction est la clé de voûte de la mécanique de migration (§4).

### 3.3 États loading/error/empty

Le pattern de données établi est `@tanstack/react-query` (`useQuery`), déjà utilisé dans
`apps/modern/features/{details,syncPlay,libraries}/hooks/api/*.ts`,
`apps/dashboard/features/*/api/*.ts`, et même dans certains hooks de `apps/legacy/features/*/api/*.ts`
(ex. `useNextUp.ts`, `useLatestMedia.ts`). Chaque hook expose `isLoading`/`isError`/données —
c'est la brique de base à réutiliser. Il n'existe pas aujourd'hui de composant de squelette/état vide
partagé au niveau du chrome `AppLayout` lui-même : chaque route migrée doit encore décider
explicitement ses trois états (§4, §5) — ce document ne prescrit pas de widget générique
supplémentaire, il pose l'exigence.

### 3.4 Accessibilité et navigation clavier — préservation UX TV générique (RFC-0004)

RFC-0004 §4 a explicitement identifié et préservé, lors du retrait Tizen/webOS, un socle de navigation
clavier/manette **générique** à ne pas régresser : `KeyNames` (`scripts/keyboardNavigation.js:14-60`),
`canEnableGamepad()`, `scripts/gamepadtokey.js`, `layoutManager.tv`, et les styles `:focus-visible`
des composants `emby-*`. Ce socle est indépendant du shell (modern ou legacy) — il doit continuer à
fonctionner identiquement dans les composants React du shell moderne.

Point de vigilance propre à ce document : `LegacyLayoutModes` inclut `Tv` (§1) — **le layout TV
utilise toujours le shell legacy aujourd'hui**. Une route migrée vers `apps/modern` n'atteint donc pas
les utilisateurs TV tant qu'un shell moderne compatible 10-foot n'existe pas. C'est précisément
pourquoi le socle générique préservé par RFC-0004 §4 compte : c'est ce dont un futur shell TV moderne
aurait besoin, et rien dans la migration décrite ici ne doit le fragiliser.

---

## 4. Mécanique de migration route par route

Rappel de contrainte (§1) : le routeur choisit `MODERN_APP_ROUTES` ou `LEGACY_APP_ROUTES` en bloc via
`layoutManager.modern`, pas par URL. « Migrer une route » ne signifie donc pas un dispatch par chemin
au runtime — cette capacité n'existe pas aujourd'hui dans `RootAppRouter.tsx`. Concrètement, chaque
tranche produit qui migre une route de `legacy` vers `modern` suit cette checklist :

1. **Repérer l'entrée actuelle** dans `apps/legacy/routes/{asyncRoutes,legacyRoutes}/{user,public}.ts`
   et vérifier si une entrée jumelle existe déjà côté `apps/modern` (c'est le cas fréquent — 24 des 30
   routes de `apps/modern` ont un chemin identique côté `apps/legacy`, §1).
2. **Construire ou compléter le composant React** de la route sous `apps/modern/routes/<page>`,
   consommant les données via `ReefinApi` (`useApi().reefinApi`) et `@tanstack/react-query` (§3.3), pas
   via `jellyfin-apiclient`/contrôleurs jQuery.
3. **Basculer l'entrée modern** de `routes/legacyRoutes/{user,public}.ts` (`ViewManagerPage`) vers
   `routes/asyncRoutes/{user,public}.ts` (type `Modern`) — ou, cas particulier détaillé en §5,
   réécrire le corps d'une route déjà de type `Modern` qui délègue encore en interne à du code
   legacy.
4. **Retirer l'entrée jumelle de `apps/legacy`** une fois la version modern à parité fonctionnelle —
   c'est cette suppression qui fait réellement diminuer le compte de 24 routes hébergées par
   `apps/legacy` (§1). Tant que le layout TV reste sur le shell legacy (§3.4), une route encore
   nécessaire à ce layout ne doit pas être retirée avant qu'un shell TV moderne existe.
5. **Ajouter une redirection** (`<Navigate replace to='...' />`) pour toute forme d'URL abandonnée
   par la migration, conservée au moins une version (décision §2.5).
6. **Implémenter explicitement les trois états** loading/error/empty (§3.3) — pas de simple spinner
   silencieux ni d'absence de gestion du cas vide.
7. **Tests Vitest** sur les nouveaux hooks/composants, suivant le pattern déjà en place dans
   `apps/dashboard/features/*/api/*.test.ts` (`apps/modern` n'a aujourd'hui aucun fichier de test —
   les premiers arrivent avec la tranche qui migre `/home`, §5).
8. **Un parcours Playwright** couvrant le chemin utilisateur principal de la route migrée, ajouté
   dans la même tranche (décision §2.6) — pas en tâche séparée.
9. **Endpoints SDK migrés à l'occasion seulement** : si la route touche un endpoint déjà couvert par
   `reefin-sdk`/`ReefinApi`, l'utiliser ; sinon, laisser `@jellyfin/sdk`/`jellyfin-apiclient` en place.
   Pas de campagne de remplacement massif — `design-reefin-api-layer.md` §7 pose déjà sa propre
   stratégie progressive pour les 325 fichiers importeurs de `@jellyfin/sdk`, ce document ne la
   duplique pas.

---

## 5. Périmètre W13.4 (`/home`)

`/home` est le cas le plus instructif de la distinction posée en §3.2 : c'est déjà une route
`AppType.Modern` (`apps/modern/routes/asyncRoutes/user.ts:5`, `{ path: 'home', type: AppType.Modern }`),
rendue par `apps/modern/routes/home.tsx` — un vrai composant React. Mais ce composant ne fait que
poser le chrome de page (`Page`, onglets `emby-tabs`/`maintabsmanager`) : le peuplement réel des
onglets est délégué dynamiquement à des contrôleurs legacy —

```ts
return import(
    /* webpackChunkName: "[request]" */ `../../../apps/legacy/controllers/${depends}`
)
```

— où `depends` vaut `hometab` ou `favorites` selon l'onglet actif (`home.tsx`, fonction
`getTabController`). **`/home` est donc déjà migré au niveau de la table de routes, mais pas au
niveau du contenu.** W13.4 est en conséquence une **réécriture interne de `home.tsx`**, pas un
déplacement d'entrée de route comme la plupart des autres routes de `apps/legacy` (§4, étape 3) —
distinction à ne pas perdre en planifiant la tranche.

Périmètre exact de W13.4 :

- Remplacer le peuplement par `getTabController`/`apps/legacy/controllers/{hometab,favorites}` par
  des composants React consommant `ReefinApi` (`useApi().reefinApi`) via `@tanstack/react-query`,
  suivant le pattern déjà établi dans `apps/modern/features/libraries` (`useMovieRecommendations.ts`,
  `useAncestors.ts`).
- Conserver le chrome Reefin existant (`AppLayout`, `AppToolbar`, `AppDrawer`) sans modification —
  il est déjà correct pour `/home` (§3.1).
- Navigation accessible : remplacer la dépendance à `emby-tabs`/`maintabsmanager` (jQuery) par une
  navigation d'onglets React accessible au clavier, sans régresser le socle générique préservé par
  RFC-0004 §4 (§3.4).
- États loading/error/empty explicites pour chaque section de la page d'accueil (continuer à
  regarder, ajouts récents, favoris, etc.).
- Premiers tests Vitest de `apps/modern` (aucun fichier de test n'existe aujourd'hui dans ce
  répertoire).
- Premier parcours Playwright du dépôt : connexion → arrivée sur `/home` → sections visibles et
  navigables au clavier — première configuration Playwright et première spec livrées dans la même
  tranche (décision §2.6).
- L'entrée `/home` de `apps/legacy` (`legacyRoutes/user.ts`, contrôleur `home`/`home.html`) n'est
  **pas** retirée par cette tranche : elle reste nécessaire tant que le layout TV utilise le shell
  legacy (§3.4, §4 étape 4).

---

## 6. Hors périmètre / différé

- **Migration Vite** : séquencée après la première route migrée, pas avant. Le spike
  `spike-esbuild-loader.md` a déjà réduit le build de production à froid de ~163–167 s à ~67–76 s
  (~2,3×) sans changer d'outil (`esbuild-loader` à l'intérieur de Webpack) — marge suffisante pour ne
  pas bloquer cette tranche sur un changement d'outillage de build.
- **TypeScript 7** : risque noté par le même spike (`fork-ts-checker-webpack-plugin` dépend encore de
  l'API `Program`/`LanguageService` de `typescript`) — suivi séparé, indépendant du shell.
- **Lecteur comme machine à états** (RFC-0003 §9.3/§13(d)) : dépend de la stabilisation du protocole
  de lecture serveur au-delà du cas diagnostic-seul déjà livré. Design doc dédié, hors périmètre ici.
- **Migration WebSocket** : `ReefinApi` (`src/lib/reefin-sdk/index.ts`) n'a aujourd'hui aucun support
  WebSocket par conception — `jellyfin-apiclient`/`connectionManager.js` continue de gérer
  invalidation de cache, contrôle de lecture à distance, minuteries guide, etc. jusqu'à une migration
  dédiée.
- **URLs propres** (`BrowserRouter` sans `#`) : nécessite un fallback SPA côté serveur Reefin
  (§2.4) — hors périmètre web de cette tranche, à traiter avec l'équipe serveur.
- **Campagne de remplacement massif de `@jellyfin/sdk`** : déjà couverte par le plan progressif de
  `design-reefin-api-layer.md` §7 ; ce document ne crée pas de campagne parallèle, seulement des
  migrations d'endpoints à l'occasion (§4 étape 9).

---

## 7. Questions ouvertes

- **Nommage/renommage de `apps/modern`** : ce document tranche que le dossier ne change pas de nom
  dans cette tranche (§2.1), mais ne fixe pas si un renommage littéral (`apps/shell` ou
  `apps/reefin`) aura lieu à parité fonctionnelle atteinte, ou si « shell Reefin » reste purement
  conceptuel. À trancher quand `apps/legacy` sera suffisamment vidé pour que la question devienne
  concrète.
- **Budget Playwright en CI vs quota GitHub Actions** : RFC-0004 §7.4 documente déjà un quota GitHub
  Actions épuisé pendant W13.2, validé 100 % en local. W13.4 ajoute une première exécution E2E — reste
  à déterminer si Playwright tourne en CI dès cette tranche ou si la validation reste locale comme
  pour W13.2, en attendant une décision de budget CI plus large.
- **Dispatch par route indépendant de `layoutManager`** : ce document part du principe que « vider
  `apps/legacy` » se conclut par bascule globale du switch une fois parité atteinte (§4), sans jamais
  exiger de dispatch par URL indépendant du layout. Si un besoin de coexistence plus fine apparaît
  (ex. certaines routes modernes accessibles même en layout TV avant qu'un shell TV existe), la
  question d'un dispatch par route dans `RootAppRouter.tsx` resterait à rouvrir — non nécessaire à ce
  jour.
