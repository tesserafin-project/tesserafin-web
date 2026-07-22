# Audit de marque — occurrences jellyfin restantes

Date : 2026-07-16 · État : après rebranding de surface (package.json, README, manifest, index.html)

Inventaire des occurrences `jellyfin` hors `node_modules`, `package-lock.json`, `src/strings/`, `.git`. Sert de backlog pour les vagues de renommage suivantes.

## Volumes

| Répertoire | Fichiers avec occurrence |
|---|---|
| src | 414 |
| .github | 13 |
| webpack.common.js | 1 |
| flake.nix | 1 |
| eslint.config.mjs | 1 |
| CONTRIBUTING.md / CONTRIBUTORS.md | 2 |
| README.md / package.json | 2 (intentionnels : crédit + dépendances `@jellyfin/*`) |

`src/strings/` exclu : 106 fichiers de traduction, 1216 occurrences.

Lecture du chiffre 414 : presque pas du branding. `@jellyfin/sdk` importé dans 325 fichiers, `jellyfin-apiclient` (npm + vendored `src/lib/jellyfin-apiclient/`, `src/utils/jellyfin-apiclient/`) dans 136 fichiers — noms de dépendances, pas identité affichée.

## Catégorie 1 — Identifiant protocolaire (NE PAS renommer sans coordination serveur)

- `src/components/apphost.js:11` : `const appName = 'Jellyfin Web'` → propagé via `appHost.appName()` → `ServerConnections.js` → `createApiClient.ts` → header `Authorization` (`Client="Jellyfin Web"`).
- Couplage : `src/utils/image.ts:84` (`case 'Jellyfin Web':`) mappe ce nom de session vers l'icône d'appareil. Les deux points doivent changer ensemble.
- Risque : élevé — quick connect, device management, capacités client côté serveur dépendent de cette chaîne.
- Moment : seulement après que la couche API Reefin définit son propre identifiant client, avec migration des sessions.

## Catégorie 2 — URLs fonctionnelles

- `jellyfin.org/docs/...` (~27 occurrences) : aide contextuelle, fonctionnelle tant que Reefin n'a pas sa doc.
- `github.com/jellyfin/jellyfin` dans messages "ServerUpdateNeeded" (`src/apps/legacy/controllers/session/selectServer/index.js:127-128`, `addServer/index.js:30`) et lien bug serveur (`LocalizationPreferences.tsx:52`) — mauvais dépôt pour un serveur Reefin.
- `repo.jellyfin.org`, `jellyfin.org/downloads/server/`.
- Risque : faible techniquement, confus pour l'utilisateur.
- Moment : dès que les ressources Reefin équivalentes existent (docs, releases serveur).

## Catégorie 3 — Branding affiché (hors traductions) — candidats immédiats

- `src/components/toolbar/ServerButton.tsx:33` et `src/apps/modern/components/drawers/DrawerHeaderLink.tsx:25` : fallback `systemInfo?.ServerName || 'Jellyfin'`.
- `src/scripts/libraryMenu.js:692` : `let documentTitle = 'Jellyfin';` (titre d'onglet avant chargement).
- `src/apps/dashboard/routes/plugins/plugin.tsx:119` : étiquette `owner: 'jellyfin'` pour plugins intégrés.
- Traductions : 1216 occurrences dans `src/strings/` — plus gros morceau textuel, à traiter en vague dédiée.
- Risque : très faible. Moment : maintenant.

## Catégorie 4 — Noms internes sans effet

- Type `JellyfinApiContext` (`src/hooks/useApi.tsx:9`, ~20 sites).
- Modules vendored `src/lib/jellyfin-apiclient/`, `src/utils/jellyfin-apiclient/` (136 fichiers d'import).
- Webpack : chunk `'main.jellyfin'`, env `JELLYFIN_VERSION`. `flake.nix` description. Commentaires divers.
- Risque : nul. Moment : au fil de l'eau, quand la couche API Reefin touche ces fichiers — pas de renommage de masse dédié.

## Catégorie 5 — Assets (logos, bannières, favicons)

- Favicons/touch-icons fournis par le paquet npm `@jellyfin/ux-web`, copiés au build (`webpack.common.js`, CopyWebpackPlugin). Rien dans `src/assets/` directement.
- Bannières/logos affichés : `src/themes/_base/_theme.scss`, `src/themes/purplehaze/theme.scss`, `src/styles/site.scss` référencent `@jellyfin/ux-web/banner-*.png`, `icon-transparent.png`.
- Risque : élevé si mal fait (écrans blancs, icônes cassées).
- Moment : après création d'un jeu d'assets Reefin packagé en remplacement de `@jellyfin/ux-web`.
