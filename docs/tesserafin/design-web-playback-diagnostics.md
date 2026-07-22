# Design — Page de diagnostics de lecture (Reefin Web)

- **Statut** : Draft
- **Date** : 2026-07-16
- **Auteur** : Reefin Team
- **Dépôt** : `reefin-web`
- **Dépend de** : `RFC-0001-vision-and-feasibility.md` (§1.3, §6.4, §7 phase 2) ; côté serveur `reefin` :
  `docs/pr91-rfc-playback-decision-v2.md` (PR91) et `docs/pr92-design-playback-api-and-diagnostics.md` (PR92)
- **Portée** : design d'implémentation concret. Aucun code produit par ce document — squelette de
  route, contrat TypeScript, plan de PRs.

---

## 1. Contexte

RFC-0001 §7 (phase 2) pose comme jalon concret : *« page de diagnostics de lecture côté admin,
alignée sur le contrat `PlaybackDiagnosticDetail` de PR92 (...) — premier cas d'usage concret de la
couche API [typée Reefin] et premier écran qui n'a aucune dépendance à `playbackmanager.js` »*.

Ce document répond à trois questions avant tout code :

1. Le contrat serveur décrit par PR91/PR92 est-il un design papier ou du code réel aujourd'hui ?
2. Où et comment cette page doit-elle vivre dans `reefin-web`, en cohérence avec l'existant
   (`src/apps/dashboard`) ?
3. Quel est le plan de PRs le plus court pour livrer une première tranche verticale utile ?

---

## 2. État réel de l'implémentation serveur (constat vérifié)

**Verdict : implémenté, pas seulement conçu.** PR91 et PR92 se présentaient explicitement comme
« design uniquement, aucun code de production » au moment de leur rédaction, mais le dépôt `reefin`
contient aujourd'hui une implémentation complète et testée du domaine de décision (PR94/96/97), de
l'adaptateur legacy (PR95), du shadow mode (PR98/100/111), et des deux contrôleurs/DTO réseau
décrits en PR92 (PR112/PR113). C'est plus avancé que ce que RFC-0001 §7 supposait (« dès leur
disponibilité serveur (PR112) » — PR112 **et** PR113 sont faits).

### 2.1 Domaine de décision (PR91) — implémenté

`src/Reefin.Playback.Decision/` (dépôt `reefin`) contient les cinq objets de domaine et tout le
vocabulaire associé, chacun avec sa XMLdoc alignée sur PR91 §3 :

| Objet PR91 | Fichier | État |
| --- | --- | --- |
| `PlaybackRequestContext` | `PlaybackRequestContext.cs` | Implémenté |
| `ClientCapabilities` (+ `DecodeCapabilities`, `PlaybackOutputProfile`) | `ClientCapabilities.cs`, `DecodeCapabilities.cs`, `PlaybackOutputProfile.cs` | Implémenté (a divergé positivement de PR91 : split decode/output décrit dans les remarks de `ClientCapabilities.cs`, PR102) |
| `MediaSourceSnapshot` (+ streams) | `MediaSourceSnapshot.cs`, `VideoStreamSnapshot.cs`, `AudioStreamSnapshot.cs`, `SubtitleStreamSnapshot.cs` | Implémenté |
| `PlaybackConstraints` | `PlaybackConstraints.cs` | Implémenté |
| `PlaybackDecision` (+ `ReasonNode`, `ReasonCode`, `TransformKind`) | `PlaybackDecision.cs`, `ReasonNode.cs`, `ReasonCode.cs`, `TransformKind.cs` | Implémenté |

Le test d'architecture prévu par PR91 §3 (« interdit d'importer `Reefin.Model.Dlna` ») existe :
`tests/Reefin.Playback.Decision.Tests/ArchitectureTests.cs`.

### 2.2 API réseau (PR92) — implémentée

`Reefin.Api/Controllers/` :

- `PlaybackSessionsController.cs` — route client `Playback/Sessions`, `[Authorize]` (pas
  d'élévation). `POST` (créer), `PUT /{id}` (remplacer intégralement), `DELETE /{id}`. Exactement
  la séparation POST/PUT/PATCH-réservé décidée en PR92 §3.
- `PlaybackDiagnosticsSessionsController.cs` — route admin
  `System/PlaybackDiagnostics/Sessions`, `[Authorize(Policy = Policies.RequiresElevation)]`.
  `GET` (liste), `GET /{id}` (détail), et **en plus de PR92** : `GET /{id}/Fixture` (export d'un
  cas de test au format `tests/PlaybackCompat/schema/fixture.schema.json`, PR113b — correspond à
  l'action « Exporter le cas de test » du wireframe PR92 §5).

DTOs dans `Reefin.Api/Models/PlaybackSessionDtos/` : `PlaybackSessionResponse.cs`,
`PlaybackDiagnosticDetail.cs`, `PlaybackSessionListItem.cs`, `DiagnosticComparison.cs`,
`DiagnosticTimelineEntry.cs`, `CreatePlaybackSessionRequest.cs`, `ReplacePlaybackSessionRequest.cs`.
Aucun ne référence `DeviceProfile`/`MediaOptions`/`StreamInfo`/`PlaybackSession` interne — la règle
PR92 §4 est respectée et vérifiée par les tests (`PlaybackSessionResponseMapperTests.cs`,
`PlaybackCompatFixtureExporterTests.cs`).

### 2.3 Ce qui n'est *pas* encore vrai en production — à concevoir en connaissance de cause

Ces points ne bloquent pas la page, mais déterminent ce qu'elle affichera par défaut :

1. **Le moteur v2 n'est pas la source de vérité.** `PlaybackSessionResponse.DecisionVersion` est
   toujours `LegacyDecisionVersion` (= `0`) tant que PR115 (bascule feature-flag/canary, non
   commencée) n'est pas faite — voir la XMLdoc de `PlaybackSessionResponse.cs` L17-25. Le legacy
   planner reste la vérité ; le moteur v2 ne tourne qu'en *shadow*.
2. **Le shadow mode est désactivé par défaut.** `ShadowPlaybackSessionPlanner.cs` L154-155 :
   `if (!shadowOptions.Enabled) { ... }` court-circuite le calcul v2. Conséquence directe pour
   cette page : sur une instance Reefin par défaut, `PlaybackDiagnosticDetail.RequestContext`,
   `.Capabilities`, `.SourceSnapshot`, `.Reasoning`, `.Comparison` seront **tous `null`**, et
   `PlaybackSessionListItem.HasDiagnostic` sera `false` pour toutes les sessions. Seuls
   `Method`/`Output`/`SelectedStreams`/`Transforms`/`Reasons` (dérivés du legacy) sont toujours
   disponibles. C'est un état normal, pas une erreur — la page doit le traiter comme tel (§5.4).
3. **Les champs dérivés du legacy sont approximatifs, documenté comme tel.**
   `PlaybackSessionResponseMapper.cs` L26-32 : `Transforms` est *best-effort* (legacy n'a pas de
   vocabulaire de transformation explicite) et `SelectedStreams.Video` est **toujours `null`** pour
   une session sourcée du legacy (`StreamInfo` n'expose pas d'index vidéo sélectionné fiable). De
   même, `Reasons` ne peut porter que les codes qui ont un bit `TranscodeReason` legacy équivalent
   — jamais les codes positifs (`MethodChosen`, `TonemapRequired`, etc.) pour une session
   legacy-sourcée. La page doit distinguer visuellement « donnée absente car legacy » de « donnée
   absente car réellement nulle ».
4. Activer le shadow mode est une **configuration serveur** (`PlaybackShadowOptions`, hors
   contrôleurs/DTO réseau) — hors périmètre de cette page. La page se contente de refléter fidèlement
   ce que l'API renvoie ; elle n'ajoute pas de bouton « activer le shadow mode » (ce serait une
   fonctionnalité serveur déguisée en fonctionnalité web, contraire à RFC-0001 pilier 2 : « le gros
   du travail est côté serveur »).

**Conclusion pour ce design** : contrairement à l'hypothèse de RFC-0001 §7 (« bloqué tant que PR112
n'est pas livré »), rien ne bloque le développement web. Le contrat est stable, testé, et
interrogeable dès aujourd'hui contre un serveur `reefin` réel — y compris en environnement de
développement local sans shadow mode (avec un état « pas de diagnostic disponible » comme cas
nominal, pas comme cas d'erreur).

---

## 3. Objectif utilisateur

Un administrateur consulte cette page pour répondre, dans cet ordre de priorité :

1. **« Pourquoi cette lecture transcode-t-elle (ou pas) ? »** — méthode retenue (Direct Play / Remux
   / Transcode), et pour une session shadow-diagnostiquée, la trace de raisonnement complète
   (`ReasonNode`), pas juste une liste de codes.
2. **« Que reçoit le client au final ? »** — conteneur/codecs/résolution de sortie, streams
   sélectionnés, transformations pipeline (`Transforms`).
3. **« Le nouveau moteur (v2) fait-il différemment de l'ancien, et est-ce grave ? »** — comparaison
   `LegacyMethod` vs méthode v2, classée (`DivergenceClass`), quand un diagnostic shadow est
   retenu.
4. **« Puis-je obtenir ce cas pour un ticket de support ou pour le labo de compatibilité ? »** —
   copier le JSON filtré, exporter la fixture (`GET .../Fixture`).

Non-objectif de cette page (RFC-0001 pilier 2) : détecter le matériel, lancer des bancs d'essai de
transcodage, ou configurer l'accélération matérielle — cela dépend de RFC-0001 §9 question 5 (RFC
serveur non encore écrit), traité dans une tranche ultérieure de la phase 3.

---

## 4. Contrat API consommé

### 4.1 Endpoints (tous réels, implémentés et testés dans le dépôt `reefin`)

| Verbe/route | Contrôleur | Politique | Usage page |
| --- | --- | --- | --- |
| `GET /System/PlaybackDiagnostics/Sessions` | `PlaybackDiagnosticsSessionsController` | `RequiresElevation` | Liste des sessions suivies |
| `GET /System/PlaybackDiagnostics/Sessions/{id}` | idem | `RequiresElevation` | Détail diagnostic d'une session |
| `GET /System/PlaybackDiagnostics/Sessions/{id}/Fixture` | idem | `RequiresElevation` | Action « Exporter le cas de test » (téléchargement JSON) |

Pas d'appel `POST`/`PUT`/`DELETE` sur `Playback/Sessions` depuis cette page — c'est le protocole
client de lecture, pas l'outil d'observation admin (frontière volontaire posée par PR92 §2).

### 4.2 Sérialisation

L'API ASP.NET Core de `reefin` sérialise en **PascalCase par défaut** (confirmé par le commentaire
de `PlaybackDiagnosticsSessionsController.ExportFixture`, qui doit explicitement forcer camelCase
*seulement* pour la route `/Fixture` parce que « the schema requires camelCase regardless of what
an admin client's Accept header might otherwise negotiate » — implication directe : toutes les
*autres* routes restent PascalCase). Les DTO TypeScript ci-dessous utilisent donc des clés
PascalCase, comme le reste des DTO `@jellyfin/sdk` déjà consommés dans le dépôt (ex.
`FolderStorageDto.FreeSpace` dans `src/apps/dashboard/features/storage`).

### 4.3 DTOs TypeScript (miroir 1:1 des `record` C#)

Ces types n'existent pas dans `@jellyfin/sdk` (généré depuis l'API Jellyfin stock — ces routes sont
propres à Reefin) : ils doivent être maintenus à la main dans `reefin-web`, en miroir manuel des
fichiers C# cités, jusqu'à ce que RFC-0001 §9 Q2 tranche la génération OpenAPI automatique.

```ts
// src/apps/dashboard/features/playback/api/types.ts
// Miroir manuel de Reefin.Playback.Decision + Reefin.Api.Models.PlaybackSessionDtos
// (dépôt `reefin`). Garder synchronisé à la main tant que RFC-0001 §9 Q2 n'est pas tranchée.

export type MediaKind = 'Audio' | 'Video';
export type PlaybackMethod = 'DirectPlay' | 'Remux' | 'Transcode';
export type StreamingProtocol = 'Http' | 'Hls';
export type SubtitleDeliveryMethod = 'Embed' | 'External' | 'Burn' | 'Hls';

export type TransformKind =
  | 'RemuxContainer' | 'TranscodeVideo' | 'TranscodeAudio' | 'CopyVideo' | 'CopyAudio'
  | 'Downmix' | 'Tonemap' | 'BurnInSubtitle' | 'ExtractSubtitle' | 'ConvertSubtitle';

export type ReasonCode =
  | 'ContainerNotSupported' | 'VideoCodecNotSupported' | 'AudioCodecNotSupported'
  | 'SubtitleCodecNotSupported' | 'AudioIsExternal' | 'SecondaryAudioNotSupported'
  | 'StreamCountExceedsLimit' | 'VideoProfileNotSupported' | 'VideoRangeTypeNotSupported'
  | 'VideoCodecTagNotSupported' | 'VideoLevelNotSupported' | 'VideoResolutionNotSupported'
  | 'VideoBitDepthNotSupported' | 'VideoFramerateNotSupported' | 'VideoRotationNotSupported'
  | 'RefFramesNotSupported' | 'AnamorphicVideoNotSupported' | 'InterlacedVideoNotSupported'
  | 'AudioChannelsNotSupported' | 'AudioProfileNotSupported' | 'AudioSampleRateNotSupported'
  | 'AudioBitDepthNotSupported' | 'ContainerBitrateExceedsLimit' | 'VideoBitrateNotSupported'
  | 'AudioBitrateNotSupported' | 'UnknownVideoStreamInfo' | 'UnknownAudioStreamInfo'
  | 'DirectPlayError' | 'StreamCopyable' | 'SourceSelected' | 'MethodChosen'
  | 'SubtitleBurnInRequired' | 'SubtitleFormatConverted' | 'DownmixRequired' | 'TonemapRequired'
  | 'NoViablePlan' | 'OutputProfileFallbackUsed' | 'RequestedSourceNotFound';

export type ReasonOutcome = 'Rejected' | 'Accepted' | 'Chosen';
export type ReasonSubjectKind = 'Container' | 'VideoStream' | 'AudioStream' | 'Subtitle' | 'Source' | 'Method';
export type DivergenceClass =
  | 'Equivalent' | 'ExpectedImprovement' | 'KnownV2Limitation' | 'PotentialRegression' | 'Unexplained';

export interface Resolution { Width: number; Height: number }

export interface OutputSpec {
  Container: string | null;
  VideoCodec: string | null;
  AudioCodec: string | null;
  Resolution: Resolution | null;
  VideoRange: string | null;
  AudioChannels: number | null;
  TotalBitrate: number | null;
  VideoBitrate: number | null;
  AudioBitrate: number | null;
  Protocol: StreamingProtocol;
  SubtitleFormat: string | null;
}

export interface SelectedSubtitle { Index: number; Delivery: SubtitleDeliveryMethod }

export interface SelectedStreams {
  Video: number | null;
  Audio: number | null;
  Subtitle: SelectedSubtitle | null;
}

/** docs/pr92-design-playback-api-and-diagnostics.md §4.2 — réponse client stable, jamais
 * StreamInfo/DeviceProfile/MediaOptions. */
export interface PlaybackSessionResponse {
  Id: string; // GUID
  Kind: MediaKind;
  /** 0 = LegacyDecisionVersion (sentinel — source legacy tant que PR115 n'est pas livré). */
  DecisionVersion: number;
  Method: PlaybackMethod;
  Output: OutputSpec;
  SelectedStreams: SelectedStreams;
  Transforms: TransformKind[];
  Reasons: ReasonCode[];
  CreatedAt: string; // ISO 8601
  UpdatedAt: string;
}

export interface PlaybackSessionListItem {
  Session: PlaybackSessionResponse;
  /** false pour la quasi-totalité des sessions tant que le shadow mode serveur est désactivé (défaut). */
  HasDiagnostic: boolean;
}

export interface ReasonSubject {
  Kind: ReasonSubjectKind;
  StreamIndex: number | null;
  SourceId: string | null;
}

export interface ReasonNode {
  Code: ReasonCode;
  Outcome: ReasonOutcome;
  Subject: ReasonSubject;
  Detail: string | null;
  Children: ReasonNode[];
}

export interface PlaybackRequestContext {
  RequestId: string;
  ItemId: string;
  MediaSourceId: string | null;
  UserId: string;
  MediaKind: MediaKind;
  RequestedAt: string;
  EngineVersion: number;
}

export interface DecodeProfileLike { /* forme brute encore instable côté serveur — traiter en opaque/unknown côté UI */ }

export interface ClientCapabilities {
  Decode: {
    DirectPlayProfiles: unknown[];
    VideoCodecs: Array<{
      Codec: string; Profiles: string[]; MaxLevel: number | null; MaxBitDepth: number | null;
      VideoRangeTypes: string[]; MaxResolution: Resolution | null; MaxBitrate: number | null;
    }>;
    AudioCodecs: Array<{
      Codec: string; MaxChannels: number | null; MaxSampleRate: number | null;
      MaxBitDepth: number | null; MaxBitrate: number | null;
    }>;
    SubtitleDelivery: Array<{ Format: string; Method: SubtitleDeliveryMethod }>;
    SupportsHls: boolean;
    SupportsDash: boolean;
  };
  OutputProfiles: Array<{
    Type: MediaKind; Protocol: StreamingProtocol; Container: string;
    VideoCodecs: string[]; AudioCodecs: string[];
    MaxVideoBitrate: number | null; MaxAudioBitrate: number | null; MaxAudioChannels: number | null;
  }>;
}

export interface VideoStreamSnapshot {
  Index: number; Codec: string; Profile: string | null; Level: number | null;
  Width: number | null; Height: number | null; BitDepth: number | null; VideoRange: string | null;
  Framerate: number | null; Bitrate: number | null; IsAnamorphic: boolean; IsInterlaced: boolean;
}

export interface AudioStreamSnapshot {
  Index: number; Codec: string; Channels: number | null; SampleRate: number | null;
  BitDepth: number | null; Bitrate: number | null; Language: string | null; IsDefault: boolean;
}

export interface SubtitleStreamSnapshot {
  Index: number; Format: string; IsExternal: boolean; IsForced: boolean;
  IsDefault: boolean; Language: string | null;
}

export interface MediaSourceSnapshot {
  MediaSourceId: string; Container: string; Protocol: string;
  Bitrate: number | null; RunTimeTicks: number | null;
  VideoStreams: VideoStreamSnapshot[];
  AudioStreams: AudioStreamSnapshot[];
  SubtitleStreams: SubtitleStreamSnapshot[];
  SupportsDirectPlay: boolean; SupportsDirectStream: boolean; SupportsTranscoding: boolean;
}

export interface DiagnosticComparison {
  LegacyMethod: PlaybackMethod;
  LegacyReasons: ReasonCode[];
  DivergenceClass: DivergenceClass;
}

export type DiagnosticTimelineStage = 'Created' | 'Updated' | 'FfmpegStarted' | 'PlaybackStarted' | 'PlaybackStopped';

export interface DiagnosticTimelineEntry { Stage: DiagnosticTimelineStage; At: string }

/** docs/pr92-design-playback-api-and-diagnostics.md §4.3 — projection admin filtrée, riche mais
 * jamais de Path/TranscodingUrl/token/args ffmpeg. Champs nullable = pas de diagnostic shadow
 * retenu pour cette session (cas nominal si le shadow mode serveur est désactivé). */
export interface PlaybackDiagnosticDetail extends PlaybackSessionResponse {
  RequestContext: PlaybackRequestContext | null;
  Capabilities: ClientCapabilities | null;
  SourceSnapshot: MediaSourceSnapshot[] | null;
  Reasoning: ReasonNode | null;
  Comparison: DiagnosticComparison | null;
  Timeline: DiagnosticTimelineEntry[];
}
```

### 4.4 Client API typé — pattern à suivre

Aucun client existant ne couvre ces routes (elles ne sont pas dans `@jellyfin/sdk`, généré côté
Jellyfin upstream). Le dépôt a déjà deux précédents pour ce cas exact — un appel brut à une route
qui n'existe pas dans le SDK généré :

- `src/utils/bitrateTest.ts` L45-64 : appel direct à `api.basePath + '/Playback/BitrateTest'` (une
  route Jellyfin non couverte par le SDK), en-tête `'Authorization': api.authorizationHeader`
  attaché à la main. C'est le précédent le plus proche de notre cas (route hors SDK, auth manuelle
  explicite) — la propriété `api.authorizationHeader` existe et est déjà exercée en production dans
  ce dépôt.
- `src/utils/sdk/authentication-api.ts` : construit un client miroir avec
  `new AuthenticationApi(api.configuration, undefined, api.axiosInstance)` en attendant que le SDK
  officiel absorbe le endpoint — utile si on préfère un jour une classe générée plutôt que des
  fonctions, mais l'auth y est gérée en interne par la classe, pas manuellement.

On suit le pattern `bitrateTest.ts` (fonctions typées sur `api.axiosInstance`/`api.basePath`/
`api.authorizationHeader`, pas de classe générée) puisque ces routes Reefin n'ont pas d'équivalent
de classe SDK à imiter :

```ts
// src/apps/dashboard/features/playback/api/playbackDiagnosticsApi.ts
import type { Api } from '@jellyfin/sdk';
import type {
  PlaybackDiagnosticDetail,
  PlaybackSessionListItem
} from './types';

const BASE = '/System/PlaybackDiagnostics/Sessions';

export async function fetchPlaybackSessions(
  api: Api,
  signal?: AbortSignal
): Promise<PlaybackSessionListItem[]> {
  const { data } = await api.axiosInstance.get<PlaybackSessionListItem[]>(
    `${api.basePath}${BASE}`,
    { headers: { Authorization: api.authorizationHeader }, signal }
  );
  return data;
}

export async function fetchPlaybackSessionDetail(
  api: Api,
  id: string,
  signal?: AbortSignal
): Promise<PlaybackDiagnosticDetail> {
  const { data } = await api.axiosInstance.get<PlaybackDiagnosticDetail>(
    `${api.basePath}${BASE}/${id}`,
    { headers: { Authorization: api.authorizationHeader }, signal }
  );
  return data;
}

export async function fetchPlaybackSessionFixture(api: Api, id: string): Promise<Blob> {
  const { data } = await api.axiosInstance.get(
    `${api.basePath}${BASE}/${id}/Fixture`,
    { headers: { Authorization: api.authorizationHeader }, responseType: 'blob' }
  );
  return data;
}
```

Ce module est le premier élément concret de la « couche API Reefin typée » de RFC-0001 §6.4. Il vit
dans `features/playback/api/` plutôt que dans un `src/lib/reefin-apiclient/` central pour l'instant
— RFC-0001 §9 Q2 n'a pas tranché la stratégie de génération, et créer une lib partagée avant d'avoir
un deuxième consommateur serait prématuré. Si un deuxième endpoint Reefin (hors playback) apparaît
avant la fin de la phase 2, ce module se déplace vers un dossier partagé — décision à documenter
dans la PR qui le fait, pas anticipée ici.

---

## 5. Architecture UI

### 5.1 Emplacement de la route

Suit exactement le pattern déjà en place pour `playback/streaming`, `playback/transcoding`, etc.
(`src/apps/dashboard/routes/_asyncRoutes.ts` L21-24) :

```ts
// src/apps/dashboard/routes/_asyncRoutes.ts — ajout
{ path: 'playback/diagnostics', type: AppType.Dashboard },
```

Route finale : `/dashboard/playback/diagnostics` (préfixe `dashboard/` ajouté par
`DASHBOARD_APP_ROUTES`, cf. `routes/routes.tsx`). Gating admin déjà assuré par
`<ConnectionRequired level='admin' />` au niveau du parent — pas de garde supplémentaire à écrire,
cohérent avec la policy serveur `RequiresElevation`.

Fichier de page : `src/apps/dashboard/routes/playback/diagnostics.tsx` (chargé en lazy via
`toAsyncPageRoute`, comme toutes les routes `AppType.Dashboard`).

### 5.2 Arborescence de fichiers proposée

```
src/apps/dashboard/
  routes/playback/
    diagnostics.tsx                       # page liste (Component exporté, lazy-loadé)
  features/playback/
    api/
      types.ts                            # §4.3
      playbackDiagnosticsApi.ts           # §4.4
      usePlaybackSessions.ts              # useQuery liste, polling léger
      usePlaybackSessionDetail.ts         # useQuery détail, enabled sur sélection
      useExportFixture.ts                 # useMutation (téléchargement fichier)
    components/
      PlaybackSessionsTable.tsx           # MaterialReactTable via TablePage (pattern existant)
      PlaybackMethodChip.tsx              # badge DirectPlay/Remux/Transcode
      DiagnosticDrawer.tsx                # panneau détail (ouvert au clic sur une ligne)
      ReasonTree.tsx                      # rendu récursif de ReasonNode
      DiagnosticTimeline.tsx              # rendu de DiagnosticTimelineEntry[]
      DivergenceBadge.tsx                 # rendu de DivergenceClass
      NoDiagnosticNotice.tsx              # état "shadow mode indisponible pour cette session"
    utils/
      formatOutputSpec.ts                 # OutputSpec -> résumé lisible (pur, testable)
      formatReasonCode.ts                 # ReasonCode -> libellé i18n (pur, testable)
    constants/
      i18n strings (via globalize, cf. §6)
```

Ce découpage `api/ components/ utils/ constants/` reproduit exactement l'organisation déjà utilisée
par `features/devices`, `features/sessions`, `features/storage` — c'est la structure que RFC-0001
§6.3 désigne comme référence directe.

### 5.3 Composants et flux

- **Page liste** (`diagnostics.tsx`) : `Page` + `TablePage` (comme `TablePage.tsx` déjà utilisé
  ailleurs dans le dashboard) avec `MaterialReactTable`, alimentée par `usePlaybackSessions()`.
  Colonnes : Kind, Method (`PlaybackMethodChip`), Output (résumé via `formatOutputSpec`),
  CreatedAt/UpdatedAt, `HasDiagnostic` (icône). Clic sur une ligne ouvre `DiagnosticDrawer` pour
  cette session (id) sans navigation — évite de dupliquer l'état de liste.
- **Panneau détail** (`DiagnosticDrawer.tsx`) : `usePlaybackSessionDetail(id)`. Sections dans
  l'ordre du wireframe PR92 §5 : Décision (Method/Output/SelectedStreams/Transforms/Reasons,
  toujours disponibles) → Source (`SourceSnapshot`, nullable) → Raisonnement (`ReasonTree`,
  nullable) → Timeline (`DiagnosticTimeline`, toujours au moins `Created`) → Comparaison
  (`DivergenceBadge` + `LegacyMethod`/`LegacyReasons`, nullable). Actions en pied de panneau :
  « Copier le diagnostic » (JSON.stringify du DTO déjà filtré côté serveur, `navigator.clipboard`)
  et « Exporter le cas de test » (`useExportFixture`, déclenche un téléchargement de blob) —
  désactivée si `HasDiagnostic` est `false` (le serveur renvoie 422 sinon, cf.
  `PlaybackDiagnosticsSessionsController.ExportFixture` L111-114).
- **`ReasonTree.tsx`** : composant récursif simple (`ReasonNode.Children`), pas de librairie de
  visualisation d'arbre — la profondeur observée dans l'exemple normatif PR91 §5 est de 3-4 niveaux,
  une liste imbriquée indentée (`<ul>`/`<li>` stylée MUI) suffit et reste accessible clavier sans
  effort supplémentaire (cohérent avec le principe d'accessibilité "dès la conception" de RFC-0001
  pilier 1).

### 5.4 États

| État | Déclencheur | Traitement |
| --- | --- | --- |
| Chargement liste | `usePlaybackSessions().isPending` | `Loading` (composant existant `components/loading/LoadingComponent`) |
| Erreur liste | `isError` (ex. 403 si policy mal configurée, réseau) | `Alert severity="error"`, message i18n dédié |
| Liste vide | `data.length === 0` | Message neutre : « Aucune session de lecture active actuellement » — pas une erreur |
| Session sans diagnostic (`HasDiagnostic: false`) | valeur du champ, cas **nominal** par défaut (§2.3) | `NoDiagnosticNotice` : explique que le mode shadow n'est pas activé côté serveur pour cette session/instance, affiche quand même Method/Output/Transforms/Reasons (toujours dispo) |
| Détail en chargement | `usePlaybackSessionDetail().isPending` | Skeleton dans le drawer, pas un spinner plein écran (la liste reste utilisable) |
| Détail 404 (session terminée entre-temps) | `isError` avec statut 404 | Fermer le drawer, message toast, invalider la query liste |
| Export fixture 422 | mutation error | Toast explicite : « pas de diagnostic retenu pour cette session » (miroir exact du message serveur) |

### 5.5 Aucune dépendance à `playbackmanager.js`

Vérification explicite (RFC-0001 §7 l'exige comme critère de cette tranche) : tous les appels
passent par `useApi()` (`hooks/useApi.tsx`, déjà utilisé par `useSessions`/`useDevices`) pour
obtenir l'instance `Api` du SDK, jamais par `ServerConnections`/`playbackmanager` pour la logique de
lecture elle-même. `ServerConnections` n'intervient que via `useApi` pour la résolution de session
utilisateur — le même mécanisme que toutes les routes `features/*` existantes, pas un accès à
`playbackmanager.js`. Cette page est un bon candidat de test pour le principe : si une revue de code
trouve un import de `components/playback/playbackmanager` ici, c'est un signal d'alerte immédiat.

---

## 6. Plan d'implémentation (PR-sized)

Rien n'est bloqué côté serveur (§2). Le découpage est donc guidé par la taille de revue, pas par des
dépendances externes.

**PR1 — Couche API typée + liste (aucun blocage)**
- `features/playback/api/types.ts`, `playbackDiagnosticsApi.ts`, `usePlaybackSessions.ts`.
- Route `playback/diagnostics` enregistrée, page liste fonctionnelle (`PlaybackSessionsTable`,
  `PlaybackMethodChip`, `formatOutputSpec`).
- États loading/erreur/vide de la liste (§5.4, lignes 1-3).
- Testable immédiatement contre un serveur `reefin` de dev réel, avec ou sans shadow mode activé.

**PR2 — Détail diagnostic**
- `usePlaybackSessionDetail.ts`, `DiagnosticDrawer.tsx`, `ReasonTree.tsx`, `DiagnosticTimeline.tsx`,
  `DivergenceBadge.tsx`, `NoDiagnosticNotice.tsx`.
- États 4-6 du tableau §5.4.
- Dépend de PR1 (route + liste doivent exister pour ouvrir un détail), pas du serveur.

**PR3 — Actions (copier / exporter) + i18n + polish**
- `useExportFixture.ts`, bouton copier, chaînes `globalize` (nouvelles clés dans `src/strings/`,
  suivant la convention existante — voir les clés `TabStreaming`/`LabelRemoteClientBitrateLimit`
  utilisées par `routes/playback/streaming.tsx`).
- État 7 du tableau §5.4.
- Revue d'accessibilité clavier sur `ReasonTree` et le drawer (focus trap, `aria-expanded`).

**Rien n'est repoussé faute de serveur.** Seule extension explicitement hors périmètre et non
planifiée ici : un contrôle web pour activer/désactiver le shadow mode serveur (§2.3 point 4) — si
un besoin réel apparaît, il doit passer par son propre design (probablement `dashboard/settings`,
pas cette page) plutôt que d'être ajouté opportunistement ici.

---

## 7. Stratégie de tests

Constat sur l'outillage existant : `vitest` est configuré (`vite.config.ts`, environnement `jsdom`),
mais **aucune dépendance `@testing-library/react` ni `msw` n'est présente dans `package.json`** — le
seul test actuellement présent dans `apps/dashboard` (`features/storage/utils/space.test.ts`) est un
test de fonction pure, pas un test de composant. C'est le pattern à suivre en priorité plutôt que
d'introduire de nouvelles dépendances de test dans la même PR qu'une fonctionnalité produit.

1. **Unitaire, fonctions pures (prioritaire, sans nouvelle dépendance)** : `formatOutputSpec.ts`,
   `formatReasonCode.ts`, et toute logique de dérivation (ex. calcul du libellé de
   `DivergenceClass`, tri/regroupement de `ReasonNode.Children`). Même style que `space.test.ts` :
   `describe`/`it`/`expect` de vitest, entrées/sorties fixtures inline.
2. **Contrat TypeScript vs fixtures serveur réelles** : le dépôt `reefin` expose déjà
   `tests/PlaybackCompat/fixtures/` et son schéma `tests/PlaybackCompat/schema/fixture.schema.json`
   (alimenté par l'endpoint `.../Fixture` lui-même, §2.2). Ajouter un test vitest qui charge un
   exemple de fixture (copié/committé dans `reefin-web` sous
   `src/apps/dashboard/features/playback/api/__fixtures__/`) et vérifie qu'il se désérialise sans
   perte dans les types `types.ts` — détecte une dérive de contrat sans dépendre d'un serveur
   `reefin` démarré en CI.
3. **Hooks (`usePlaybackSessions`, `usePlaybackSessionDetail`)** : tester la fonction de fetch
   isolément (`fetchPlaybackSessions`/`fetchPlaybackSessionDetail` prenant un `Api` mocké minimal —
   un objet `{ axiosInstance: { get: vi.fn() }, basePath, authorizationHeader }`), plutôt que
   monter le hook React complet. Évite d'introduire `@testing-library/react-hooks` pour un besoin
   qui ne le justifie pas encore.
4. **Composants** : différé tant que `@testing-library/react` n'est pas une dépendance du projet.
   Si PR2/PR3 le justifient (logique de rendu conditionnel non triviale dans `ReasonTree`ou
   `NoDiagnosticNotice`), la décision d'ajouter `@testing-library/react` (+ `jest-dom` matchers via
   vitest) doit être prise explicitement dans cette PR-là, pas supposée acquise ici — impact sur
   `package.json`/`vite.config.ts` à documenter dans la PR.
5. **Vérification manuelle bout-en-bout** : avant de fusionner PR1 et PR2, faire tourner un serveur
   `reefin` local (avec et sans shadow mode activé) et vérifier les deux chemins réels via le
   skill `webapp-testing` — en particulier l'état « `HasDiagnostic: false` partout » qui sera le cas
   le plus fréquent en pratique et ne doit pas ressembler à une erreur pour l'admin qui la voit.

---

## 8. Risques et limites connues

- **Dérive du contrat TS/C#** : sans génération OpenAPI (RFC-0001 §9 Q2 non tranchée), le miroir
  manuel de §4.3 peut diverger silencieusement si le DTO serveur change. Le test de fixture (§7.2)
  atténue mais ne remplace pas une vraie génération de types.
- **`DecodeCapabilities`/`ClientCapabilities` encore instables côté serveur** : la XMLdoc de
  `ClientCapabilities.cs` documente déjà une divergence positive vs PR91 (split decode/output,
  PR102) — c'est la partie du contrat la plus susceptible de bouger encore. Le type
  `DecodeProfileLike` en §4.3 est volontairement laissé quasi opaque (`unknown[]`) pour ne pas
  fabriquer une précision que le serveur lui-même documente comme mouvante.
- **Expérience par défaut pauvre sans shadow mode** : la majorité des installations Reefin verront
  `HasDiagnostic: false` sur toutes les sessions tant que PR115 (bascule v2) n'est pas livrée. Le
  design assume cet état comme nominal (§5.4), mais cela signifie que la valeur perçue de cette page
  restera limitée (Method/Output/Transforms/Reasons dérivés-legacy uniquement) jusqu'à ce que le
  shadow mode ou PR115 avancent côté serveur — à rappeler dans toute communication produit sur cette
  fonctionnalité.

---

## 9. Travail serveur planifié (repo `reefin`, hors périmètre de ce document)

PR116e (`reefin-web`, durcissement bundle du call-site shadow décrit en §8/§9 du design de migration
client PR116, dépôt `reefin`) a mis en évidence trois besoins côté serveur qui touchent directement
la valeur de cette page de diagnostics. Ils sont **planifiés, pas implémentés** — aucun code serveur
n'accompagne cette section ; elle sert de point d'ancrage pour la PR `reefin` qui les traitera.

1. **`CorrelationId` distinct du `PlaySessionId`.** Le call réel (`PlaybackInfo`) et l'appel shadow
   (`POST Playback/Sessions`, PR116b) génèrent aujourd'hui deux `PlaySessionId` volontairement
   différents (§4.2 du design PR116b : réutiliser le `PlaySessionId` réel clobberait son
   `V2PlanRecord`). Conséquence : rien ne permet actuellement de retrouver, côté serveur, quelle
   requête shadow correspond à quelle requête réelle pour une même tentative de lecture. Un
   `CorrelationId` séparé (généré côté client une fois par tentative, transmis sur les deux appels)
   comblerait ce trou — nécessaire pour toute analyse a posteriori qui voudrait mettre en regard
   `PlaybackSessionResponse` (réel) et `PlaybackSessionResponse` (shadow) d'une même lecture.
2. **Conservation diagnostique du payload natif brut côté serveur.** Le builder natif
   `tesserafinPlaybackCapabilities.ts` (PR116a) produit `Capabilities`/`Constraints` tels qu'envoyés par
   le navigateur admin ou par le client courant. Rien ne garantit aujourd'hui que le serveur retient
   ce payload brut (par opposition à la version reconstruite/normalisée qu'il utilise pour décider) —
   or c'est justement ce payload brut qui permettrait de diagnostiquer un écart entre « ce qui a été
   envoyé » et « ce que le serveur a compris avoir reçu ».
3. **La comparaison PR116c est un diagnostic de référence, pas une preuve de parité — jamais un
   gate.** `CapabilitiesComparison.tsx`/`compareClientCapabilities.ts` (PR116c) comparent les
   capacités du navigateur admin **courant** (celles avec lesquelles l'admin a chargé la page) à des
   capacités **reconstruites** pour une autre session/un autre client. C'est un outil de triage utile
   (« est-ce que ça se ressemble ? ») mais ce n'est ni une capture fidèle du client d'origine, ni une
   preuve d'équivalence fonctionnelle. Il ne doit **jamais** servir de condition de bascule pour la
   lecture réelle (flag `enableV2PlaybackPath`, PR116d) — seule une comparaison shadow-vs-legacy sur
   la même session, mesurée côté serveur, peut légitimement jouer ce rôle. Ce point mérite d'être
   rappelé explicitement dans le design du feature-flag/canary serveur (PR115, cf. §2.3 point 1 sur
   l'état actuel du shadow mode) au moment où il sera écrit.

---

## 10. Questions ouvertes

1. Faut-il committer un extrait de `tests/PlaybackCompat/fixtures/` du dépôt `reefin` dans
   `reefin-web` (§7.2), ou le référencer en submodule/script de sync ? Impact sur la stratégie de
   synchronisation upstream (RFC-0001 §8).
2. `features/playback/api/` reste-t-il local à cette feature, ou faut-il anticiper un
   `src/lib/reefin-apiclient/` dès qu'un deuxième endpoint Reefin apparaît (RFC-0001 §6.4) ? Décision
   repoussée à la PR qui introduit ce deuxième cas d'usage (§4.4).
3. Le polling de la liste des sessions (rafraîchissement automatique, à la manière de
   `useLiveSessions`/WebSocket `Sessions`) est-il souhaitable pour cette page admin, ou un
   rafraîchissement manuel suffit-il pour un premier jalon ? Non tranché dans PR1 — proposition :
   commencer sans polling automatique (simplicité), ajouter en PR3 si le besoin est confirmé à
   l'usage.
