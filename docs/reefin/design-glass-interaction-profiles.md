# Design — Profils d'interaction Reefin Glass (issue #18, arbitrage §8-C de reefin#44)

> **Statut : ACTIF (W13.8b / G18a).** Les profils sont résolus et **projetés sur les custom
> properties CSS** à l'exécution : `useAppTheme` appelle `useInteractionProfiles`, qui pose
> `data-rf-profile` / `data-rf-reduced-motion` et écrit les `--rf-*` surchargées — y compris la
> re-dérivation de `--rf-backdrop-filter-*`, sans laquelle une surcharge de flou restait vraie dans
> l'objet TypeScript et fausse dans les computed styles (§4.1).
>
> Ce qui **reste** inchangé : Glass est toujours `experimental` dans `src/themes/registry.ts` et
> donc **absent de tout sélecteur de thème** — la propriété d'inatteignabilité posée par la PR #14
> est conservée. Rendre Glass publiquement sélectionnable (picker, sidebar flottante, mode clair)
> est un travail distinct. Aucun bloc `profiles` n'est écrit dans un `theme.json` et
> `generate:tokens` produit une sortie inchangée octet pour octet.

## 1. La décision de format à trancher

L'issue #18 pose explicitement le problème : *« RFC-0005 §7.3 example uses semantic values
(`"blur": "reduced"`) while the schema comment says a deep-partial of tokens; surface the choice
before baking it into the published contract. »*

**Tranché : deep-partial concret des tokens. Les valeurs sémantiques (`"blur": "reduced"`) sont
écartées.**

Trois raisons dirimantes, dans l'ordre de force :

1. **Une valeur sémantique n'est pas résoluble sans une table de résolution cachée.** `"reduced"`
   n'a de sens que si un consommateur sait ce que « réduit » vaut *pour ce thème*. Cette table
   serait un second contrat non publié, invisible pour un thème communautaire, et divergent entre
   les renderers Web / Compose / SwiftUI que `reefin-design/` existe précisément pour unifier
   (RFC-0005 §3.2). Un deep-partial concret n'a rien à résoudre : il porte ses valeurs.
2. **Le schéma le dit déjà.** `theme.schema.json` définit `profileOverride` comme *« a deep-partial
   of tokens.schema.json, validated structurally by consumers »*. L'exemple sémantique du §7.3 est
   une illustration en prose, pas le contrat normatif. Aligner le contrat sur le schéma coûte
   moins que d'aligner le schéma sur un exemple.
3. **Ça reste le même système de tokens.** L'exigence de mission — *deep-partials concrets des
   tokens existants, pas un thème parallèle* — est satisfaite littéralement : un profil est une
   **surcharge partielle des mêmes clés** (`blur.md`, `color.dark.surface`, `density`…), jamais un
   nouvel espace de noms. Un profil ne peut introduire aucune clé que `tokens.schema.json` ne
   définit pas déjà.

**Ce à quoi ces partials se rattachent.** Ils surchargent les tokens du **thème actif**, et leur
cible fonctionnelle est **Glass** (issue #18). La PR #14 est fusionnée : Glass est sur `main`,
`reefin-design/themes/glass/` existe, et ces partials se lient désormais à son `tokens.json` réel.

Elles ne sont **pas** écrites contre Classic, et il faut être exact sur ce que ça implique :
appliquées à Classic elles ne seraient **pas** des no-ops — `reducedTransparency` repeindrait la
surface `#202020` de Classic en `#141a22`, et `remote` lui donnerait un flou non nul qu'il ne veut
pas. Ce qui protège Classic n'est donc pas le contenu des valeurs mais le **garde-fou de thème** :
`useInteractionProfiles` ne projette rien tant que le thème actif n'est pas `official.glass`.
Ce garde-fou est *prouvé*, pas supposé — `tests/e2e/glass-interaction-profiles.spec.ts` vérifie sur
des computed styles réels que Classic ne bouge pas, et vérifie aussi que les mêmes partials
**déplacent** bien Classic si on court-circuite le garde-fou, sans quoi la première assertion
serait vide de sens.

Classic reste la base utilisée par `profiles.test.ts`, comme véhicule pour éprouver la
*résolution* indépendamment des valeurs d'un thème donné.

## 2. Cascade — ordre de priorité

**Priorité stricte, la plus forte en dernier : `remote` < `lowPower` < `reducedTransparency`.**

Résolution : `merge(base, remote?, lowPower?, reducedTransparency?)` — un merge profond,
appliqué dans cet ordre, dernier écrivain gagnant. Un profil inactif n'est simplement pas appliqué.

Justification de l'ordre, du plus fort au plus faible :

- **`reducedTransparency` est un besoin d'accessibilité déclaré par l'utilisateur** (`@media
  (prefers-reduced-transparency: reduce)`). Il ne se négocie pas : aucune optimisation ne peut le
  rendre partiellement transparent. Il gagne toujours.
- **`lowPower` est une contrainte de l'appareil ici et maintenant** (batterie faible, thermique).
  Elle est plus urgente qu'une adaptation de forme, mais elle n'a pas à écraser un besoin
  d'accessibilité — et de fait, en aplatissant plus fort, elle va dans le même sens.
- **`remote` est une adaptation d'ergonomie** (télécommande, distance de 3 mètres). C'est le
  plancher : il pose la forme, les deux autres la contraignent ensuite.

Conséquence testable : le merge est **cumulatif, pas exclusif**. `remote` + `lowPower` conserve la
densité `spacious` de `remote` (que `lowPower` ne touche pas) tout en prenant le flou de
`lowPower`. Un profil « gagnant » n'annule pas les autres, il les surcharge clé par clé.

### 2.1 `reducedMotion` est hors cascade

**`reducedMotion` ne participe pas à cet ordre de priorité et ne doit jamais y être replié.**

C'est un axe orthogonal, pour une raison de fond : les trois profils de la cascade décrivent
*comment la surface est composée* (flou, opacité, densité, élévation) ; `reducedMotion` décrit
*comment elle change dans le temps* (`motion.duration`). Aucun des trois ne touche `motion`, et
`reducedMotion` ne touche que `motion`. Ils ne peuvent donc pas entrer en conflit — et lui donner
un rang dans la cascade créerait un conflit fictif dont la résolution ferait perdre soit
l'accessibilité du mouvement, soit celle de la transparence.

Résolution : `applyReducedMotion(resolveProfileTokens(base, active))`. `remote` +
`reducedMotion` actifs ⇒ **les deux** s'appliquent intégralement. C'est l'invariant d'orthogonalité
et il est couvert par un test dédié.

## 3. Les partials concrets

### 3.1 `remote` — 3 mètres, télécommande

```jsonc
{
  "blur":       { "sm": "6px", "md": "10px", "lg": "14px" },
  "density":    "spacious",
  "spacing":    { "md": "20px", "lg": "32px", "xl": "44px" },
  "typography": { "fontSize": { "md": "1.125rem", "lg": "1.375rem", "xl": "1.75rem" } }
}
```

Flou réduit (un flou lourd coûte cher sur les SoC de TV et n'apporte rien à 3 m), et surtout une
mise à l'échelle : cibles plus grandes pour un focus au D-pad, texte lisible à distance.

### 3.2 `lowPower` — batterie faible, thermique

```jsonc
{
  "blur":      { "sm": "2px", "md": "4px", "lg": "6px" },
  "elevation": { "level2": "0 1px 3px rgba(0, 0, 0, 0.28)", "level3": "0 2px 6px rgba(0, 0, 0, 0.32)" }
}
```

Flou quasi nul mais non nul (le verre reste lisible comme du verre), ombres portées aplaties —
les deux sont des coûts de compositing GPU par frame. **Ne touche ni `motion` ni la typographie** :
ce serait empiéter sur `reducedMotion` et sur `remote` respectivement, et rendre la cascade
illisible.

### 3.3 `reducedTransparency` — accessibilité, priorité maximale

```jsonc
{
  "blur":  { "sm": "0", "md": "0", "lg": "0" },
  "color": {
    "dark": {
      "surface":        "#141a22",
      "surfaceVariant": "#1b232d",
      "textMuted":      "#b6c2cf",
      "divider":        "#2a343f"
    }
  }
}
```

Flou à zéro **et** surfaces opaques : les deux sont nécessaires. Un flou nul sur une surface
translucide laisse le contenu du dessous transparaître net, ce qui est pire que le flou. Les
valeurs sont des hex sans canal alpha — l'opacité est vérifiable par inspection, pas par
confiance. `textMuted` et `divider` passent d'un `rgba()` à leur équivalent composité, sans quoi
ils resteraient dépendants de ce qu'il y a derrière.

### 3.4 `reducedMotion` — axe séparé

```jsonc
{
  "motion": { "duration": { "fast": "0ms", "normal": "0ms", "slow": "0ms" } }
}
```

Seules les durées tombent ; les courbes d'easing restent, puisqu'une transition de durée nulle ne
les échantillonne pas et qu'une future durée non nulle doit retrouver la même identité de
mouvement.

## 4. Le setter d'exécution

Implémenté par `src/themes/useInteractionProfiles.ts`, appelé par `useAppTheme` :

- `data-rf-profile` porte **un seul** gagnant de la cascade — l'attribut sert au scoping CSS, et un
  sélecteur ne peut pas arbitrer une priorité tout seul. Valeurs :
  `reduced-transparency` | `low-power` | `remote`, absent si aucun n'est actif.
- `data-rf-reduced-motion` est un attribut **distinct** (`"true"` / absent). Le repli de
  `reducedMotion` dans `data-rf-profile` est exactement l'erreur que §2.1 interdit : deux axes, deux
  attributs.
- Signaux (`src/themes/interactionProfileSignals.ts`), tous observables et réversibles à chaud :
  `matchMedia('(prefers-reduced-transparency: reduce)')` pour `reducedTransparency`,
  `navigator.getBattery()` + `matchMedia('(update: slow)')` pour `lowPower`,
  la classe `.layout-tv` sur `<html>` pour `remote`,
  `matchMedia('(prefers-reduced-motion: reduce)')` pour `reducedMotion`.
  Le signal `remote` lit la classe que `components/layoutManager` **publie** plutôt que d'importer
  le module : importer `layoutManager` tirerait `apphost`, `globalize` et le reste de la chaîne de
  boot héritée dans le chemin de thème, qui est sur le bundle principal. La classe est un contrat
  déjà consommé par `src/styles/site.scss`, et la lire via `MutationObserver` capte en plus un
  layout appliqué *avant* l'abonnement, ce qu'un événement `modechange` manquerait.
- Tout écouteur est retiré au démontage, y compris les deux écouteurs de batterie — qui s'attachent
  **après** résolution de `navigator.getBattery()` et peuvent donc arriver une fois le teardown
  déjà passé. Ce cas est traité explicitement, pas laissé au hasard.
- **L'attribut est un miroir, pas la source de vérité.** Les tokens résolus sont l'autorité ; un
  CSS qui déduirait ses valeurs du seul nom de profil réintroduirait la table de résolution cachée
  écartée en §1.

### 4.1 L'autorité d'exécution : la projection régénère les variables dérivées

C'est le point qui manquait, et le défaut qu'il corrige mérite d'être nommé précisément.

`generate:tokens` émet **deux** variables par clé de flou : la primitive `--rf-blur-<k>` et la
**dérivée** `--rf-backdrop-filter-<k>`. `_glass-surface.scss` lit la **dérivée** (parce que
`blur(0)` alloue encore une couche de compositing là où `none` n'en alloue aucune). Un profil qui
surcharge `blur.md` ne changeait que l'objet TypeScript : la dérivée, calculée au build, restait
figée. La surcharge était **vraie dans l'objet et fausse dans les computed styles**.

Deux issues étaient possibles : (1) que Glass compose son filtre depuis les primitives réellement
surchargées, ou (2) que la projection régénère explicitement les dérivées.

**Retenu : (2).** (1) obligerait `_glass-surface.scss` à écrire `blur(var(--rf-blur-md))`, ce qui
ferait passer Classic de `none` à `blur(0px)` — une régression de computed style sur un thème qui
n'est pas concerné, et une violation du contrat du mixin (« les consommateurs ne branchent jamais
sur le thème actif »). Ça ferait aussi retomber `reducedTransparency` sur `blur(0px)`, c'est-à-dire
conserver le coût GPU que ce profil existe pour supprimer.

**Une seule formule, deux appelants.** `toBackdropFilter` vit dans
`reefin-design/web/backdrop-filter.mjs` et est importée à la fois par le générateur (build) et par
`src/ui/tokens/projectTokens.ts` (runtime). Aucune seconde formule n'est écrite : c'est la garantie
que build et runtime ne peuvent pas diverger sur ce que vaut un flou donné.

**Pas de table sémantique cachée.** Les noms de custom properties sont *calculés* depuis le chemin
du token (`spacing.md` → `--rf-spacing-md`), jamais cherchés dans une table ; les partials portent
leurs valeurs concrètes (§1). Rien dans la chaîne ne résout un *nom* de profil vers une valeur.

## 5. Ce que cette tranche ne fait **pas**

- **Ne rend Glass sélectionnable nulle part.** `official.glass` reste `experimental` dans
  `src/themes/registry.ts`, donc absent de `getSelectableThemeEntries()` et de tout picker. La
  propriété d'inatteignabilité posée par la PR #14 est conservée telle quelle. Les profils ne sont
  atteignables qu'en appliquant Glass **par id**.
- **N'ajoute pas de picker, de sidebar flottante ni de mode clair** — travail distinct (G18b).
- N'ajoute aucun bloc `profiles` à un `theme.json` ; `generate:tokens` produit une sortie
  **identique octet pour octet** et `verify:tokens-fresh` reste vert. (Le générateur a été touché,
  mais uniquement pour importer `toBackdropFilter` au lieu d'en héberger une copie — §4.1 ; la
  sortie est inchangée, ce qui est précisément la preuve que l'extraction n'a rien fait dériver.)
- Ne modifie pas `theme.schema.json` : le schéma décrit déjà `profileOverride` comme un
  deep-partial, la décision de §1 le confirme au lieu de le changer.

`src/ui/tokens/profiles.ts` n'est plus dormant : il est désormais atteignable depuis le chemin de
thème (bundle principal) via `useInteractionProfiles`, et pèse donc des octets. Ce que la
projection évite en revanche, c'est de tirer la **palette** de Glass hors de son chunk paresseux :
elle projette le *delta* des profils (des littéraux locaux) au lieu de résoudre contre l'objet de
tokens complet, ce qui importerait `officialGlassTokens` dans le bundle principal.

## 6. Contrôles

`src/ui/tokens/profiles.test.ts` — la **résolution** (objet) :

1. Chaque partial est un sous-ensemble strict des clés de `tokens.schema.json` — aucun profil
   n'invente de token.
2. `reducedTransparency` gagne sur `lowPower` et sur `remote`, dans les six ordres d'activation.
3. Le merge est cumulatif : `remote` + `lowPower` garde `density: "spacious"`.
4. `reducedTransparency` produit des couleurs de surface **sans canal alpha**.
5. Orthogonalité : `remote` + `reducedMotion` appliquent les deux ; `reducedMotion` n'apparaît
   dans aucun ordre de la cascade ; aucun profil de la cascade ne touche `motion`, et
   `reducedMotion` ne touche que `motion`.
6. `data-rf-profile` ne porte qu'un gagnant, et `reducedMotion` n'y apparaît jamais.

`src/ui/tokens/projectTokens.test.ts` — la **projection** (noms et valeurs) : chaque nom projeté
existe réellement dans `official.glass.css` (un nom erroné serait un no-op silencieux, pas une
erreur) ; toute surcharge de `blur.<k>` régénère `--rf-backdrop-filter-<k>` ; le delta et la
résolution complète coïncident clé pour clé.

`src/themes/interactionProfileSignals.test.ts` — les **signaux** : mapping, réversibilité à chaud,
et retrait de *tous* les écouteurs au démontage, y compris la sonde batterie résolue après teardown.

`tests/e2e/glass-interaction-profiles.spec.ts` — la **preuve navigateur**, et la seule qui compte
pour §4.1 : dans un vrai Chromium, sur du CSS généré réel et le vrai mixin compilé, elle lit le
`backdrop-filter` *computed* avant / pendant / après chaque profil. Une assertion sur l'objet
TypeScript ne prouverait rien ici — c'était déjà vrai quand le bug existait.

## 7. Conditions d'activation — **levées**

Les deux lanes qui bloquaient l'activation sont closes :

1. **LANE B** (marge bundle) — seuil de 30 KiB atteint depuis la fusion de #26 et conservé après
   cette tranche ; voir la PR pour les octets mesurés.
2. **LANE E2E** — reefin#39 est fusionnée et Glass est sur `main`, donc le gate croisé n'est plus
   bloqué par leur absence. Par ailleurs les preuves de §4.1 ne dépendent d'aucun serveur : elles
   portent sur le pont CSS (tokens → variables → mixin → computed style), qui n'a besoin ni de
   médiathèque ni de session, et tournent sur `page.setContent`. Les captures d'application
   croisées desktop/mobile/TV restent, elles, dépendantes d'une instance réelle
   (`tests/e2e/theme-glass.spec.ts`).
