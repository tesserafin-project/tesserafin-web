# RFC-0004 — Périmètre plateforme et retrait des cibles TV historiques

- **Statut** : Draft
- **Date** : 2026-07-16
- **Auteur** : Reefin Team
- **Dépôt** : `reefin-web` (fork de `jellyfin-web`)
- **Relation** : s'appuie sur RFC-0001 (`docs/reefin/RFC-0001-vision-and-feasibility.md`) §5 (clients
  Android/Swiftfin/AppleTV/Tizen/Vidaa hors périmètre) et RFC-0003
  (`docs/reefin/RFC-0003-product-rupture.md`) §9/§12 (stratégie « client universel +
  centre d'administration », clients natifs Android/Apple dans des dépôts séparés). Fait suite à
  RFC-0002 (`docs/reefin/RFC-0002-browser-support-and-toolchain.md`) §2 et §6 question ouverte 3, qui
  identifiait ~190 occurrences `tizen`/`web0s`/`orsay`/`operaTv` dans `src/` sans les traiter et
  posait explicitement la question d'un RFC dédié. Ce document est cette suite.
- **Note de langue** : les autres RFC de ce dépôt sont rédigés en français (vérifié sur RFC-0001 à
  RFC-0003) ; ce document suit la même convention plutôt que la consigne initiale « en anglais »,
  pour rester cohérent avec le corpus existant. Signaler si l'anglais était réellement voulu.
- **Exécution (W13.2, « Périmètre plateforme »)** : la **PR1** du plan §5 (retrait Orsay / Opera TV /
  Edge UWP) est exécutée dans cette même tranche — voir §7 pour l'inventaire chiffré et les gates.
  Les PR2 (webOS/Tizen) et PR3 (résidus) restent à faire ; le statut general du RFC reste **Draft**
  tant qu'elles ne sont pas closes.

---

## 1. Contexte et motivation

RFC-0001 §5 classe déjà « les clients Android, Swiftfin, AppleTV, Tizen, Vidaa » comme hors
périmètre de maintenance de `reefin-web` — ce sont des codebases séparées. Mais `reefin-web` n'est
pas seulement un site desktop : c'est aussi, historiquement, le bundle embarqué tel quel dans les
WebView natives des applications LG webOS et Samsung Tizen officielles de Jellyfin (contrairement à
Android TV, Swiftfin ou AppleTV qui sont des codebases natives distinctes n'important rien de ce
dépôt). RFC-0002 §2 documente ce fait et son coût toolchain (baseline navigateurs, Babel/polyfills) ;
RFC-0002 §6 question ouverte 3 pose, sans y répondre, le sort du code de **détection matérielle** —
branches `browser.tizen`/`web0s`/`orsay`/`operaTv`/`edgeUwp`, shims clavier/scroll/CustomElements
spécifiques — laissé intact par ce précédent RFC qui ne portait que sur la cible de build.

Ce RFC répond à cette question ouverte, avec un mandat clarifié entre-temps par le mainteneur :

1. **Pas de compatibilité officielle webOS/Tizen historique** dans `reefin-web`, et **pas de wrappers
   Jellyfin** (`jellyfin-webos`, `jellyfin-tizen`) dans ce dépôt. Aucune matrice firmware de
   remplacement n'est fixée ici, ni ailleurs.
2. **Mais l'UX télévision générique doit être préservée** : navigation télécommande/clavier/gamepad,
   focus visible, layouts 10-foot, lecteur plein écran, performance sur matériel modeste. Un futur
   client **Reefin TV** vivra dans un dépôt séparé et pourra réutiliser cette UX générique — elle
   n'est donc pas de la dette à supprimer, contrairement à la détection matérielle Tizen/webOS/Orsay/
   Opera TV/Edge UWP proprement dite.
3. **Stratégie plateforme (RFC-0003 §9/§12)** : `reefin-web` = client universel (desktop/mobile/PWA)
   **et** centre d'administration ; les clients natifs Android et Apple vivent dans des dépôts
   séparés avec un contrat API/SDK partagé. Ce RFC est cohérent avec cette lecture : il ne réintroduit
   aucune ambition de compatibilité TV embarquée dans ce dépôt.
4. **Suppression bornée** : pas de PR unique de ~190+ fichiers. Le retrait se fait en 2-3 PR
   indépendamment revuables, chacune avec ses propres gates de vérification (§6).

---

## 2. Périmètre de ce RFC

**Dans le périmètre** :
- Détection et branches conditionnelles pour Samsung **Orsay** (pré-Tizen, `browser.orsay`),
  **Opera TV** (`browser.operaTv`), **Edge UWP** (Xbox historique, `browser.edgeUwp`, et le pont
  WinRT `window.Windows`/`Windows.*` qui lui est propre).
- Détection et branches conditionnelles pour **webOS** (`browser.web0s`, `browser.web0sVersion`) et
  **Tizen** (`browser.tizen`, `browser.tizenVersion`), globals `tizen`/`webapis`/`webOS`.
- Shims clavier, scroll, workers et Custom Elements spécifiques à ces plateformes.
- Les déclarations de type associées (`src/scripts/browser.d.ts`).

**Hors périmètre (explicitement conservé, non traité ici)** :
- `browser.xboxOne`, `browser.ps4`, `browser.vega`, `browser.titanos`, `browser.hisense`,
  `browser.vidaa` : consoles/TV non visées par ce RFC. Xbox en particulier reste un point d'attention
  transverse (voir §4.3) car il partage des branches avec Edge UWP.
- Toute l'UX télévision générique (navigation clavier/gamepad, focus, layouts 10-foot) — voir §4.
- La reconnaissance de sessions clients tiers dans le centre d'administration (ex.
  `src/utils/image.ts:78-80`, qui mappe le nom de rapport `"Jellyfin for WebOS"` — envoyé par
  l'application native webOS officielle de Jellyfin quand elle se connecte à un serveur Reefin — à
  une icône). Ce n'est pas de la détection de plateforme d'exécution de `reefin-web` lui-même, c'est
  de l'affichage d'inventaire de sessions actives ; le supprimer casserait l'icône de session pour un
  cas d'usage réel et distinct (admin qui surveille des clients tiers), donc **explicitement gardé**
  dans toutes les PR de ce RFC.

---

## 3. Ce que « globals tizen/webapis/webOS » veut dire concrètement

Point de méthode qui change le plan initial : **il n'existe aucune déclaration de type ambient**
pour `tizen`, `webapis`, `webOS` ou `Windows` dans ce dépôt. `src/global.d.ts` ne déclare que
`ApiClient`, `Events`, `NativeShell`, `Loading` sur `Window`, plus quelques constantes de build — rien
sur les globals TV. La raison : `tsconfig.json` a `checkJs: false` (`allowJs: true`), donc les
fichiers `.js` (où vivent toutes ces références : `apphost.js`, `browserDeviceProfile.js`,
`htmlVideoPlayer/plugin.js`, `htmlMediaHelper.js`) ne sont pas type-checkés, et `tizen.application...`,
`webOS.platformBack()`, `webapis.productinfo.isUdPanelSupported()`, `Windows.Storage...` y sont
utilisés comme des globals implicites `any` sans jamais lever d'erreur TypeScript.

**Conséquence pour ce RFC** : « supprimer les globals et leurs déclarations de types » ne signifie pas
retirer des entrées de `global.d.ts` (il n'y en a pas) — cela signifie supprimer les *sites d'appel*
(`tizen.*`, `webOS.*`, `webapis.*`, `Windows.*`) dans les fichiers `.js` listés en §7.2/§8, et les
déclarations booléennes `orsay`/`operaTv`/`edgeUwp`/`tizen`/`web0s`/`tizenVersion`/`web0sVersion`
dans **`src/scripts/browser.d.ts`**, seul fichier `.d.ts` qui référence ces plateformes (confirmé par
audit : `grep -rln "tizen\|webOS\|webapis\|window\.Windows" src --include="*.ts" --include="*.tsx"`
ne retourne que `browser.d.ts` et `subtitleStyles.ts`, ce dernier en commentaire prose, cf. §8).

---

## 4. Branches génériques à conserver — UX télévision

Le mandat (§1 point 2) exige de distinguer, dans du code qui *mentionne* Tizen/webOS/Xbox/UWP,
ce qui est vraiment de la **détection de plateforme morte** de ce qui est de l'**UX télévision
générique** à garder pour un futur client Reefin TV. Inventaire de ce qui est identifié comme
générique et **ne doit pas être supprimé** par PR2/PR3 :

| Fichier | Élément | Pourquoi générique |
| --- | --- | --- |
| `src/scripts/keyboardNavigation.js:14-60` (`KeyNames`) | Table de mapping des codes clavier vers des noms sémantiques (`ArrowUp`, `Enter`, `GamepadA`, `GamepadDPadUp`, `MediaPlay`, `Back`, …) | Table de faits (quel keycode = quelle touche), pas une branche conditionnelle sur une plateforme détectée — appliquée inconditionnellement |
| `src/scripts/keyboardNavigation.js:288-292` (`canEnableGamepad`) | Décide si le script générique `gamepadtokey.js` (Gamepad API standard → mêmes noms de touches synthétiques que `KeyNames`) doit s'attacher | **Repointé de `!browser.edgeUwp` vers `!browser.xboxOne` dans la PR1 exécutée (§7.3)** — la fonction elle-même est la navigation manette générique à garder, seule sa condition de garde était liée à Edge UWP |
| `src/scripts/gamepadtokey.js` (entier) | Polyfill Gamepad API générique (bouton A/B/DPad/stick → mêmes codes que `KeyNames`) | C'est littéralement l'implémentation de la navigation manette générique pour tout navigateur/plateforme non-UWP |
| `src/components/layoutManager.js` et tout ce qui teste `layoutManager.tv` | Bascule layout 10-foot / navigation focus | Générique, ne dépend pas de la détection Tizen/webOS |
| `src/elements/emby-select/emby-select.js:86` (commentaire « Xbox controller ... keycode 195 ») | Gestion clavier/manette pour la touche de sélection | Comportement Xbox générique (gamepad), le check `browser.xboxOne` associé est hors périmètre (§2) |
| Focus visible, styles `:focus-visible`, gestion de navigation au clavier dans les composants `emby-*` (hors branches explicitement `tizen`/`web0s`/`orsay` listées en §7/§8) | UX clavier/télécommande générique | Aucune détection de plateforme historique, juste de l'accessibilité clavier standard |

Le principe retenu et appliqué dans la PR1 exécutée (§7) : **une condition qui teste
`browser.edgeUwp`/`orsay`/`operaTv` peut perdre son terme sans toucher au reste de la même
expression** — `x || tizen || web0s` perd juste `x`, `!x && !tizen && !web0s` perd juste `!x` — parce
que la détection retirée rend le flag correspondant `undefined` (donc `falsy`) partout, ce qui
préserve exactement le comportement pour toutes les plateformes encore détectées. La seule exception
trouvée par audit est `canEnableGamepad()` (voir §4 tableau, détaillé en §7.3) où le test portait sur
`edgeUwp` alors que l'intention réelle concernait Xbox — un vrai Xbox actuel avec Edge Chromium/
WebView2 active **à la fois** `xboxOne` et `edgeUwp` (vérifié par audit de `browser.test.ts` et de
`uaMatch()` dans `browser.js`), donc supprimer `edgeUwp` sans repointer aurait fait doublonner la
gestion manette sur Xbox réel — régression sur l'UX générique à préserver.

---

## 5. Inventaire précis — audit grep réel (avant toute suppression)

Baseline mesurée sur `src/` (hors `node_modules`), au commit de départ de cette tranche
(`w13.1-foundations-closure`) :

| Motif (insensible à la casse) | Occurrences | Portée |
| --- | --- | --- |
| `tizen` | 112 | PR2 |
| `web0s` / `webos` | 166 | PR2 |
| `webapis` | 1 (`src/scripts/browserDeviceProfile.js:514`, `webapis.productinfo.isUdPanelSupported()`) | PR2 |
| `orsay` | 12 | **PR1** |
| `operaTv` | 12 | **PR1** |
| `edgeUwp` | 25 | **PR1** |
| `window.Windows` / `Windows.*` (pont WinRT, propre à Edge UWP) | 17 | **PR1** |

### 5.1 Inventaire PR1 — Orsay / Opera TV / Edge UWP (avant suppression)

Fichiers et lignes touchés (relevé exhaustif par `grep -rn`, avant édition) :

**`browser.js`** — définitions :
- L.67-72 : `hasKeyboard()`, branche `if (browser.edgeUwp) return true;`
- L.308 : `browser.operaTv = browser.tv && normalizedUA.includes('opr/');`
- L.310-313 : `browser.edgeUwp = (browser.edge || browser.edgeChromium) && (...msapphost/webview...)`
- L.330 : `delete browser.operaTv;` (branche `titanos`)
- L.346 : `browser.orsay = normalizedUA.includes('smarthub');` (branche finale `else`)

**`browser.d.ts`** — L.28, 31, 32 : `edgeUwp`, `orsay`, `operaTv: boolean`.

**`browser.test.ts`** — L.13, 22 : `expect(browser.operaTv).toBeFalsy()` (assertions sur un flag qui
n'existe plus après suppression — testé, pas seulement toujours-vrai par accident).

**`components/apphost.js`** — 11 occurrences réparties sur : `BrowserName.operaTv` (L.18),
`supportsHtmlMediaAutoplay()` (L.216-222), `supportedFeatures` (L.270, 274, 279-284, 312, 316,
331, 337) : `FileDownload`, `Exit`, `ExternalLinks`, `RemoteVideo`, `SubtitleAppearance`,
`SubtitleBurnIn`.

**`scripts/browserDeviceProfile.js`** — 14 occurrences d'`edgeUwp` (`supportsAc3`, `canPlayAudioFormat`,
`testCanPlayMkv`, `testCanPlayTs`, `supportsMpeg2Video`, `supportsVc1`, `supportsAnamorphicVideo`
+ son commentaire mentionnant « Edge UWP (Xbox) » et « operaTv » dans la liste des plateformes non
testées, `getDirectPlayProfileForVideoContainer` ×5, `supportsMp2VideoAudio`, condition
`IsInterlaced`).

**`elements/emby-checkbox/emby-checkbox.js`** — L.27 : `enableRefreshHack`.

**`elements/emby-select/emby-select.js`** — L.11 (`edgeUwp || xboxOne`), L.16 (`orsay`).

**`elements/emby-input/emby-input.js`** — L.65-68 (commentaire « For Samsung orsay devices » +
`document.attachIME`, sans garde explicite) et L.102-108 (`browser.orsay && ... document.attachIME`).
`document.attachIME` est une API propriétaire Samsung Orsay ; confirmé par audit qu'elle n'est
référencée nulle part ailleurs dans `src/`.

**`scripts/keyboardNavigation.js`** — L.290 : `canEnableGamepad()`, `return !browser.edgeUwp;`
(cas particulier, voir §4 et §7.3).

**`apps/legacy/routes/user/settings/index.tsx`** — L.50 : commentaire « gamepad toggle unavailable
on EdgeUWP » (pas de code, juste la documentation à mettre à jour en cohérence avec §7.3).

**`plugins/htmlVideoPlayer/plugin.js`** — constructeur (L.331, nom d'appareil « Windows Video
Player ») + pont WinRT découvert en cours d'audit (hors du grep initial `edgeUwp` car il ne teste
pas ce flag mais le global `window.Windows`, propre à Edge UWP par construction — c'est le seul
moyen d'accès à l'API WinRT dans un contexte web) : `fetchSubtitlesUwp` (L.1348-1356, méthode
entière) + son appel gardé par `window.Windows && itemHelper.isLocalItem(item)` (L.1362-1364), PiP
non-standard (L.2049-2052, L.2135-2145, L.2159-2160, champ `this.isPip`).

**`components/htmlMediaHelper.js`** — `applySrc()` (L.189-207) : branche complète
`window.Windows && options.mediaSource?.IsLocal` créant une `Windows.Media.Playback.MediaPlaybackList`
— partagée par `htmlVideoPlayer` et `htmlAudioPlayer`, donc touchée avec prudence particulière
(chemin de lecture central, voir gates §6/§7.4).

Total avant PR1 : **~25 sites `edgeUwp`, 12 `orsay`, 12 `operaTv`, 17 `window.Windows`/`Windows.*`**
sur 12 fichiers.

### 5.2 Inventaire PR2/3 — webOS / Tizen / webapis (catalogue, non traité dans cette tranche)

Répartition par fichier des 112 + 166 + 1 occurrences restantes après PR1 (comptage post-PR1,
identique au comptage pré-PR1 — preuve que PR1 n'a touché aucune de ces occurrences, voir §7.2) :

| Fichier | Occurrences | Nature |
| --- | --- | --- |
| `src/scripts/browserDeviceProfile.js` | 92 | Profils codec/conteneur/audio par plateforme (cœur du profil de lecture) |
| `src/scripts/browser.js` | 21 | Détection UA, versions (`tizenVersion`, `web0sVersion`), suppression des faux positifs `chrome`/`safari` |
| `src/components/apphost.js` | 11 | `doExit()` (`tizen.application.getCurrentApplication().exit()`, `webOS.platformBack()`), `BrowserName`, `supportedFeatures` |
| `src/scripts/keyboardNavigation.js` | 9 | Touches télécommande `MediaRewind`/`MediaStop`/`MediaPlay`/`MediaFastForward`/`Back`/`MediaTrackPrevious`/`MediaTrackNext` documentées « Tizen/WebOS » |
| `src/plugins/htmlVideoPlayer/plugin.js` | 8 | Contournements lecture (worker relatif Tizen 5, subtitles secondaires Tizen 5, DOVI webOS) |
| `src/components/scrollManager.js` | 5 | 3 comportements de scroll documentés webOS 2/3/4, Tizen 4/5 |
| `src/scripts/browser.d.ts` | 4 | `tizen`, `web0s`, `tizenVersion`, `web0sVersion: boolean/number` |
| `src/elements/emby-checkbox/emby-checkbox.js`, `emby-radio/emby-radio.js` | 3 + 2 | « Real (non-emulator) Tizen does nothing on Space » |
| `src/apps/legacy/features/playback/utils/subtitleStyles.ts` | 3 | « Tizen 5 doesn't support displaying secondary subtitles » |
| `src/components/playbackSettings/playbackSettings.js`, `src/scripts/mouseManager.js`, `src/lib/scroller/index.js`, `src/components/displaySettings/displaySettings.js` | 1-2 chacun | Réglages/segments HLS, souris, scroll spécifiques webOS |
| `src/scripts/settings/appSettings.js` | 1 | `enableSmoothScroll` par défaut `!!browser.tizen` |
| `src/elements/emby-textarea/emby-textarea.js`, `emby-slider/emby-slider.js` | 1 chacun | « descriptor returning null in webos » |
| `src/components/viewContainer.js`, `homesections/homesections.js` | 1 chacun | Timeout pour Custom Elements polyfillés (webOS 1.2) |
| `src/components/dialogHelper/dialogHelper.js` | 1 | « not working well in samsung tizen browser » |
| `src/styles/site.scss`, `fonts.scss`, `components/guide/guide.scss` | 1 chacun | Ligatures de police, taille minimale de police (contraintes d'affichage webOS/Tizen), largeur de conteneur (mentionne aussi « opera tv » en commentaire libre — pas une branche de code, non traité par PR1, à nettoyer en PR2/3 par cohérence) |
| `src/strings/*.json` (~60 fichiers de traduction) | 1 chacun | Chaîne `LimitSegmentLengthHelp` mentionnant « téléviseurs webOS » — **traduction produit, pas du code de détection** ; probablement à garder même si le contournement HLS sous-jacent disparaît, ou à faire évoluer avec le texte, pas à supprimer en bloc |
| `src/assets/img/devices/webos.svg`, `src/utils/image.ts:78-80` | 2 | Icône de session pour le client tiers « Jellyfin for WebOS » — **hors périmètre, explicitement conservé (§2)** |

Note méthode : ce tableau ne prétend pas remplacer un audit ligne-à-ligne au moment de PR2/3 (les
numéros de ligne bougeront avec le temps) — c'est un point de départ chiffré et vérifié à la date de
ce document, à re-grep avant d'exécuter PR2.

---

## 6. Plan de suppression en PR bornées

### PR1 — Orsay / Opera TV / Edge UWP (la plus sûre, **exécutée dans cette tranche W13.2**, voir §7)

Périmètre : §5.1 en intégralité. Aucune touche à `tizen`/`web0s`/`webapis`. Repointage documenté de
`canEnableGamepad()` vers `xboxOne` (§4, §7.3) pour préserver le comportement manette sur Xbox réel.

**Critères de vérification** (§7.4) :
- Re-grep `orsay|operaTv|edgeUwp|window\.Windows|Windows\.` dans `src/` → 0 occurrence.
- Re-grep `tizen|web0s|webos|webapis` → comptage strictement identique à la baseline §5 (preuve de
  non-débordement dans le périmètre PR2).
- `npm run validate` (typecheck + Biome + Stylelint + 204 tests Vitest), `npm run build:production`,
  `npm run verify:bundle-budget`, `npm run verify:reefin-sdk-fresh`.
- Smoke test : bundle servi localement, `index.html` et bundle principal répondent 200 ; limites
  documentées pour lecteur/PDF/EPUB en l'absence de serveur Reefin réel (§7.4).

### PR2 — webOS / Tizen (la suivante, non exécutée dans cette tranche)

Périmètre : §5.2 en intégralité — détection `browser.tizen`/`web0s`/`tizenVersion`/`web0sVersion`,
globals `tizen.*`/`webOS.*`/`webapis.*`, déclarations `browser.d.ts` associées, shims clavier
(`emby-checkbox`/`emby-radio` « Tizen does nothing on Space »), scroll (`scrollManager.js`, 3
comportements webOS/Tizen), Custom Elements (timeouts `viewContainer.js`/`homesections.js`), et la
totalité des branches `browserDeviceProfile.js` (92 occurrences — le plus gros morceau, cœur du
profil de lecture donc le plus sensible en risque de régression codec/conteneur).

**Différence de risque avec PR1** : PR1 ne touchait que des plateformes déjà mortes (aucun
utilisateur actuel). PR2 touche potentiellement des utilisateurs encore actifs sur de vrais
téléviseurs webOS/Tizen accédant à `reefin-web` via un navigateur desktop/mobile classique (pas via
le wrapper natif) — improbable mais pas prouvé nul. Recommandation : confirmer via les analytics
serveur (si disponibles) ou une annonce préalable avant d'exécuter PR2, plutôt que de la traiter
comme aussi sûre que PR1.

**Critères de vérification** :
- Mêmes gates que PR1 (§6 PR1), plus une revue manuelle ligne-à-ligne de `browserDeviceProfile.js`
  (92 occurrences, profils codec) avec un diff avant/après readable — pas un remplacement massif en
  une passe automatique, vu le risque de casser un profil de lecture pour une plateforme encore
  supportée (le fichier mélange constamment `tizen`/`web0s` avec des plateformes hors périmètre comme
  `xboxOne`/`ps4`/`vidaa` dans les mêmes expressions).
- Vérifier explicitement `src/utils/image.ts` et `webos.svg` restent intacts (hors périmètre, §2).
- Mettre à jour `src/scripts/browser.d.ts` (retrait `tizen`, `web0s`, `tizenVersion`, `web0sVersion`)
  et re-vérifier `npm run typecheck`.

### PR3 — Résidus et nettoyage (optionnelle, à évaluer après PR2)

Périmètre : ce qui reste après PR1+PR2 et qui n'était pas assez net pour y être inclus — ex. le
commentaire « opera tv » dans `guide.scss` (§5.2), les chaînes de traduction `LimitSegmentLengthHelp`
si le contournement HLS webOS sous-jacent a disparu en PR2, toute dépendance `package.json` devenue
inutile après PR2 (aucune identifiée à ce stade — contrairement à RFC-0002, cette détection UA/DOM ne
tire aucun paquet npm dédié, vérifié par audit de `package.json`/`webpack.common.js`). PR3 n'est pas
garantie nécessaire : si PR2 ne laisse aucun résidu notable, elle peut être abandonnée.

---

## 7. Exécution PR1 (W13.2)

### 7.1 Résumé

12 fichiers modifiés, **154 lignes supprimées, 33 lignes ajoutées** (net -121 lignes) :

```
 src/apps/legacy/routes/user/settings/index.tsx |  2 +-
 src/components/apphost.js                      | 40 +++++--------------------
 src/components/htmlMediaHelper.js              | 19 +-----------
 src/elements/emby-checkbox/emby-checkbox.js    |  3 +-
 src/elements/emby-input/emby-input.js          | 15 ----------
 src/elements/emby-select/emby-select.js        |  4 +--
 src/plugins/htmlVideoPlayer/plugin.js          | 41 +-------------------------
 src/scripts/browser.d.ts                       |  3 --
 src/scripts/browser.js                         | 18 +----------
 src/scripts/browser.test.ts                    |  2 --
 src/scripts/browserDeviceProfile.js            | 34 ++++++++++-----------
 src/scripts/keyboardNavigation.js              |  6 ++--
 12 files changed, 33 insertions(+), 154 deletions(-)
```

Aucune dépendance `package.json` retirée : audit de `package.json`/`webpack.common.js` confirme
qu'aucun paquet npm n'est dédié à Orsay/Opera TV/Edge UWP (contrairement à RFC-0002 où les polyfills
`lib/legacy` tiraient 10 paquets) — cette détection est uniquement UA-string/DOM, sans empreinte
`node_modules`.

### 7.2 Preuve de non-débordement

| Motif | Avant PR1 | Après PR1 | Delta |
| --- | --- | --- | --- |
| `orsay` | 12 | **0** | -12 |
| `operaTv` | 12 | **0** | -12 |
| `edgeUwp` | 25 | **0** | -25 |
| `window.Windows` / `Windows.*` | 17 | **0** | -17 |
| `tizen` (PR2, témoin) | 112 | **112** | 0 (inchangé) |
| `web0s`/`webos` (PR2, témoin) | 166 | **166** | 0 (inchangé) |
| `webapis` (PR2, témoin) | 1 | **1** | 0 (inchangé) |

Les trois derniers motifs servent de témoin : leur stabilité stricte prouve que PR1 n'a pas empiété
sur le périmètre webOS/Tizen réservé à PR2.

### 7.3 Décision documentée — `canEnableGamepad()`

Cas signalé en §4/§5.1 : `src/scripts/keyboardNavigation.js` gardait l'attache du script générique
`gamepadtokey.js` derrière `!browser.edgeUwp` (« Not needed for UWP » — la manette Xbox en contexte
UWP émet déjà nativement les codes clavier synthétiques `GamepadA`/`GamepadDPadUp`/etc. via
`KeyNames`, donc activer en plus l'adaptateur Gamepad API générique aurait doublé la prise en charge
des entrées). Audit croisé avec `browser.js` (`uaMatch`) et `browser.test.ts` : un vrai Xbox actuel
(Edge Chromium + `WebView2` dans l'UA) active **simultanément** `browser.xboxOne` et
`browser.edgeUwp`. Supprimer purement `edgeUwp` sans repointer aurait donc réintroduit un double
traitement des entrées manette sur Xbox réel — régression sur l'UX générique que ce RFC doit
préserver (§1 point 2). Correction appliquée : la condition est repointée sur `!browser.xboxOne`
(hors périmètre de suppression, Xbox reste supporté), avec commentaire mis à jour expliquant le
« pourquoi ». Le commentaire de `src/apps/legacy/routes/user/settings/index.tsx:50` (« gamepad toggle
unavailable on EdgeUWP ») est corrigé en cohérence (« unavailable on Xbox »).

Aucun autre cas de ce type n'a été trouvé : tous les autres sites `edgeUwp`/`orsay`/`operaTv` étaient
des termes supprimables dans une expression booléenne plus large sans changer le sens des autres
termes (principe énoncé en §4).

### 7.4 Gates exécutées (100% local, quota GitHub Actions épuisé)

| Gate | Résultat |
| --- | --- |
| `npm run typecheck` (`tsc --noEmit`) | **0 erreur** |
| `npm run lint` (Biome, via `./node_modules/.bin/biome check .`) | **0 erreur, 278 warnings** — identique au compte de clôture W13.1 (RFC-0002 §7), aucun warning nouveau introduit |
| `npm run stylelint` | **0 erreur** |
| `npm test` (Vitest) | **204/204 tests verts**, 19 fichiers, y compris `browser.test.ts` mis à jour |
| `npm run build:production` | **Succès**, `webpack 5.108.4 compiled successfully` |
| `npm run verify:bundle-budget` | **PASS** — `main.jellyfin.bundle.js` : 390 460 octets (381,3 KiB), budget 460 800 octets (450 KiB) ; contre 391 552 octets (382,4 KiB) en clôture W13.1 → **-1 092 octets** (gain modeste attendu : suppression de branches mortes, pas de dépendances) |
| `npm run verify:reefin-sdk-fresh` | **PASS** — `generated/` inchangé, aucune dérive |
| `npm run validate` (agrégat des 4 premiers) | **Succès** (exit 0) |

**Smoke test manuel** — `npx http-server dist -p 8973` puis `curl` :
- `index.html` → **HTTP 200**, contenu HTML attendu.
- `main.jellyfin.bundle.js` → **HTTP 200**, taille 390 460 octets (cohérente avec le budget mesuré).
- Présence confirmée dans `dist/libraries/` de `pdf.worker.js` (aperçu PDF) et `libarchive.wasm`
  (lecture d'archives, chemin utilisé pour l'EPUB/CBZ) — les fichiers statiques nécessaires sont bien
  émis par le build.
- **Limite assumée** : aucun serveur Reefin réel n'est disponible dans cet environnement pour
  s'authentifier et déclencher une vraie lecture vidéo/PDF/EPUB de bout en bout. Le smoke test ne
  prouve donc que « le bundle se sert et contient les artefacts attendus », pas « la lecture
  fonctionne en conditions réelles ». Le changement le plus sensible pour ce risque résiduel est
  `htmlMediaHelper.js#applySrc()` (chemin de lecture central, modifié pour retirer la branche WinRT) —
  son comportement pour tout appareil non-Edge-UWP est strictement inchangé (`elem.src = src`, déjà le
  chemin `else` avant ce RFC), donc le risque est concentré sur un cas déjà hors périmètre (Edge UWP)
  plutôt que sur le chemin generique. À vérifier manuellement en conditions réelles avant merge en
  production si un serveur de test est disponible.

---

## 8. Questions ouvertes

1. **Timing de PR2** : faut-il un signal (analytics serveur, annonce publique) avant de retirer la
   détection webOS/Tizen, étant donné que — contrairement à Orsay/Opera TV/Edge UWP — des
   utilisateurs pourraient encore accéder à `reefin-web` depuis un navigateur embarqué sur ces
   téléviseurs (pas nécessairement via le wrapper natif retiré par RFC-0002) ?
2. **`src/components/guide/guide.scss:171`** mentionne « opera tv » dans un commentaire libre (pas de
   code conditionnel) — non traité par PR1 (hors grep ciblé `operatv`, trouvé seulement via l'audit
   large tizen/webos). À nettoyer en PR2/3 par cohérence documentaire, sans urgence.
3. **Chaînes de traduction `LimitSegmentLengthHelp`** (~60 fichiers `src/strings/*.json`) mentionnant
   « téléviseurs webOS » : si PR2 retire le contournement HLS sous-jacent
   (`userSettings.limitSegmentLength()` / `playbackSettings.js:286-287`), faut-il aussi faire évoluer
   ce texte, ou le garder tel quel si le réglage reste utile pour d'autres cas ? Non tranché ici.
4. **Étendue exacte de PR3** : dépend entièrement de ce que PR2 laisse comme résidu — ce RFC ne
   préjuge pas qu'elle sera nécessaire (§6).
