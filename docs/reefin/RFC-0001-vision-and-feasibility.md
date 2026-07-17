# RFC-0001 — Vision et faisabilité de Reefin Web

- **Statut** : Accepted
- **Date** : 2026-07-16
- **Auteur** : Reefin Team
- **Dépôt** : `reefin-web` (fork de `jellyfin-web`)
- **Relation** : compagnon web du serveur `reefin` (fork de Jellyfin Server). Voir notamment `docs/pr91-rfc-playback-decision-v2.md` et `docs/pr92-design-playback-api-and-diagnostics.md` côté serveur pour le contrat de lecture v2 dont ce RFC dépend en phase 3.
- **Note de suivi (W13.1, 2026-07-16)** : `RFC-0003-product-rupture.md` est le **successeur** de ce
  document sur les points qu'il précise, tranche ou étend explicitement — en premier lieu **§4
  (frontière core/plugins)** : RFC-0003 §9 point 12 confirme le tracé de RFC-0001 §4 terme à terme
  (pas de réinvention) et y ajoute deux entrées non couvertes ici (« sauvegardes » côté core,
  « domotique » côté extension), à reporter dans une prochaine révision de §4 plutôt que laissées en
  divergence tacite entre les deux documents. RFC-0003 tranche aussi explicitement **§9 Q3/Q4**
  (nature du nouveau shell et des nouvelles routes, laissées ouvertes ici) — voir RFC-0003 §1.1.
  RFC-0001 reste la référence pour la vision produit (§2), la politique de breaking changes (§3,
  dont RFC-0003 §2 précise l'application plutôt qu'il ne la remplace) et la stratégie de tranches
  verticales (§6.5) : RFC-0003 ne s'y substitue pas, il les applique à un plan concret plus large que
  celui anticipé en §9 au moment de la rédaction de ce document.

---

## 1. Contexte et motivation

### 1.1 Un fork tout frais, une divergence assumée

`reefin-web` est un fork récent de `jellyfin-web` (`master`, HEAD actuel autour de `601bd46245`). Le dépôt n'a pas encore divergé en profondeur : aucun renommage, aucune restructuration, `package.json` porte toujours `"name": "jellyfin-web"`. C'est le meilleur moment pour poser une trajectoire explicite plutôt que de laisser la divergence se faire par accumulation de patches locaux.

Ce dépôt est le client officiel de **Reefin**, un fork serveur de Jellyfin qui a déjà entamé des changements de rupture assumés (namespaces renommés `Reefin.*`, refonte en cours du domaine de décision de lecture — voir §1.3). Reefin Web doit suivre la même logique : ce n'est pas un « Jellyfin Web avec un thème différent », c'est le client d'un produit qui va diverger intentionnellement sur l'architecture, l'UX et certains contrats réseau.

### 1.2 État réel du code : un dépôt à deux vitesses

Un inventaire du répertoire `src/` confirme un dépôt hybride, pas un dépôt legacy pur :

```
src/
  apps/
    modern/      114 fichiers TS/TSX (37 .ts, 77 .tsx) — React moderne
    dashboard/   181 fichiers (90 .ts, 89 .tsx, 2 .js résiduels) — React moderne, quasi 100% TS/TSX
    legacy/       93 fichiers (40 .js, 42 .ts, 11 .tsx) — mixte, majorité JS/contrôleurs
    wizard/       React/TS, périmètre restreint (onboarding serveur)
  components/     293 fichiers, dont 97 .js (legacy jQuery/vanilla-ish), 85 .tsx, 29 .ts
  elements/        51 fichiers, essentiellement web components legacy (emby-*)
  lib/            legacy/, jellyfin-apiclient/, navdrawer/, scroller/, globalize/
  plugins/        14 plugins (players, screensavers, syncPlay...), mélange JS/TS
```

Chiffres globaux sur l'arbre : 313 `.ts`, 287 `.tsx`, 245 `.js`, 1 `.jsx`. Le legacy JS n'est donc pas résiduel — il pèse encore lourd, concentré dans trois zones : `src/components/`, `src/elements/`, `src/apps/legacy/controllers/`.

**Point chaud principal** : `src/components/playback/playbackmanager.js`, **4342 lignes**, sans typage, cœur de toute la logique de lecture côté client (sélection de flux, gestion des sessions, synchronisation avec le serveur). Il est importé par **63 fichiers** dans tout l'arbre, dont **12 composants React modernes** dans `src/apps/modern/` (boutons de lecture, menus de contrôle à distance, barre d'outils de bibliothèque). Autrement dit : le code React « moderne » d'aujourd'hui n'est pas découplé du monolithe legacy, il l'importe directement. D'autres points chauds legacy significatifs : `src/apps/legacy/controllers/itemDetails/index.js` (2196 lignes), `src/apps/legacy/controllers/playback/video/index.js` (2065 lignes), `src/components/cardbuilder/cardBuilder.js` (1269 lignes), `src/components/guide/guide.js` (1203 lignes).

**Ce qui existe déjà et sur quoi s'appuyer** : `src/apps/dashboard` est un précédent concret et réussi de réécriture verticale — app React/TypeScript quasi entièrement typée, routée indépendamment (`DASHBOARD_APP_ROUTES` dans `src/RootAppRouter.tsx`), qui cohabite avec le reste sans big-bang. Le routeur racine (`react-router-dom` v6, `createHashRouter`) bascule déjà entre `MODERN_APP_ROUTES` et `LEGACY_APP_ROUTES` selon `layoutManager.modern`, plus `WIZARD_APP_ROUTES` et `DASHBOARD_APP_ROUTES` toujours actifs. La mécanique de cohabitation multi-app existe donc déjà dans le shell actuel — ce RFC ne l'invente pas, il en généralise le principe.

### 1.3 Alignement serveur : la lecture devient un contrat versionné et diagnosticable

Côté serveur, `docs/pr91-rfc-playback-decision-v2.md` (PR91) et `docs/pr92-design-playback-api-and-diagnostics.md` (PR92) du dépôt `reefin` posent les fondations suivantes, structurantes pour ce RFC :

- Le domaine de décision de lecture (`Reefin.Playback.Decision`) devient indépendant du modèle DLNA (`DeviceProfile`/`MediaOptions`/`StreamInfo` ne fuient plus dans le contrat public).
- La réponse client devient une **décision versionnée** (`PlaybackSessionResponse` : méthode, sortie, streams sélectionnés, raisons résumées) — sans détails internes (chemins, secrets, arguments ffmpeg).
- Une route admin séparée, `/System/PlaybackDiagnostics/Sessions`, expose un **détail diagnostic complet et filtré** (trace de raisonnement arborescente `ReasonNode`, timeline, comparaison legacy/v2 en shadow mode).
- Le tout est explicitement **conçu côté serveur, implémenté côté web** : PR92 le dit noir sur blanc, « L'implémentation UI appartient au dépôt web, pas à ce serveur » (PR114 dans la numérotation serveur).

Reefin Web hérite donc d'un engagement concret avant même ce RFC : construire l'assistant de configuration et l'UI de diagnostic de lecture sur ce contrat, pas sur `playbackmanager.js` en l'état. C'est un des ancrages de la roadmap (§7, phase 2/3).

---

## 2. Vision produit

Reefin Web poursuit trois piliers, tous motivés par le constat du §1 : un legacy lourd et peu accessible, une configuration matérielle qui reste une source de friction majeure pour les utilisateurs de Jellyfin, et un écosystème de plugins qui fragmente des besoins qui devraient être des acquis du produit.

### Pilier 1 — Interface entièrement modernisée

Design system Reefin propre, navigation et information architecture repensées (pas une simple recoloration), responsive réel desktop/mobile/TV, accessibilité et navigation clavier/télécommande pensées **dès la conception** des composants (pas ajoutées après coup comme c'est souvent le cas dans `src/elements/emby-*`). Disparition progressive du legacy JS, pas maintien indéfini en parallèle.

**Stratégie** : réécriture par **tranches verticales** (une fonctionnalité complète de bout en bout à la fois) dans un nouveau shell React/TypeScript, jamais de big bang. `playbackmanager.js` est **encapsulé temporairement** derrière une interface stable pendant la transition (voir §6), pas réécrit d'un coup — vu son rayonnement (63 importeurs), une réécriture non incrémentale serait le point de rupture le plus probable du projet.

### Pilier 2 — Configuration guidée

Détection matériel/pilotes, tests réels de transcodage (pas une simple liste de codecs déclarés), sélection automatique de l'accélération matérielle, diagnostic compréhensible par un non-expert, repli logiciel automatique en cas d'échec, et un mode Expert avec overrides manuels pour les utilisateurs avancés.

Le gros du travail est **côté serveur** (détection, bancs d'essai de transcodage, moteur de décision v2 — cf. §1.3) ; **reefin-web fournit l'assistant guidé, l'affichage des résultats et les contrôles**, pas la logique de détection elle-même. Ce pilier correspond directement à la demande « Automatically test hardware transcoding », actuellement **Planned** sur `features.jellyfin.org` (most-wanted) — Reefin en fait un pilier produit plutôt qu'un vœu pieux du backlog.

### Pilier 3 — Intégration intelligente des fonctions pluginifiées

Principe directeur : **contrat fonctionnel au core, fournisseurs externes en plugins.**

**À intégrer au core** (ce qui touche le parcours quotidien, la sécurité, la cohérence UX multi-clients, ou qui nécessite un modèle serveur stable pour bien fonctionner) : intros/crédits, diagnostics de lecture, pré-transcodage, watchlist, historique de visionnage, collections intelligentes, OIDC/2FA.

**À garder en extensions** : fournisseurs de métadonnées spécifiques, intégrations tierces (Trakt et assimilés), notifications/webhooks, catalogues spécialisés. Ces briques n'ont pas besoin d'un contrat serveur stable et bénéficient au contraire de rester interchangeables.

---

## 3. Politique de breaking changes

Un breaking change (rupture de compatibilité côté client, d'API, ou de comportement attendu par l'utilisateur) est acceptable **si et seulement si** il remplit au moins un des trois critères suivants :

1. **Il supprime de l'architecture héritée** — dette technique, couplage DLNA, code non typé au cœur du produit, patterns qui bloquent l'évolution future.
2. **Il simplifie réellement l'expérience** — pas une simplification cosmétique, une réduction mesurable de la charge cognitive ou du nombre d'étapes pour l'utilisateur.
3. **Il permet une fonctionnalité importante** qui serait impossible ou déraisonnablement coûteuse à livrer en préservant la compatibilité actuelle.

**Processus** : tout breaking change doit être **documenté dans un RFC** avant implémentation — dans `docs/reefin/` côté web, en miroir de la pratique déjà en place côté serveur (`docs/pr9x-*.md`, `docs/rfc-di-*.md`). Le RFC doit nommer explicitement le(s) critère(s) invoqué(s) parmi les trois ci-dessus. Un changement qui ne remplit aucun des trois critères reste, par défaut, un changement à faire sans casser la compatibilité — ou à ne pas faire.

---

## 4. Frontière core/plugins

Le critère n'est pas « est-ce que Jellyfin le fait déjà en plugin » mais **est-ce que la fonctionnalité a besoin d'un modèle serveur stable, touche à la sécurité, ou fait partie du parcours quotidien de tous les utilisateurs**.

| Reste ou entre au **core** | Reste en **extension** |
| --- | --- |
| Parcours quotidien (accueil, watchlist, historique, continuer à regarder) | Fournisseurs de métadonnées spécifiques (niche, régionaux) |
| Sécurité / authentification (OIDC, 2FA) | Intégrations tierces de suivi (Trakt et assimilés) |
| UX cohérente à travers les clients (web, TV, mobile) | Notifications / webhooks |
| Traitements qui exigent un modèle serveur stable (intros/crédits, diagnostics de lecture, pré-transcodage) | Catalogues spécialisés |
| Collections intelligentes | — |
| Fiabilité et diagnosticabilité du **workflow** d'identification métadonnées (retry, repli entre fournisseurs, ré-identification/correction manuelle traçable) | Les fournisseurs de métadonnées eux-mêmes (IMDb, TMDb, OMDb, MusicBrainz...) et leurs spécificités |

Ce n'est pas une frontière figée : une extension qui devient un besoin universel (comme watchlist ou 2FA le sont déjà) migre vers le core via RFC, jamais silencieusement.

La dernière ligne mérite d'être explicitée car elle sépare deux choses qu'on confond facilement : **quel fournisseur répond** (IMDb vs TMDb vs un fournisseur régional/niche) reste une question de plugin, comme le reste déjà cette frontière — mais **ce qui se passe quand ce fournisseur échoue, répond mal, ou qu'un item est mal identifié** (l'auto-titrage) touche directement le parcours quotidien de tous les utilisateurs (une bibliothèque mal titrée est visible en permanence, pas seulement en admin) et bénéficie d'un contrat serveur stable pour être diagnosticable — donc core, au même titre que les diagnostics de lecture (§1.3, §7 phase 2/3). Voir §5 et §9 pour l'état des lieux et les questions ouvertes associées.

---

## 5. Faisabilité des demandes populaires

Le backlog `features.jellyfin.org` most-wanted est traité comme un **réservoir d'opportunités à trier**, pas un classement d'exécution — l'ordre de la liste communautaire ne dicte pas la roadmap Reefin.

| Demande | Portée Reefin | Faisabilité |
| --- | --- | --- |
| Retirer de « Continuer à regarder » | serveur + web | Facile, excellent premier gain UX |
| Watchlist | modèle serveur + tous clients | Moyenne, très prioritaire |
| Lazy loading bibliothèques | API paginée + web | Moyenne |
| OIDC/OAuth SSO | auth serveur + login web/TV | Moyenne à élevée |
| 2FA | sécurité serveur + clients | Élevée, nécessite récupération et device flow |
| Pré-transcodage | scheduler, stockage, moteur playback, UI | Élevée mais très cohérente avec Reefin |
| Historique de visionnage | journal serveur + UX | Moyenne |
| Smart playlists | moteur de règles + recherche + UI | Moyenne |
| Partage temporaire | jetons limités auditables + UI | Moyenne, vigilance sécurité |
| Gapless audio | lecteur web + pipeline serveur | Moyenne |
| Livres audio/podcasts | nouveau domaine média complet | Élevée |
| Offline/transcoded downloads | jobs serveur + protocole sync + clients natifs | Très élevée |
| MySQL/MariaDB | persistance serveur | Très élevée, pas forcément stratégique |
| Auto-titrage/identification métadonnées plus robuste et corrigible (IMDb, TMDb, OMDb...) | serveur (retry, repli entre fournisseurs) + web (diagnostic d'échec, ré-identification/correction) | Moyenne — le pipeline (`Reefin.Providers/Manager/ProviderManager.cs`, `ItemLookupController`) est déjà en place côté serveur (stock Jellyfin, seulement renommé), avec un ordre de fournisseurs configurable mais **aucun retry ni repli automatique** ; c'est un ajout ciblé au pipeline existant, pas une réécriture |

**Hors périmètre de reefin-web** : les clients Android, Swiftfin, AppleTV, Tizen, Vidaa ne sont pas maintenus dans ce dépôt. Reefin fournira les APIs et protocoles nécessaires (auth, sync offline, diagnostics) ; leur consommation par ces clients tiers/natifs est de leur ressort.

---

## 6. Architecture cible web

### 6.1 Principe : un nouveau shell React/TypeScript, pas une réécriture du shell existant

Le shell actuel (`src/RootAppRouter.tsx`, `createHashRouter`, bascule `layoutManager.modern` entre `MODERN_APP_ROUTES`/`LEGACY_APP_ROUTES`, plus `DASHBOARD_APP_ROUTES` et `WIZARD_APP_ROUTES` toujours actifs) fait déjà cohabiter plusieurs sous-apps React indépendantes. C'est le mécanisme qu'on généralise, pas qu'on remplace : le « nouveau shell Reefin » est une évolution de ce routeur, avec à terme un seul jeu de routes actives plutôt qu'une bascule modern/legacy.

### 6.2 Ce qui correspond au legacy à encapsuler

Correspondance concrète entre le constat du §1.2 et le traitement à appliquer :

- **`src/components/playback/playbackmanager.js`** (4342 lignes, 63 importeurs dont 12 dans `src/apps/modern/`) : cible n°1 d'encapsulation. Ne pas réécrire en bloc. Objectif intermédiaire : définir une interface TypeScript stable (`PlaybackService` ou équivalent) qui expose les opérations réellement consommées par le code moderne (lecture, pause, sélection de flux, état de session) sans exposer l'implémentation interne. Les 12 composants `apps/modern/` qui l'importent aujourd'hui directement migrent vers cette interface en premier — c'est le test de validité de l'encapsulation.
- **`src/apps/legacy/`** (93 fichiers, mixte JS/TS/TSX, contrôleurs de type `itemDetails/index.js` à 2196 lignes et `playback/video/index.js` à 2065 lignes) : périmètre de remplacement direct par tranches verticales — chaque contrôleur legacy correspond à une route/fonctionnalité qui devient une feature `apps/modern` (ou son successeur) quand son tour vient dans la roadmap (§7, phase 4+).
- **`src/components/`** (293 fichiers, 97 `.js`) et **`src/elements/`** (51 fichiers, web components `emby-*`) : legacy transverse, consommé aussi bien par `apps/legacy` que par des points d'intégration dans `apps/modern`/`apps/dashboard`. Traitement au cas par cas au fil des tranches verticales — un composant n'est réécrit que quand une tranche le traverse, pas en campagne dédiée séparée.
- **`src/lib/legacy/`** : déjà nommé comme tel dans l'arborescence actuelle — périmètre explicitement marqué pour extinction progressive.

### 6.3 Ce qui est déjà du socle moderne à réutiliser

- **`src/apps/dashboard`** (181 fichiers, ~99% TS/TSX) : la preuve que le pattern « app React/TS isolée, routée séparément, cohabitant avec le legacy » fonctionne dans ce dépôt. Sert de référence directe de structure (organisation `components/constants/controllers/features/routes`) pour les nouvelles tranches.
- **`src/apps/modern`** (114 fichiers, 100% TS/TSX) : le socle de la future interface principale. C'est là que vivent déjà les tranches verticales en cours (détails d'item, bibliothèques, barre d'outils) — mais avec la dépendance directe à `playbackmanager.js` identifiée en §6.2 comme dette à résorber en priorité.
- **`src/apps/wizard`** : périmètre restreint (onboarding), à faire évoluer en cohérence avec le pilier 2 (configuration guidée) plutôt qu'à traiter comme legacy.

### 6.4 Couche API Reefin typée

Une couche cliente typée dédiée (distincte de `src/lib/jellyfin-apiclient/` hérité) doit envelopper les nouveaux contrats serveur au fur et à mesure de leur stabilisation — en particulier les DTO de PR92 (`PlaybackSessionResponse`, `PlaybackDiagnosticDetail`) dès qu'ils sont implémentés côté serveur (PR112/PR113). Cette couche est générée ou maintenue en cohérence avec les schémas OpenAPI exposés par `reefin` (voir §7, phase 2 et §8) plutôt que retapée à la main à partir de la doc.

### 6.5 Stratégie de tranches verticales

Chaque tranche livre une fonctionnalité complète (UI + intégration API + tests) plutôt qu'une couche technique isolée. Ordre guidé par la roadmap (§7) : configuration/diagnostics avant confort quotidien, confort quotidien avant fonctions avancées. Une tranche ne « touche » le legacy que par encapsulation (interfaces stables comme en §6.2), jamais par modification opportuniste non planifiée du code legacy qu'elle traverse.

---

## 7. Roadmap

1. **Vision produit et architecture** — ce RFC : design system, principes de navigation, politique de breaking changes, frontière core/plugins, matrice de faisabilité des fonctionnalités. Prérequis à tout code de tranche verticale.
2. **Fondations du fork** — shell React/TypeScript cible (évolution du routeur existant, §6.1), couche API Reefin typée (§6.4), tests de contrats OpenAPI contre le serveur `reefin`, rebranding (nom de paquet, identité visuelle, retrait des références Jellyfin non pertinentes), mise en place d'une politique de synchronisation contrôlée avec l'upstream (§8). Jalons concrets de cette phase :
   - rebranding minimal du dépôt (`package.json`, manifest, identité visuelle de base) ;
   - premier client de la couche API typée sur les DTO stables de PR91/PR92 dès leur disponibilité serveur (PR112) ;
   - page de diagnostics de lecture côté admin, alignée sur le contrat `PlaybackDiagnosticDetail` de PR92 (`/System/PlaybackDiagnostics/Sessions`) — premier cas d'usage concret de la couche API et premier écran qui n'a **aucune** dépendance à `playbackmanager.js`.
3. **Administration simplifiée** — onboarding (`apps/wizard`), gestion des bibliothèques et des utilisateurs, diagnostics de lecture (suite de la phase 2), sélection automatique de l'accélération matérielle (pilier 2), **fiabilisation et diagnosticabilité de l'auto-titrage métadonnées** : côté serveur, retry et repli entre fournisseurs configurés dans `Reefin.Providers/Manager/ProviderManager.cs` (aujourd'hui : ordre configurable mais un échec de fournisseur est seulement loggué, jamais retenté ni basculé automatiquement) ; côté web, écran de diagnostic des échecs d'identification et intégration de la ré-identification/correction manuelle (`ItemLookupController`, dialogue « Identify » déjà existant dans `src/components/itemidentifier/`) au nouveau shell — même logique que les diagnostics de lecture (§1.3) : le serveur reste la source de vérité et fait le gros du travail, le web expose et rend l'erreur corrigible sans devoir passer par du support/du bricolage manuel en base.
4. **Expérience quotidienne** — accueil, watchlist, continuer à regarder (avec retrait manuel), historique de visionnage, recherche, filtres, lazy loading des bibliothèques, lecteur modernisé (première tranche qui attaque sérieusement l'encapsulation de `playbackmanager.js`, §6.2).
5. **Fonctions intégrées** — OIDC/2FA, smart playlists, intros/crédits, partage temporaire, pré-transcodage, téléchargements optimisés.
6. **Protocoles multi-clients** — synchronisation offline, capacités mobiles/TV. Reefin Web ne réécrit pas les clients tiers mais stabilise ici les protocoles qu'ils consommeront (cf. §5, hors périmètre direct).

---

## 8. Stratégie de synchronisation upstream

Le fork est récent (`master` divergé à `601bd46245`) : la distance avec `jellyfin-web` upstream est encore faible, ce qui rend une politique de synchronisation explicite plus facile à tenir maintenant que plus tard.

**Zones où l'on continue de merger depuis upstream** (faible risque de conflit avec la vision Reefin, bénéfice direct des correctifs communautaires) :
- Corrections de bugs et de sécurité sans rapport avec l'architecture (fuites mémoire, correctifs de rendu, compatibilité navigateur).
- Traductions (`src/strings/`) — flux Weblate déjà actif, à préserver tel quel.
- Dépendances tierces et outillage de build tant qu'ils ne bloquent pas la trajectoire TypeScript/React ciblée.
- Correctifs sur des zones legacy pas encore atteintes par une tranche verticale Reefin (pour ne pas payer deux fois le coût de maintenance pendant la transition).

**Zones qui divergent définitivement** (le merge upstream est arrêté dès qu'une tranche Reefin les recouvre) :
- Tout ce qui touche à `src/components/playback/` une fois l'encapsulation/réécriture engagée (§6.2) — le contrat de lecture Reefin (PR91/PR92) n'a pas d'équivalent upstream à merger.
- Le design system et les composants de `src/apps/modern` réécrits selon le pilier 1.
- Toute route/écran migré vers watchlist, historique, OIDC/2FA, pré-transcodage (pilier 3) — ces fonctionnalités n'existent pas côté Jellyfin upstream, aucun merge n'est possible ni souhaitable.
- La couche API cliente une fois branchée sur les contrats `Reefin.*` (elle cesse d'être compatible avec l'API Jellyfin stock par construction).

Chaque tranche verticale qui « ferme » une zone à l'upstream doit le documenter (au minimum dans sa propre PR/RFC), pour que la divergence soit traçable plutôt que découverte a posteriori lors d'un merge conflictuel.

---

## 9. Questions ouvertes

1. Nom de package/branding définitif (`reefin-web` vs autre) et calendrier du rebranding visuel complet — à trancher avant ou pendant la phase 2 ?
2. La couche API typée doit-elle être générée automatiquement depuis les schémas OpenAPI de `reefin`, ou maintenue à la main en synchronisation manuelle avec PR91/PR92 ? Impacte directement le jalon « tests de contrats OpenAPI » de la phase 2.
3. Faut-il un flag de bascule explicite (feature flag) entre l'ancien shell (`layoutManager.modern`) et le nouveau, ou la migration se fait-elle route par route sans bascule globale ?
4. Quel est le sort de `src/apps/legacy` une fois toutes ses routes migrées : suppression complète, ou conservation temporaire derrière un flag pour rollback ?
5. Le pilier 2 (configuration guidée) dépend de bancs d'essai de transcodage côté serveur qui ne sont pas encore documentés dans un RFC `reefin` équivalent à PR91/PR92 — faut-il un RFC serveur dédié avant d'engager la phase 3 côté web, ou l'assistant web peut-il être conçu en parallèle sur un contrat provisoire ?
6. Le partage temporaire (jetons limités) et le device flow du 2FA soulèvent des questions de sécurité qui dépassent le périmètre de ce RFC — nécessitent-ils chacun leur propre RFC de sécurité dédié avant implémentation ?
7. La fiabilisation de l'auto-titrage (§4, §5, §7 phase 3) mérite-t-elle son propre RFC serveur avant tout code, sur le modèle de PR91/PR92 pour la lecture ? Le pipeline actuel (`ProviderManager.cs`) n'a ni retry ni repli automatique entre fournisseurs — la question à trancher côté serveur est le modèle de repli (essayer le fournisseur suivant dans l'ordre configuré après N échecs ? santé/latence par fournisseur avec un état persistant ? backoff simple sans état ?) avant qu'un design web puisse s'appuyer dessus, exactement comme la page de diagnostics de lecture a attendu que PR91/PR92 stabilisent le contrat serveur plutôt que de se caler sur `playbackmanager.js`. Séparément : l'écran de diagnostic/ré-identification web peut sans doute être conçu contre le contrat `ItemLookupController` déjà stable, sans attendre ce RFC serveur — à confirmer au moment du design doc.
