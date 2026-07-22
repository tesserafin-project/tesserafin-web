# Design — Navigation de la Library Reefin (issue #15, arbitrage §8-C de reefin#44)

> **Statut : ACTIVÉ (L15b).** La structure livrée par L15a (§6) est désormais montée et routée :
> les quatre destinations existent sous `/library/:libraryId[/:destination]`, les contrôles de
> Browse sont câblés, `appRouter.getRouteUrl()` pointe les libraries Movies/Tvshows sur cette route,
> et les anciennes URLs `#/movies` / `#/tv` redirigent (§8). Deux cellules du tableau §3.2 ne sont
> **délibérément pas redirigées** et gardent leur page legacy — c'est documenté en §8.2, pas
> improvisé.

## 1. Le problème posé

La PR #22 a **différé** le portage de l'AlphaPicker et du mode liste, avec un argument correct :
tant que l'activation est différée, porter n'est pas finançable (15 452 o de marge à l'époque,
contre 7–8 onglets à répliquer), et rien n'est retiré du chemin par défaut puisque rien ne route
vers `/library/:libraryId`.

> **Note de mesure (post-#26, mise à jour L15a).** Le volet *budget* de cet argument a expiré : la
> marge est passée de 15 452 o à ~86 KiB (§7). Le volet *régression* — repointer `getRouteUrl()`
> vers une route sans AlphaPicker ni mode liste ni destinations — a lui aussi cessé d'être un
> argument de *report du portage* : L15a a porté cette structure (§6). Ce qu'il reste est un
> argument d'**ordonnancement**, pas de report : les destinations doivent être montées avant que
> `getRouteUrl()` ne pointe vers elles. C'est ce que L15b exécute.

Ce document ne contredit pas cette PR : il traite l'**étape d'avant l'activation** que #22 a
explicitement laissée non financée — « la vraie alternative est l'affordance opt-in décrite
ci-dessous, que personne n'a financée ». On la spécifie ici. Différer le *code* et spécifier le
*design* sont deux choses distinctes ; ce document ne fait que la seconde.

L'arbitrage ouvert du §8-C de reefin#44 est : **quelle alternative compacte aux 7–8 onglets
legacy ?** La réponse est en §3, et elle attribue un sort à **chacun** des 15 onglets legacy —
pas seulement aux quatre promus.

## 2. État legacy mesuré (source de vérité)

Relevé dans `src/apps/modern/features/libraries/constants/views/`, résolu à travers
`utils/viewContent.ts` (`{...defaultViewContent, ...viewContent}`) et `constants/views/defaults.ts`.

**Movies — 7 onglets** (`movies.ts`) : Movies, Suggestions, Favorites, Collections, Genres,
Studios, Playlists.

**TV — 8 onglets** (`tvshows.ts`) : Series, Suggestions, Upcoming, Genres, Studios, Episodes,
Collections, Playlists.

`defaults.ts` met `isAlphabetPickerEnabled: true` et `isBtnGridListEnabled: true`. Ni
`moviesTabContent` (index 0) ni `seriesTabContent` (index 0) ne les surchargent : **AlphaPicker et
bascule grille/liste sont actifs sur exactement les deux onglets que cette route reprendrait.**
C'est ce qui les rend non négociables en cible, et c'est pourquoi ils figurent au design ici
alors que #22 en a différé le code.

Surcharges notables : `Studios` désactive `isBtnGridListEnabled` et `isBtnSortEnabled` ;
`Playlists` désactive filtre, grille/liste et AlphaPicker ; `Episodes` désactive l'AlphaPicker.

## 3. Arbitrage — quatre destinations, pas sept ni huit

**Réponse : quatre destinations de premier niveau — Browse, Genres, Collections, Suggestions —
et rien d'autre. Tout le reste devient soit un filtre sur Browse, soit une étagère de
Suggestions, soit une destination hors-library.**

### 3.1 Le critère d'arbitrage

Un onglet legacy mérite une destination de premier niveau si et seulement si :

1. il change la **nature de l'objet listé** (une collection n'est pas un film ; un genre est un
   agrégat, pas un item), **et**
2. il n'est pas exprimable comme un **prédicat sur la requête** que Browse émet déjà
   (`getItems` avec `parentId`/`includeItemTypes`/tri/filtres).

Le critère 2 est le discriminant utile : `Favorites` = `isFavorite: true`, `Studios` =
`studioIds: [...]`. Ce sont des **paramètres de `getItems`**, pas des vues. Les promouvoir en
onglets, c'est facturer un niveau de navigation pour ce qu'un filtre exprime en un clic — et
c'est précisément ce qui produit sept onglets pour un seul type d'objet.

### 3.2 Sort de chacun des 15 onglets legacy

| Onglet legacy | Lib | Sort | Raison |
|---|---|---|---|
| Movies / Series | M / TV | **Browse** (destination) | La liste canonique. Grille/liste + AlphaPicker + tri + filtres. |
| Genres | M + TV | **Genres** (destination) | Agrégat, pas un item : liste de genres → chacun ouvre Browse pré-filtré. Critère 1 + 2 remplis. |
| Collections | M + TV | **Collections** (destination) | `BaseItemKind.BoxSet` — objet d'une **autre nature** que `Movie`/`Series`. Critère 1 rempli, 2 aussi (type d'item différent, pas un prédicat). |
| Suggestions | M + TV | **Suggestions** (destination) | Éditorialisé (`sectionsView`), non exprimable comme requête unique. Absorbe Upcoming et Next Up. |
| **Studios** | M + TV | **Filtre sur Browse** | `studioIds` est un paramètre de requête. **Reste un filtre, pas une destination.** Confirmé par le legacy lui-même, qui y désactive déjà grille/liste et tri : ce n'était déjà pas une vraie liste. |
| **Favorites** | M | **Filtre sur Browse** (`?favorite=1`) | `isFavorite: true` est un prédicat pur. Un onglet dédié duplique Browse à un booléen près. Le favori reste par ailleurs accessible globalement hors library. |
| **Upcoming** | TV | **Étagère dans Suggestions** | Déjà éditorialisé (`upcomingTabContent` n'a aucun `itemType` : c'est une vue de sections). Sa place naturelle est parmi les sections de Suggestions, pas un onglet à part. |
| **Episodes** | TV | **Bascule de granularité dans Browse** | Même parent, même requête, `includeItemTypes: [Episode]` au lieu de `[Series]`. Le legacy y désactive déjà l'AlphaPicker — signe que ce n'est pas une liste alphabétique mais une profondeur. Exposé comme sélecteur Séries/Épisodes dans la barre de Browse. |
| **Playlists** | M + TV | **Hors library** | Une playlist n'appartient à aucune library : elle traverse les libraries. La lister sous « Films » est une erreur de modèle du legacy. Reste sur sa page existante, inchangée. |

Total : 4 destinations + 3 filtres/bascules absorbés par Browse + 1 étagère + 1 sortie de
périmètre. **Aucun onglet legacy n'est perdu sans destination nommée.**

### 3.3 Pourquoi pas les alternatives

- **Garder 7–8 onglets** : c'est le statu quo qu'on cherche à remplacer. Sur mobile la barre
  déborde et devient un carrousel horizontal — la navigation devient elle-même une liste à
  parcourir.
- **Un seul écran avec tout en filtres** : perd Collections (autre type d'objet) et Suggestions
  (éditorial). Le critère 1 existe pour ça.
- **Menu « Plus » débordant** : reporte le problème sans le trancher, et cache exactement les
  entrées rares que le tableau ci-dessus supprime ou transforme.

## 4. Browse — AlphaPicker et bascule grille/liste

Les deux sont **portés**, pas abandonnés : §2 démontre qu'ils sont actifs sur les onglets repris.

### 4.1 AlphaPicker

- Émet `nameStartsWith` sur `getItems`, sérialisé en query param `letter`.
- Actif uniquement quand le tri est `SortName` — un AlphaPicker sur un tri par date est un
  contrôle mensonger. Sur tout autre tri il est désactivé (`aria-disabled`), pas masqué : le
  masquer ferait sauter la mise en page à chaque changement de tri.
- Neutralisé quand la granularité est `Episodes` (aligné sur `episodesTabContent`, qui met déjà
  `isAlphabetPickerEnabled: false`).
- `#` groupe les entrées non alphabétiques ; la sélection est exclusive et remet `page` à 1.

### 4.2 Bascule grille/liste

- `view=grid|list`, persistée par library dans `localStorage`, exactement le mécanisme déjà
  employé par `utils/density.ts` (URL prioritaire sur le stockage, puis défaut `grid`).
- **Orthogonale à la densité** : `density` (comfortable/compact) reste ce qu'elle est en grille.
  En liste, la densité pilote la hauteur de ligne. Les deux ne fusionnent pas — c'est ce qui
  permet quatre combinaisons au lieu de trois modes ad hoc.
- Désactivée là où le legacy la désactive (Collections en vue Studios, Playlists) — sans objet
  ici puisque ces deux-là ne sont pas dans Browse.

## 5. Forme de la navigation

`src/ui` fournit déjà `Tabs` (`src/ui/index.ts`). Quatre destinations tiennent dans une barre
`Tabs` sans débordement, y compris en 360 px : c'est la raison chiffrée du choix de quatre.

- La destination est un **segment de route** (`/library/:libraryId/genres`), pas un état local :
  partageable, rechargeable, et le bouton retour du navigateur fait ce qu'on attend.
- Browse est la destination par défaut et rend `/library/:libraryId` (pas de redirection vers
  `/browse` : l'URL courte est canonique).
- Les filtres (Studios, Favorites) et la granularité (Séries/Épisodes) vivent dans la barre de
  contrôles de Browse, à côté du tri et des filtres genre/année déjà présents dans `LibraryView`.

## 6. Ce que L15a livre, et ce qu'il ne fait pas

**Livré (L15a) — structure, testée, non routée :**

- `constants/librarySections.ts` : les quatre destinations, le sort des 15 onglets legacy,
  l'AlphaPicker (`#` → `nameLessThan: 'A'`, actif sous `SortName` hors Episodes, remise à la page 1
  à chaque changement de lettre), le mode grille/liste par library, la granularité Séries/Épisodes,
  les paramètres des filtres Studios/Favorites, et les étagères de Suggestions (Upcoming inclus).
- `api/libraryDestinationQueries.ts` : Genres, Collections, la liste d'options du filtre Studios, et
  l'étagère Upcoming — chacun émettant sa vraie requête Reefin SDK.
- `api/useLibraryItems.ts` : `studioIds`, `isFavorite` et `letter` sur la requête Browse.

Chaque destination et chaque filtre est **prouvé par test sur l'URL réellement émise**, pas par
lecture du source. Aucun import `@jellyfin/sdk` n'apparaît dans cette tranche.

**Fait par L15b (§8) :** tout ce que cette liste annonçait comme non fait.

**Coût bundle.** La formulation initiale — « `librarySections.ts` n'est importé que par son test,
donc 0 octet » — n'est plus exacte : `useLibraryItems.ts` l'importe désormais. Le coût sur le bundle
principal reste néanmoins **nul**, pour une raison différente et plus solide : la route
`library/:libraryId` est déclarée dans `asyncRoutes/user.ts` et chargée par `AsyncRoute.tsx` en
`lazy: () => import(...)`. Toute cette tranche vit donc dans un chunk asynchrone, hors de
`main.jellyfin.bundle.js`. La mesure figure au rapport de la PR.

## 7. Conditions d'activation — les deux gates sont désormais disponibles

L'activation — repointage de `getRouteUrl`, redirections, montage des quatre destinations — exige
**les deux** conditions, pas l'une ou l'autre. Toutes deux étaient fermées à la rédaction initiale ;
elles ne le sont plus :

1. **LANE B — marge bundle : acquise.** Le seuil de 30 KiB est franchi avec une large réserve
   (marge mesurée sur `main` : 85 860 o, soit 83,85 KiB, pour un bundle principal de 374 940 o et un
   plafond de 460 800 o). Les leviers conjonctifs de reefin#44 §4 (deux ancres eager) n'ont plus à
   être traités par une tranche d'activation.
2. **LANE E2E — rig croisé : existant.** reefin#39 (harnais serveur TCP) **est fusionnée**, donc le
   gate croisé existe. La contrainte de fond subsiste et n'est pas levée par la fusion :
   `playwright.config.ts` n'a délibérément pas de `webServer` et exige un serveur réel, et aucune
   route nouvelle ne doit devenir atteignable par défaut sans spec e2e couvrant la navigation réelle
   depuis `/home` et les redirections. Ce que #39 change, c'est qu'écrire cette spec est maintenant
   possible ; l'écrire reste à faire, dans L15b.

**Disponible ≠ activé.** Les deux gates étant ouverts, l'activation est devenue finançable, et L15b
l'a exécutée dans l'ordre que cette section imposait : monter les destinations *avant* de repointer
`getRouteUrl` (l'ordre inverse exposerait tous les points d'entrée à une route incapable de rendre
ce qu'ils demandent).

## 8. Ce que L15b active

### 8.1 Le repointage et la forme des URLs

`appRouter.getRouteUrl()` et l'adaptateur de cartes de `/home` lisent tous deux la même règle,
extraite dans `src/constants/libraryRoute.ts` — ce qui retire la duplication
`LIBRARY_ROUTE_BY_COLLECTION_TYPE` que le TODO de `LibraryView.tsx` signalait. Les deux modules ne
peuvent pas s'importer l'un l'autre (risque d'import circulaire vers `routes/home.tsx`), mais ils
peuvent dépendre d'une feuille commune : `/home` et le drawer ne peuvent donc plus diverger.

- `#/library/:libraryId` = Browse, l'URL courte est canonique. `/browse` et tout segment inconnu y
  reviennent en `replace`, query string conservée.
- `#/library/:libraryId/{genres,collections,suggestions}` = segments partageables.
- `section: 'latest'` (les étagères « Récemment ajouté » de `/home`) nomme désormais `suggestions`,
  là où ces étagères vivent — le sens du lien est reporté, pas perdu.

### 8.2 Table des anciennes URLs

Toutes les entrées ci-dessous étaient réellement émises par `getRouteUrl()`. Les index d'onglet
viennent de `constants/views/movies.ts` et `constants/views/tvshows.ts`.

| Ancienne URL | Destination | Params conservés |
|---|---|---|
| `#/movies?topParentId=X` (ou `&tab=0`) | `/library/X` | tous les params compatibles |
| `#/movies?topParentId=X&tab=1` | `/library/X/suggestions` | idem |
| `#/movies?topParentId=X&tab=2` (Favorites) | `/library/X?favorite=1` | idem |
| `#/movies?topParentId=X&tab=3` | `/library/X/collections` | idem |
| `#/movies?topParentId=X&tab=4` | `/library/X/genres` | idem |
| `#/movies?topParentId=X&tab=5` (Studios) | **aucune** — page legacy conservée | — |
| `#/movies?topParentId=X&tab=6` (Playlists) | **aucune** — page legacy conservée | — |
| `#/tv?topParentId=X` (ou `&tab=0`) | `/library/X` | tous les params compatibles |
| `#/tv?topParentId=X&tab=1` | `/library/X/suggestions` | idem |
| `#/tv?topParentId=X&tab=2` (Upcoming) | `/library/X/suggestions` | idem |
| `#/tv?topParentId=X&tab=3` | `/library/X/genres` | idem |
| `#/tv?topParentId=X&tab=4` (Studios) | **aucune** — page legacy conservée | — |
| `#/tv?topParentId=X&tab=5` (Episodes) | `/library/X?granularity=episodes` | idem |
| `#/tv?topParentId=X&tab=6` | `/library/X/collections` | idem |
| `#/tv?topParentId=X&tab=7` (Playlists) | **aucune** — page legacy conservée | — |

« Params compatibles » = `sort`, `order`, `page`, `genre`, `year`, `density`, `view`, `letter`,
`granularity`, `favorite`, `studio`. `topParentId`, `collectionType` et `tab` sont *consommés* par
la redirection (l'un devient le segment de chemin, l'autre la destination) et ne sont donc pas
reportés.

**Les deux cellules sans redirection — arrêt documenté, pas improvisation.**

- **Studios.** L'onglet legacy est une *grille de studios parcourable* ; le §3.2 fait de Studios un
  filtre `studioIds` sur Browse. Une URL Studios nue ne nomme aucun studio : il n'existe pas d'id à
  mettre dans `?studio=`. La rediriger vers Browse répondrait silencieusement « voici tous vos
  films » à la question « montre-moi les studios » — l'URL résoudrait, son *sens* aurait disparu.
- **Playlists.** Le §3.2 dit « hors library … reste sur sa page existante, **inchangée** ». La page
  existante de l'onglet Playlists d'une library *est* cette URL legacy.

Dans les deux cas l'URL continue de rendre sa page legacy. Le filtre Studios, lui, est bien présent
dans la barre de Browse : c'est la *destination* du §3.2 qui est livrée, ce qui manque est
seulement la traduction d'une URL sans id.

### 8.3 Absence de boucle — argument structurel

Deux directions coexistent désormais :

```
ENTRÉE  #/movies, #/tv           → /library/:libraryId   (legacyLibraryRedirect.ts)
SORTIE  /library/:libraryId      → page par type          (libraryRedirect.ts)
```

Une boucle exigerait qu'un même `CollectionType` soit dans les deux ensembles. C'est impossible par
construction : l'entrée n'est prise que pour les deux types que `isSupportedLibraryCollectionType`
accepte — exactement ceux que `LibraryView` *rend*, donc pour lesquels la sortie n'est jamais
atteinte — et la sortie ne vise que des pages que l'entrée ne surveille pas. Les deux moitiés sont
assertées sur *tous* les `CollectionType` de l'enum (`libraryRedirect.test.ts`,
`legacyLibraryRedirect.test.ts`, `constants/libraryRoute.test.ts`), pas laissées à l'inspection.

### 8.4 Library inexistante et accès refusé

Les deux endpoints utilisés ne répondent pas pareil, et c'est mesuré côté serveur :

- `GET /Items/{itemId}` (`UserLibraryController.GetItem`) résout via
  `GetItemById<BaseItem>(itemId, user)` — la surcharge filtrée par utilisateur — et renvoie `404`
  quand elle est nulle. Une library non visible est donc **indiscernable** d'une library inexistante
  à cet endpoint : les deux sont 404. C'est un choix serveur délibéré et aucun code client ne peut
  le contourner.
- `GET /Items` (`ItemsController`) distingue : `!item.IsVisible(user)` renvoie `401` avec un message
  explicite. C'est le chemin sur lequel l'état « accès refusé » est réellement atteignable.

Les deux états sont terminaux et n'offrent aucun bouton « réessayer » — proposer de réessayer une
library supprimée ou une permission absente promettrait ce que le bouton ne peut pas tenir.
