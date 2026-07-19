# Design — Navigation de la Library Reefin (issue #15, arbitrage §8-C de reefin#44)

> **Statut : STRUCTURE LIVRÉE (L15a), ROUTAGE NON FAIT (L15b).** Ce document ne branche toujours
> aucune route : `appRouter.getRouteUrl()` n'est pas modifié, aucune redirection n'est ajoutée,
> aucune destination n'est montée. Ce qui a changé depuis la rédaction initiale, c'est que le
> vocabulaire et les requêtes des destinations/filtres existent et sont testés (§6), et que les
> **deux gates d'activation sont désormais disponibles** (§7) — disponibilité qui ne vaut pas
> activation.

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

**Non fait (L15b) :**

- `appRouter.getRouteUrl()` n'est pas modifié.
- Aucune redirection depuis les URL legacy.
- Aucune destination montée, aucune route `/library/:libraryId/:destination` ajoutée ; le rendu de
  `LibraryView.tsx` est inchangé (seul son commentaire d'en-tête a été corrigé).
- Rien n'est retiré du chemin par défaut : les pages legacy restent exactement où elles sont.

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

**Disponible ≠ activé.** Les deux gates étant ouverts, l'activation devient finançable — sous
réserve que les tests de la tranche d'activation passent — mais elle n'est pas effectuée ici. L15a
livre la structure (§6) ; le chemin par défaut reste intégralement le legacy jusqu'à L15b, qui monte
les destinations *avant* de repointer `getRouteUrl` (l'ordre inverse exposerait tous les points
d'entrée à une route incapable de rendre ce qu'ils demandent).
