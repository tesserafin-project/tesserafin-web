# RFC-0003 — Rupture produit : contrat serveur versionné, nouveau shell web, import à sens unique

- **Statut** : Draft
- **Date** : 2026-07-16
- **Auteur** : Reefin Team
- **Dépôt** : `reefin-web` (fork de `jellyfin-web`)
- **Relation** : formalise côté web le plan produit déjà validé par le mainteneur côté serveur
  (`docs/major-rewrite-plan-v13.md` dans le dépôt `reefin` — verdict global, tableau de statut par
  pilier, mis à jour au fil des PR). S'appuie sur `RFC-0001-vision-and-feasibility.md` (§3 politique
  de breaking changes, §6 architecture cible web, §7 roadmap, §8 stratégie upstream),
  `RFC-0002-browser-support-and-toolchain.md` (baseline navigateurs et outillage, exécutée),
  `design-reefin-api-layer.md` (génération OpenAPI, PR1-3 faites) et `design-web-playback-diagnostics.md`
  (première tranche « diagnostics de lecture », livrée). Voir aussi `branding-audit.md` (identifiant
  client protocolaire, catégorie 1). Côté serveur `reefin`, en plus du plan global :
  `docs/pr91-rfc-playback-decision-v2.md` et `docs/pr92-design-playback-api-and-diagnostics.md`
  (protocole de lecture v2), `docs/pr93-compatibility-lab.md`, `docs/pr99-rfc-di-cycle-untangle.md`,
  `docs/rfc-di-query-user-views-v2.md` (démantèlement `LibraryManager`/statics `BaseItem` en cours).
- **Portée** : ce document est un **RFC de plan produit**, pas un design d'implémentation détaillé.
  Il reprend une décision déjà validée par le mainteneur, la structure, et la relie explicitement à
  l'état réel de ce dépôt et aux documents déjà écrits — il ne réinvente pas le plan. Le détail
  d'implémentation du domaine serveur (`MediaEntity`, jobs durables, plugins v2, etc.) appartient au
  dépôt `reefin`, pas à celui-ci ; ce document en donne le résumé strictement nécessaire pour que
  `reefin-web` sache ce qu'il va consommer et pourquoi. Chaque point du plan qui touche directement
  `reefin-web` renvoie, quand il existe, au design ou au RFC déjà écrit pour ce point plutôt que de le
  redécrire.

---

## 1. Contexte et motivation

### 1.1 Ce que ce document ajoute à RFC-0001/RFC-0002

RFC-0001 posait la vision, la politique de breaking changes (§3) et une roadmap en 6 phases (§7) sur
la base d'un inventaire du dépôt `reefin-web` tel qu'il existait au moment de sa rédaction. RFC-0002
a exécuté une première rupture concrète (baseline navigateurs, Biome) rattachée au critère 1 de
RFC-0001 §3. Depuis, le mainteneur a validé côté serveur un plan de rupture beaucoup plus large que
ce que RFC-0001 anticipait dans son détail (§9 questions ouvertes de RFC-0001 en particulier) —
consigné dans `docs/major-rewrite-plan-v13.md` du dépôt `reefin`, avec un suivi PR par PR déjà engagé
(rename `MediaBrowser.*`/`Emby.*` → `Reefin.*` terminé, domaine de décision de lecture v2 implémenté
et testé, démantèlement de `LibraryManager`/statics `BaseItem` en cours).

Ce RFC-0003 fait deux choses que RFC-0001 ne faisait pas :

1. Il consigne le **plan produit complet validé**, y compris les parties qui vivent principalement
   côté serveur (refonte du domaine, jobs durables, plugins, auth, persistance) — parce que
   `reefin-web` doit savoir vers quel contrat il migre, même si l'essentiel du travail est décrit en
   détail ailleurs (dépôt `reefin`).
2. Il tranche explicitement, pour la partie web, des questions que RFC-0001 §9 laissait ouvertes —
   notamment la nature du nouveau shell et des nouvelles routes (RFC-0001 §9 Q3/Q4), et fixe la règle
   qui gouverne tout le reste du plan.

### 1.2 La règle centrale

> **On casse les contrats et l'architecture hérités, mais pas les données des utilisateurs.**

Cette règle prime sur toute lecture littérale de RFC-0001 §3 (les trois critères de breaking change)
: elle ne les contredit pas, elle les précise pour ce chantier spécifique. Concrètement :

- Aucune garantie de compatibilité API n'est due à un client existant qui parle le protocole Jellyfin
  hérité (routes, DTO PascalCase, `DeviceProfile`) — c'est le cœur de la rupture (§3-§4).
- Aucune garantie de compatibilité n'est due à l'architecture serveur ou au shell web hérités — c'est
  la rupture d'architecture (§5-§9).
- **Une garantie forte et non négociable est due aux données** : comptes utilisateurs, historique et
  progression de lecture, bibliothèques, collections/playlists, images et métadonnées locales,
  configuration pertinente. Le mécanisme qui porte cette garantie est un **importeur à sens unique**
  depuis une instance Jellyfin/Reefin existante (§8, point 15) — pas une compatibilité API
  maintenue, pas un chemin de migration bidirectionnel, pas de garantie de retour arrière une fois
  importé.

Toute décision du reste de ce document qui semblerait toucher à des données utilisateur doit être
relue à l'aune de cette règle avant d'être actée.

---

## 2. Politique de breaking changes — rattachement à RFC-0001 §3

RFC-0001 §3 pose trois critères cumulables (au moins un requis) : (1) suppression d'architecture
héritée, (2) simplification réelle de l'expérience, (3) fonctionnalité importante autrement
impossible ou déraisonnablement coûteuse. La quasi-totalité des points de ce plan invoque
simultanément les trois — ce n'est pas un hasard, c'est ce qui distingue une « rupture produit »
d'une série de breaking changes isolés :

- Le nouveau protocole de lecture (§4) supprime le couplage DLNA hérité (critère 1), simplifie
  radicalement le client (critère 2 — plus de construction d'URL de transcodage côté navigateur), et
  débloque des fonctionnalités jugées impossibles à livrer proprement sur l'ancien modèle
  (pré-transcodage, téléchargements, offline — critère 3).
- La refonte `BaseItem` → `MediaEntity` (§5) supprime un god-object statique documenté comme « dirty
  hack » dans le code serveur lui-même (critère 1), et débloque des domaines média entiers
  (livres audio, podcasts — critère 3) qui ne rentrent pas proprement dans le modèle actuel.
- Le nouveau shell web (§9) supprime jQuery/JS non typé/routeur hérité (critère 1) et simplifie
  l'expérience de contribution comme d'usage (critère 2).

Chaque section ci-dessous nomme le(s) critère(s) applicable(s) quand ce n'est pas évident par
construction, conformément au processus RFC-0001 §3 (« le RFC doit nommer explicitement le(s)
critère(s) invoqué(s) »).

---

## 3. Breaking changes prioritaires — contrat et architecture réseau

| # | Rupture | Remplace | Repère existant / statut |
| --- | --- | --- | --- |
| 1 | Routes Jellyfin/Emby remplacées par une API Reefin versionnée `/api/v1` | Routes historiques Jellyfin non versionnées, cohabitation avec le nommage `Emby.*` | Non démarré côté surface publique — le rename interne `MediaBrowser.*`/`Emby.*` → `Reefin.*` est **terminé** (`major-rewrite-plan-v13.md`, point 13), mais les *routes* HTTP restent celles héritées de Jellyfin aujourd'hui (§13a précise l'articulation avec la couche API web actuelle) |
| 2 | Suppression DTO PascalCase / query strings géantes / réponses polymorphes → JSON camelCase, erreurs `ProblemDetails`, pagination par curseur | Sérialisation PascalCase par défaut de l'API ASP.NET Core actuelle | Non démarré. `design-web-playback-diagnostics.md` §4.2 constate explicitement l'état actuel : « toutes les routes restent PascalCase » sauf une exception forcée en camelCase (route `/Fixture`) — la cible camelCase de ce point n'existe donc encore nulle part dans le contrat consommé par `reefin-web` |
| 3 | Clients obligatoirement générés depuis OpenAPI | Types manuels retapés à la main par fonctionnalité (pattern `features/*/api/types.ts`) | **En cours, largement engagé** — `design-reefin-api-layer.md` tranche la question (RFC-0001 §9 Q2) et documente un pipeline de génération complet : PR1 (pipeline `reefin-sdk`), PR2 (migration du mirror manuel playback diagnostics vers le généré), PR3 (bascule du point de construction) sont **faites**. Ce point 3 est le point du plan le plus avancé côté web à la date de ce RFC |
| 4 | Suppression `DeviceProfile`/`MediaOptions`/`StreamInfo`/types DLNA de l'API publique | Modèle interne DLNA qui fuit dans le contrat réseau | **Fait pour le domaine de décision de lecture** (`Reefin.Playback.Decision`, PR91/PR94/96/97, test d'architecture dédié qui interdit l'import de `Reefin.Model.Dlna` — `design-web-playback-diagnostics.md` §2.1/§2.2). Reste à faire pour le reste de la surface API (items, bibliothèques, etc.), hors périmètre de PR91/PR92 |
| 5 | Interdiction au client de construire les URLs de transcodage — le serveur produit décision + manifeste autorisé | `playbackmanager.js` qui assemble des paramètres HLS et des URLs dans le navigateur | Domaine serveur prêt (§4) ; consommation côté web **non commencée** — c'est explicitement l'objet de la tranche « lecteur modernisé » de RFC-0001 §7 phase 4, pas encore engagée. Le seul écran qui consomme aujourd'hui le contrat v2 est la page de diagnostics **admin**, en lecture seule, pas le lecteur lui-même |
| 6 | Versionnement conjoint serveur/client avec handshake de compatibilité | `MINIMUM_VERSION` figé sur une constante Jellyfin (`10.10.0`) héritée de `@jellyfin/sdk`, sans lien avec la version réelle du serveur ciblé | Partiellement engagé : `design-reefin-api-layer.md` §4.1 corrige déjà le symptôme le plus visible (`MINIMUM_VERSION` dérivé de `x-reefin-version`/`SharedVersion.cs` plutôt que de la constante Jellyfin). Il n'existe en revanche **aucune politique de versionnement écrite** côté serveur (`design-reefin-api-layer.md` §2.1, §10) — le handshake de compatibilité proprement dit reste à concevoir |

Critères RFC-0001 §3 invoqués pour cette section : 1 (suppression d'architecture héritée — DLNA,
PascalCase, versions non alignées) et 3 (fonctionnalités bloquées sans ce socle : génération fiable
de clients, diagnosticabilité).

---

## 4. Nouveau protocole de lecture — la rupture la plus importante

C'est la rupture la plus structurante du plan, parce qu'elle conditionne une partie du reste
(pré-transcodage, téléchargements, offline sync — §10 vague 3) et parce qu'elle est **déjà la plus
avancée côté conception et implémentation serveur**, avec un premier écran web livré dessus.

**Principe** (déjà posé par PR91/PR92 côté serveur, RFC-0001 §1.3, et détaillé par
`design-web-playback-diagnostics.md`) : le client transmet des capacités normalisées, des contraintes
réseau/utilisateur, une référence média et des préférences ; le serveur décide seul de la méthode
(`DirectPlay`/`Remux`/`Transcode`), du conteneur/codecs, des pistes sélectionnées, de l'accélération
matérielle, des manifestes/URLs temporaires et du repli en cas d'échec. Rien de cette décision n'est
recalculé ni contourné côté client.

**À supprimer côté `reefin-web`** (repris tel quel du plan validé, sans reformulation) :

- Manipulation de `DeviceProfile` côté client.
- Paramètres HLS assemblés dans le navigateur.
- Logique de décision dupliquée dans `playbackmanager.js` (4342 lignes, RFC-0001 §1.2/§6.2 — c'est
  la cible n°1 d'encapsulation identifiée par RFC-0001, mais ce point 5/§4 va plus loin qu'une simple
  encapsulation : à terme, la logique de *décision* elle-même disparaît côté client, pas seulement
  son exposition).
- Décisions prises sur des chaînes de codecs non typées.

**État réel, précisément** (pour éviter toute confusion avec un chantier terminé) :

- Le **domaine de décision serveur** (`Reefin.Playback.Decision`) est implémenté et testé — objets
  `PlaybackRequestContext`, `ClientCapabilities`, `MediaSourceSnapshot`, `PlaybackConstraints`,
  `PlaybackDecision`/`ReasonNode` — voir `design-web-playback-diagnostics.md` §2.1.
- L'**API réseau associée** (`PlaybackSessionsController`, `PlaybackDiagnosticsSessionsController`)
  est implémentée et testée — voir §2.2 du même document.
- Le **moteur v2 n'est pas encore la source de vérité en production** : `DecisionVersion` reste à
  `0` (sentinel legacy) tant que la bascule feature-flag/canary (PR115 côté serveur, non commencée)
  n'est pas livrée ; le moteur v2 ne tourne aujourd'hui qu'en *shadow mode*, désactivé par défaut
  (`design-web-playback-diagnostics.md` §2.3).
- Côté web, le **premier point de l'ordre d'exécution du plan (« terminer contrat Playback v2 +
  diagnostics actuels ») est livré** : la page de diagnostics de lecture admin
  (`src/apps/dashboard/routes/playback/diagnostics.tsx` et `features/playback/`, plan PR1-3 de
  `design-web-playback-diagnostics.md`) consomme ce contrat en lecture seule, sans aucune dépendance
  à `playbackmanager.js` (vérifié explicitement, §5.5 du design doc). C'est un jalon de
  **diagnosticabilité**, pas encore de **décision** : le lecteur de lecture lui-même
  (`playbackmanager.js`, l'assemblage HLS navigateur, la construction d'URL côté client) n'a pas
  encore migré — cette migration est la tranche « lecteur modernisé » de RFC-0001 §7 phase 4, qui
  dépend elle-même de la machine à états décrite en §9.3 ci-dessous.

Critères invoqués : 1 (DLNA hérité), 2 (simplification réelle — un seul endroit décide), 3 (débloque
pré-transcodage/offline/hwaccel automatique, RFC-0001 pilier 2).

---

## 5. Refonte du domaine serveur — contexte pour `reefin-web`

Cette section résume, **pour que le web comprenne ce qu'il consommera**, un chantier dont le détail
et l'implémentation appartiennent au dépôt `reefin` (`docs/major-rewrite-plan-v13.md`, points 3-5).
`reefin-web` n'implémente rien de cette section — il l'attend et s'y adapte par tranches, au même
rythme que le reste du plan (§11).

- **Point 7 — `BaseItem` → `MediaEntity` par composition** (`Identity`, `Metadata`,
  `LibraryPlacement`, `MediaAssets[]`, `UserStates[]`, `DomainCapabilities[]`) : remplace le
  god-object statique confirmé par `major-rewrite-plan-v13.md` (« cité "dirty hack" dans le code
  lui-même », point 4 de ce plan serveur). Travail en cours côté serveur (démantèlement des statics
  `BaseItem`/`LibraryManager`, cf. `docs/rfc-di-query-user-views-v2.md`, `docs/pr111-di-closure-audit.md`
  et la série `pr61`→`pr89` de closure audits déjà livrée).
- **Point 8 — séparation `Work`/`Edition`/`MediaAsset`/`Part`/`Track`** : modèle qui distingue
  l'œuvre de ses éditions/exemplaires — prérequis structurel pour les nouveaux domaines média (livres
  audio, podcasts, éditions avancées — §10 vague 3).
- **Point 9 — fin des managers géants/statics → services applicatifs** (`LibraryQueryService`,
  `MediaImportService`, `PlaybackPlanningService`, `UserStateService`, `MetadataService`,
  `JobScheduler`) : `LibraryManager` est confirmé comme god-object par `major-rewrite-plan-v13.md`
  (point 5, « chiffre exact » vérifié dans le code) — c'est le point du plan serveur le plus avancé
  après la lecture, avec une longue série de PR de démantèlement déjà livrées.
- **Point 10 — jobs durables persistés** (progression, pause/annulation, retry, priorité,
  planification, historique, reprise) : brique non encore vérifiée en détail par
  `major-rewrite-plan-v13.md` (verdict « faisable, bien scoper », non commencée). Elle débloque
  directement pré-transcodage, téléchargements, offline sync, détection intros, tests matériels — donc
  une bonne partie de la vague 3 de fonctionnalités (§10) et du pilier 2 de RFC-0001 (configuration
  guidée, bancs d'essai matériel).

Critère RFC-0001 §3 invoqué : 1 en premier lieu (les god-objects statiques sont explicitement nommés
comme dette dans le code source lui-même côté serveur), 3 pour les jobs durables (débloquent des
fonctionnalités jugées impossibles proprement sur l'architecture actuelle).

---

## 6. Plugins — du DLL in-process au sandbox versionné

- **Point 11 — suppression des plugins DLL in-process** au profit d'un manifeste versionné,
  permissions déclarées, API RPC stable, événements documentés, processus séparé/sandbox WASI, quotas
  et timeouts, marketplace signé. `major-rewrite-plan-v13.md` (point 7) confirme le risque du modèle
  actuel dans le code (« Plugin SDK v2 isolé (hors-process) : faisable mais coûteux (IPC, perf) »).
  Chantier serveur, non commencé à ce stade.
- **Point 12 — frontière core/plugins** : cette frontière **existe déjà** et est posée par
  RFC-0001 §4 (tableau core/extension) — ce plan ne la réinvente pas, il en confirme le tracé exact.
  Les fonctions listées comme devant intégrer le cœur (intros/crédits, watchlist, retrait
  continuer-à-regarder, historique, smart playlists, pré-transcodage, téléchargements qualité choisie,
  diagnostics/stats lecture, sauvegardes, partage temporaire) correspondent terme à terme à la colonne
  « core » de RFC-0001 §4, à l'exception de « sauvegardes » qui est un ajout explicite de ce plan par
  rapport à RFC-0001 (à reporter dans RFC-0001 §4 lors d'une prochaine révision, plutôt que laissé en
  divergence tacite entre les deux documents). Les extensions listées ici (Trakt, fournisseurs
  métadonnées, notifications/webhooks, catalogues spécialisés, domotique) correspondent également à
  la colonne « extension » de RFC-0001 §4 — seule « domotique » est un ajout non couvert
  explicitement par RFC-0001 §4, cohérent avec le principe déjà posé (pas de contrat serveur stable
  nécessaire) donc sans tension réelle.

Critère invoqué : 1 (DLL in-process = couplage/fragilité hérités) et 3 (marketplace signé, sandbox —
impossibles à livrer proprement sur le modèle actuel).

---

## 7. Authentification moderne

Point 13 : OIDC/OAuth, device authorization flow TV, TOTP, passkeys/WebAuthn, sessions révocables par
appareil, recovery codes, permissions rôle/capacité. **Quick Connect subsiste** comme UX, mais
reconstruit sur le nouveau modèle de sessions plutôt que sur l'actuel.

Ce point recoupe exactement RFC-0001 §5 (« OIDC/OAuth SSO », « 2FA » — classés « moyenne à élevée »/
« élevée, nécessite récupération et device flow » dans la matrice de faisabilité) et §9 Q6 de
RFC-0001 (« le device flow du 2FA soulève des questions de sécurité qui dépassent le périmètre de
RFC-0001 — nécessite-t-il son propre RFC de sécurité ? »). Ce plan confirme le périmètre fonctionnel
mais **ne referme pas** la question ouverte RFC-0001 §9 Q6 : un RFC de sécurité dédié reste nécessaire
avant implémentation, en particulier pour le device authorization flow TV et les recovery codes.

Critère invoqué : 1 (le modèle de session actuel est hérité et daté) et 3 (2FA/passkeys/device flow
TV sont jugés inatteignables proprement sans ce socle).

---

## 8. Persistance et import à sens unique

- **Point 14 — rigueur transactionnelle** : transactions explicites, migrations versionnées,
  contraintes en base, optimistic concurrency, journalisation. SQLite reste le défaut, PostgreSQL le
  choix avancé, MySQL non prioritaire. `major-rewrite-plan-v13.md` (point 8) confirme l'état actuel
  dans le code : « SQLite seul provider réel » — ce point consolide un chantier déjà amorcé
  (EF Core + Postgres « faisable, déjà en route » selon le même document) plutôt que d'en ouvrir un
  nouveau.

- **Point 15 — import à sens unique — c'est le mécanisme qui porte la règle centrale du §1.2.**
  Utilisateurs, historique/progression, bibliothèques, collections/playlists, images/métadonnées
  locales, configuration pertinente sont importés depuis une instance Jellyfin/Reefin existante.
  **Aucun retour garanti** : une fois importées dans le nouveau modèle de persistance et le nouveau
  domaine (`MediaEntity`, §5), les données ne sont pas ré-exportables vers le format hérité. C'est
  la seule concession de compatibilité que ce plan s'autorise, et elle est délibérément étroite (un
  import, pas une compatibilité API ou un pont bidirectionnel) — c'est ce qui rend le reste du plan
  (rupture de contrat, rupture d'architecture, rupture de shell) acceptable sans trahir les
  utilisateurs existants.

  Ce point est **hors périmètre d'implémentation de `reefin-web`** (c'est un outil/chemin serveur),
  mais **directement pertinent pour le web** à deux endroits : (a) l'écran d'onboarding
  (`src/apps/wizard/`, déjà identifié par RFC-0001 §6.3 comme périmètre à faire évoluer avec le
  pilier 2) est le point d'entrée UX naturel pour déclencher et suivre un import ; (b) la
  communication produit doit être sans ambiguïté sur le caractère non réversible de l'opération —
  point à traiter dans le design de l'écran d'import quand il sera écrit, pas dans ce RFC.

Critère invoqué : 1 pour la persistance (contraintes/transactions absentes aujourd'hui sont de la
dette confirmée) ; l'import à sens unique n'est pas un breaking change au sens de RFC-0001 §3 — c'est
le mécanisme qui *rend acceptables* les breaking changes du reste du plan, il mérite d'être lu comme
une garantie plutôt que comme une rupture.

---

## 9. Refonte `reefin-web`

### 9.1 Baseline technique (point 16)

Suppression du frontend legacy : `jellyfin-apiclient`, jQuery, scripts globaux, JS non typé, ancien
routeur, pages HTML historiques, Webpack et loaders hérités, événements globaux implicites. Cible :
baseline TypeScript strict, React moderne, ESM, Vite, TanStack Query, composants accessibles, client
OpenAPI généré, tests Vitest et Playwright.

**Ce qui est déjà fait ou en cours, précisément** (pour ne pas laisser croire que ce point démarre de
zéro) :

- **Client OpenAPI généré** : voir §3 point 3 — le plus avancé de tous les sous-points de ce point 16.
- **TypeScript strict / React moderne** : `src/apps/dashboard` (181 fichiers, ~99 % TS/TSX) est déjà
  la preuve que ce standard fonctionne dans ce dépôt, cf. RFC-0001 §6.3.
- **JS non typé, ancien routeur, pages HTML historiques, Webpack et loaders hérités, jQuery,
  `jellyfin-apiclient`, scripts globaux, événements globaux implicites** : aucun de ces retraits n'a
  commencé. RFC-0002 a réduit la *surface de contrainte* qui rendait ces retraits plus coûteux
  (baseline navigateurs evergreen, suppression des polyfills `src/lib/legacy/`) mais n'a retiré
  **aucun** de ces éléments eux-mêmes — voir §13b pour la distinction précise entre « a ramené le
  terrain en état » et « a fait le travail ».
- **Vitest** : déjà en place (`vite.config.ts`, environnement `jsdom`) et déjà utilisé pour des tests
  unitaires purs (`design-web-playback-diagnostics.md` §7). **Playwright** : non présent dans le
  dépôt à ce jour — à instrumenter.

Critère invoqué : 1 (chaque élément listé est nommément de l'architecture héritée dans RFC-0001 §1.2)
et 2 (accessibilité/navigation clavier-télécommande dès la conception, RFC-0001 pilier 1).

### 9.2 Nouveau shell et nouvelles URLs (point 17)

Nouvelles routes : `/home`, `/library/:libraryId`, `/title/:itemId`, `/watch/:sessionId`, `/search`,
`/watchlist`, `/history`, `/admin/system`, `/admin/jobs`, `/admin/playback`, `/admin/libraries`.
Anciens liens redirigés une version puis supprimés.

C'est le point qui tranche le plus directement une question ouverte de RFC-0001 (§9 Q3 : « faut-il un
flag de bascule explicite entre l'ancien shell et le nouveau, ou route par route ? »). Réponse
apportée par ce plan : ni l'un ni l'autre littéralement — un **nouveau jeu de routes** cohabite avec
`MODERN_APP_ROUTES`/`LEGACY_APP_ROUTES`/`DASHBOARD_APP_ROUTES`/`WIZARD_APP_ROUTES` existants
(`src/RootAppRouter.tsx`), avec dépréciation programmée des anciens liens plutôt qu'un flag binaire
global. Voir §14 pour la tension que ce choix crée avec la stratégie de tranches verticales de
RFC-0001 §6.5, et la résolution proposée.

`/watch/:sessionId` mérite d'être noté explicitement : c'est la première URL du plan qui présuppose
l'existence d'une session de lecture serveur adressable — donc directement dépendante du protocole
de lecture (§4) plutôt qu'une simple route UI indépendante.

### 9.3 Lecteur comme machine à états (point 18)

`idle → negotiating → buffering → playing`, plus `recovering`, `failed`. Simplifie changement de
pistes, reprise erreur, fallback, gapless, SyncPlay, stats, qualité adaptative, diagnostics.

Ce point **dépend directement** du protocole de lecture serveur (§4) : la machine à états ne peut pas
être conçue en détail tant que le contrat de décision qu'elle orchestre (quand renégocier, quand
basculer en repli, quelle information le serveur garantit à chaque étape) n'est pas stabilisé côté
consommation web au-delà du cas diagnostic-seul déjà livré. C'est la tranche « lecteur modernisé » de
RFC-0001 §7 phase 4 — non commencée, et qui appelle son **propre design doc dédié** (voir §13d).

### 9.4 Intentions plutôt qu'options techniques (point 19)

Utilisateur : « Meilleure qualité », « Équilibré », « Économiser la bande passante », « Ne jamais
transcoder », « Automatique recommandé ». Admin : matériel détecté, tests réussis/échoués,
accélération choisie, codecs opérationnels, fallback, bouton Retester. Mode Expert conservé mais
secondaire.

Correspond directement au pilier 2 de RFC-0001 (« configuration guidée ») et à sa précision : « le
gros du travail est côté serveur ; reefin-web fournit l'assistant guidé, l'affichage des résultats et
les contrôles, pas la logique de détection elle-même ». Dépend des bancs d'essai de transcodage
serveur identifiés par RFC-0001 §9 Q5 comme non encore documentés dans un RFC serveur dédié — cette
question reste ouverte, ce plan ne la referme pas.

### 9.5 Design system Reefin (point 20)

Tokens couleur, typographie/espacements, composants uniques, responsive réel, navigation
télécommande/clavier, densité réglable, thèmes clair/sombre, animations limitées accessibles.
Correspond au pilier 1 de RFC-0001 (« Interface entièrement modernisée »), sans design doc dédié
existant à ce jour — candidat naturel pour le prochain document à écrire une fois §9.2 (nouveau shell)
stabilisé, puisque le design system s'exprime à travers les composants du nouveau shell.

---

## 10. Fonctionnalités par vagues

Reprise telle quelle du plan validé, à lire en complément — pas en remplacement — de la matrice de
faisabilité déjà publiée par RFC-0001 §5 (le classement par vague ci-dessous est un séquencement
d'exécution, RFC-0001 §5 reste la référence de faisabilité technique par fonctionnalité) :

- **Vague 1 — gains rapides** : retrait continuer-à-regarder, watchlist, historique, lazy loading,
  recherche genre/tag, arrêt admin de session, épisodes manquants. Recoupe RFC-0001 §5 (« Facile,
  excellent premier gain UX » / « Moyenne, très prioritaire » pour la plupart de ces entrées).
- **Vague 2 — socle différenciant** : hwaccel auto, OIDC/2FA, smart playlists, intros/crédits, liens
  SyncPlay, partage temporaire, évaluations personnelles.
- **Vague 3 — travaux lourds** : pré-transcodage, téléchargements transcodés, offline sync, livres
  audio, podcasts, gapless complet, éditions avancées. Recoupe les entrées « Élevée »/« Très élevée »
  de RFC-0001 §5, cohérent avec leur dépendance aux jobs durables (§5 point 10 ci-dessus) et au modèle
  `Work`/`Edition`/`MediaAsset` (§5 point 8).

---

## 11. Ordre d'exécution

Repris et annoté avec l'état réel constaté au moment de la rédaction (2026-07-16) :

1. **Terminer contrat Playback v2 + diagnostics actuels — LIVRÉ côté web** (PR1-3 de
   `design-web-playback-diagnostics.md`, §4 ci-dessus). Le contrat serveur (PR91/PR92) reste en
   *shadow mode* désactivé par défaut — « terminer le contrat » signifie ici « le contrat existe,
   est testé et consommable », pas « le moteur v2 est en production ».
2. **Verrouiller le protocole Reefin, abandonner les routes publiques legacy** — non commencé
   (§3 points 1-2, 4-6).
3. **Créer le nouveau shell `reefin-web` TS/React — EN COURS** au sens où le socle existe déjà
   (`apps/dashboard`, `apps/modern`, RFC-0001 §6.3) mais le *nouveau jeu de routes* du point 17
   (§9.2) n'est pas encore créé — « en cours » qualifie la maturité du socle réutilisable, pas
   l'existence des nouvelles routes elles-mêmes.
4. **Jobs durables + auth moderne + plugin v2** — non commencé côté serveur ; rien à faire côté web
   avant que ces briques serveur existent (au-delà de la conception, cf. §7 pour l'auth).
5. **`BaseItem` → modèle composé** — en cours côté serveur (§5 point 7), invisible depuis le web tant
   que le contrat public (§3) n'a pas changé en conséquence.
6. **Gains UX vague 1** — non commencé côté web, mais le terrain (couche API générée, §3 point 3) est
   prêt à les recevoir plus vite qu'avant PR1-3.
7. **Absorber les plugins essentiels** — dépend du point 4 (plugin v2).
8. **Offline/pré-transcodage + nouveaux domaines média** — dépend des points 5 et 10 (§5).
9. **Supprimer les dernières façades Jellyfin** — dernier point par construction, non commencé.

Cet ordre confirme que le web est actuellement positionné correctement en tête de roadmap (point 1
livré, point 3 en fondations), mais qu'aucun point de rupture de contrat public (§3) n'est encore
franchi — la fenêtre de cohabitation entre ancien et nouveau protocole reste entièrement à ouvrir.

---

## 12. Anti-goals explicites

Déconseillés par le plan, à rappeler explicitement parce que la tentation existe régulièrement dans
ce genre de chantier :

- **Réécriture Rust** — le monolithe modulaire .NET/C# est conservé (confirmé comme direction saine
  par `major-rewrite-plan-v13.md`, verdict global).
- **Microservices** — même document, même verdict : pas de découpage en services séparés.
- **Abandon des données existantes** — directement contredit par la règle centrale du §1.2 ; c'est
  l'anti-goal le plus important de ce document, celui qui légitime tout le reste.

---

## 13. Impacts immédiats pour `reefin-web`

### (a) `@jellyfin/sdk` → `reefin-sdk` : migration transitoire, pas le point d'arrivée

`design-reefin-api-layer.md` documente et a déjà largement exécuté (PR1-3) le remplacement de
`@jellyfin/sdk` par `reefin-sdk`, généré depuis la spec OpenAPI actuelle du serveur `reefin`. Ce plan
précise ce que ce document ne pouvait pas savoir au moment de sa rédaction : cette spec actuelle
expose encore des **routes et une sérialisation héritées** (PascalCase, pas de préfixe `/api/v1`,
§3 points 1-2). `reefin-sdk` n'est donc pas le point d'arrivée du plan — c'est une étape intermédiaire
qui retire déjà la dette de génération manuelle (le vrai problème que réglait
`design-reefin-api-layer.md`), en attendant que le contrat serveur lui-même change de forme. Quand
`/api/v1` camelCase existera, `reefin-sdk` sera **régénéré sur ce nouveau contrat** avec le même
pipeline (`openapi-generator-cli`/`typescript-axios`, §4.1 de `design-reefin-api-layer.md`) — pas
remplacé par un nouvel outil. C'est précisément la promesse de migration mécanique que ce document
pose déjà (§3 de `design-reefin-api-layer.md`) : elle s'applique aussi bien à un changement de spec
`reefin` interne qu'à un changement de forme de contrat plus large comme `/api/v1`.

### (b) Vite remplace Webpack — à séquencer avec RFC-0002

RFC-0002 §6 laisse ouverte la question « Babel → esbuild/swc ? » (question ouverte 1) sans trancher
en faveur de Vite spécifiquement. Ce plan tranche de facto cette question : Vite (qui embarque esbuild
pour le dev et Rollup pour le build) remplace Webpack **et** Babel dans le même mouvement, ce qui va
plus loin que ce que RFC-0002 envisageait (RFC-0002 discutait un remplacement de loader à
architecture Webpack inchangée, pas un changement d'outil de build). Séquencement proposé : la
baseline navigateurs evergreen actée par RFC-0002 §3 (ES2020+, plus de cible ES5) est un **prérequis**
à une migration Vite propre — Vite ne supporte pas nativement une cible ES5/polyfills globaux du
type `src/lib/legacy/` (déjà supprimé par RFC-0002 §4.1, ce qui lève l'obstacle). La migration Vite
peut donc être engagée dès maintenant sans attendre d'autres jalons de ce plan, et referme la question
ouverte 1 de RFC-0002 §6 par un choix d'outil plus radical que ce qu'elle envisageait (Vite, pas
« esbuild-loader/swc-loader » à l'intérieur de Webpack).

### (c) Nouveau shell + nouvelles routes = nouveau design doc à écrire

Le point 17 (§9.2) n'a pas de design doc aujourd'hui. Il en faut un, distinct de ce RFC, qui couvre :
la mécanique de cohabitation technique du nouveau routeur avec `RootAppRouter.tsx` existant (RFC-0001
§6.1 pose déjà le principe de généralisation du routeur actuel plutôt que son remplacement — ce
design doit s'y conformer, pas repartir de zéro), la stratégie de redirection/dépréciation des
anciennes routes (« une version puis supprimées » — à quantifier), et l'articulation avec
`apps/dashboard`/`apps/modern`/`apps/wizard` existants (lequel absorbe quoi, ou est-ce un nouveau
répertoire `apps/*` séparé). Ce document répond à RFC-0001 §9 Q3 dans son principe (§9.2) mais pas
dans son détail d'exécution.

### (d) Lecteur machine à états = design doc dédié, dépend du protocole serveur

Le point 18 (§9.3) ne peut pas être conçu en détail avant que la consommation web du protocole de
lecture (§4) dépasse le cas diagnostic-seul actuellement livré. Ce design doc devra couvrir a minima
: la correspondance états ↔ appels API (`Playback/Sessions` POST/PUT/DELETE, `design-web-playback-diagnostics.md`
§4.1), la stratégie d'encapsulation temporaire de `playbackmanager.js` pendant la transition
(RFC-0001 §6.2 — ce plan ne l'annule pas, il en précise l'aboutissement final), et le traitement des
12 composants `apps/modern/` qui importent aujourd'hui directement `playbackmanager.js` (première
cible de migration selon RFC-0001 §6.2).

### (e) Mise à jour de RFC-0001 §7 (roadmap) là où ce plan la précise ou la remplace

RFC-0001 §7 reste globalement valide dans sa logique de phasage (fondations → administration →
expérience quotidienne → fonctions intégrées → protocoles multi-clients), mais ce plan la précise à
plusieurs endroits qui justifient une prochaine révision de RFC-0001 plutôt qu'une simple lecture en
parallèle :

- RFC-0001 §7 phase 2 anticipait un blocage sur PR112 (« dès leur disponibilité serveur ») —
  `design-web-playback-diagnostics.md` §2 a déjà corrigé ce point (rien n'était bloqué, PR112 **et**
  PR113 étaient faites). Ce constat est confirmé et non remis en cause par ce plan.
- RFC-0001 §7 phase 4 (« lecteur modernisé ») doit désormais être lue comme dépendante explicitement
  du point 18 de ce plan (§9.3/§13d), pas comme une simple tranche verticale supplémentaire parmi
  d'autres.
- RFC-0001 §7 ne mentionne ni jobs durables ni plugin v2 ni refonte `BaseItem` — normal, ces points
  sont majoritairement serveur et n'existaient pas avec ce niveau de détail au moment de sa
  rédaction. Une révision de RFC-0001 §7 devrait au minimum ajouter un renvoi vers ce document pour
  ces briques, sans nécessairement les détailler (elles restent hors périmètre `reefin-web`).

---

## 14. Tensions avec RFC-0001 et résolution proposée

**Tension identifiée** : RFC-0001 §6.5 pose une stratégie de **tranches verticales dans le repo actuel**
— « chaque tranche livre une fonctionnalité complète... une tranche ne "touche" le legacy que par
encapsulation, jamais par modification opportuniste ». Le point 17 de ce plan (§9.2) parle, lui, d'un
**nouveau shell et de nouvelles URLs** (`/home`, `/library/:libraryId`, etc.) qui se lit, à première
lecture, comme une proposition de reconstruction séparée plutôt que comme une évolution incrémentale
du shell actuel (`MODERN_APP_ROUTES`/`LEGACY_APP_ROUTES`/`DASHBOARD_APP_ROUTES`/`WIZARD_APP_ROUTES`).
Si ce nouveau shell était conçu comme un chantier isolé, décorrélé des tranches verticales en cours
(comme la page de diagnostics de lecture déjà livrée dans `apps/dashboard`), le risque documenté par
RFC-0001 §1.2 réapparaîtrait exactement sous la forme que RFC-0001 §6.1 cherchait à éviter : deux
shells qui avancent en parallèle sans jamais converger.

**Résolution proposée** : **le nouveau shell vit dans ce dépôt, comme une nouvelle famille de routes
au même niveau que `MODERN_APP_ROUTES`/`DASHBOARD_APP_ROUTES` aujourd'hui** (RFC-0001 §6.1 : « le
mécanisme qu'on généralise, pas qu'on remplace »), pas comme un dépôt ou un chantier séparé. Les
tranches verticales de RFC-0001 §6.5 restent la méthode de construction : chaque route du point 17
(§9.2) — `/home`, `/library/:libraryId`, `/title/:itemId`, etc. — est livrée comme une tranche
verticale complète (UI + intégration API + tests), exactement selon la méthode déjà validée par la
page de diagnostics de lecture. La différence avec la lecture initiale de RFC-0001 n'est donc pas la
*méthode* (les tranches verticales restent la règle), mais la *cible* : au lieu que chaque tranche
migre une route de l'ancien shell vers `apps/modern` en conservant son URL, une partie des tranches à
venir livre directement une route du **nouveau jeu d'URLs** du point 17, avec redirection depuis
l'ancienne route le temps d'une version (§9.2). Concrètement : `apps/legacy` continue de se vider
route par route comme prévu par RFC-0001 §6.2, mais les routes qui le remplacent ne sont pas
nécessairement les URLs actuelles de `apps/modern` — elles peuvent directement porter les nouvelles
URLs de ce plan. Ce point (l'articulation exacte route par route) reste néanmoins à détailler dans le
design doc du point (c) ci-dessus (§13c) — cette section pose le principe de résolution, pas le plan
d'exécution route par route.

---

## 15. Questions ouvertes

1. Calendrier de la rupture de contrat public (§3 points 1-2, 4-6) : quand `/api/v1` camelCase
   devient-il consommable, et quelle fenêtre de cohabitation avec les routes héritées est prévue côté
   serveur ? Conditionne directement le moment où `reefin-sdk` (§13a) doit être régénéré sur le
   nouveau contrat plutôt que sur l'actuel.
2. Le design doc du nouveau shell (§13c) doit-il trancher, avant tout code, la question de savoir si
   `apps/legacy` disparaît en même temps que les nouvelles routes apparaissent route par route, ou si
   une période de coexistence à trois shells (`legacy`/`modern`/nouveau) est acceptée temporairement ?
   RFC-0001 §9 Q4 posait déjà cette question pour `apps/legacy` seul ; ce plan l'étend à trois
   familles de routes actives simultanément.
3. Le RFC de sécurité dédié à l'auth moderne (§7, RFC-0001 §9 Q6) doit-il précéder ou accompagner le
   design doc du nouveau shell (§13c), sachant que les routes `/admin/*` du point 17 dépendent
   directement du modèle de permissions rôle/capacité du point 13 ?
4. Le décalage entre catégorisation core/plugins de ce plan (§6, point 12 — « sauvegardes », « domotique »)
   et le tableau RFC-0001 §4 doit-il être résolu par une révision immédiate de RFC-0001 §4, ou
   documenté comme delta assumé jusqu'à la prochaine révision naturelle de RFC-0001 ?
5. Ce document propose en §14 que le nouveau shell vive dans ce dépôt sous forme de nouvelles routes
   plutôt que comme chantier séparé — cette résolution doit-elle être actée comme amendement formel de
   RFC-0001 §6.1/§6.5, ou ce RFC-0003 fait-il foi seul jusqu'à une révision groupée ultérieure de
   RFC-0001 ?
