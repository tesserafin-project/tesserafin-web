# Design — Profils d'interaction Reefin Glass (issue #18, arbitrage §8-C de reefin#44)

> **Statut : DESIGN DORMANT.** Aucun profil n'est activé. `useAppTheme` n'est pas modifié, aucun
> attribut `data-rf-profile` n'est posé à l'exécution, aucun bloc `profiles` n'est écrit dans un
> `theme.json` et `generate:tokens` n'est pas relancé. Glass reste **inatteignable depuis les
> sélecteurs de thème** — la propriété que la PR #14 établit est conservée telle quelle. Activation
> conditionnée à **LANE B** et **LANE E2E** (§7).

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
cible fonctionnelle est **Glass** (issue #18). Glass n'est pas sur cette branche : la PR #14 est
ouverte, `reefin-design/themes/` ne contient que `classic/`. Les valeurs ci-dessous sont donc
écrites comme deep-partials de la **forme** définie par `tokens.schema.json`, et se lieront au
`tokens.json` de Glass quand #14 sera fusionnée.

Elles ne sont **pas** écrites contre Classic, et il faut être exact sur ce que ça implique :
appliquées à Classic elles ne seraient **pas** des no-ops — `reducedTransparency` repeindrait la
surface `#202020` de Classic en `#141a22`, et `remote` lui donnerait un flou non nul qu'il ne veut
pas. Classic sert de base **dans le test seulement**, comme véhicule pour éprouver la *résolution*
(c'est le seul thème présent sur cette branche). Ce qui rend ces valeurs inoffensives n'est donc pas
leur contenu mais la **dormance** : aucun profil n'est résolu à l'exécution, sur aucun thème, tant
que l'activation ne les a pas liées à Glass.

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

## 4. Le setter d'exécution `data-rf-profile`

Spécifié ici, **non implémenté** : `useAppTheme` continue de ne poser que
`data-rf-theme`/`data-rf-mode`.

À l'activation :

- `data-rf-profile` porte **un seul** gagnant de la cascade — l'attribut sert au scoping CSS, et un
  sélecteur ne peut pas arbitrer une priorité tout seul. Valeurs :
  `reduced-transparency` | `low-power` | `remote`, absent si aucun n'est actif.
- `data-rf-reduced-motion` est un attribut **distinct** (`"true"` / absent). Le repli de
  `reducedMotion` dans `data-rf-profile` est exactement l'erreur que §2.1 interdit : deux axes, deux
  attributs.
- Signaux : `matchMedia('(prefers-reduced-transparency: reduce)')` pour `reducedTransparency`,
  `navigator.getBattery()` + `matchMedia('(update: slow)')` pour `lowPower`,
  `layoutManager.tv` pour `remote`, `matchMedia('(prefers-reduced-motion: reduce)')` pour
  `reducedMotion`. Tous observables et réversibles à chaud.
- **L'attribut est un miroir, pas la source de vérité.** Les tokens résolus sont l'autorité ; un
  CSS qui déduirait ses valeurs du seul nom de profil réintroduirait la table de résolution cachée
  écartée en §1.

## 5. Ce que ce document ne fait pas

- Ne touche pas `src/themes/useAppTheme.ts`.
- N'ajoute aucun bloc `profiles` à un `theme.json`, ne relance pas `generate:tokens`, ne modifie
  aucun fichier sous `src/ui/tokens/official.*` — `verify:tokens-fresh` reste vert sans rien
  régénérer.
- Ne rend Glass sélectionnable nulle part. La propriété d'inatteignabilité posée par la PR #14 est
  conservée.
- Ne modifie pas `theme.schema.json` : le schéma décrit déjà `profileOverride` comme un
  deep-partial, la décision de §1 le confirme au lieu de le changer.

Le seul code livré est **dormant** : `src/ui/tokens/profiles.ts` n'est importé que par son test et
n'est **pas** ré-exporté depuis `src/ui/index.ts` — le ré-exporter le rendrait atteignable depuis
un point d'entrée webpack et lui ferait peser des octets. Il en pèse **0**.

## 6. Contrôles couverts par `src/ui/tokens/profiles.test.ts`

1. Chaque partial est un sous-ensemble strict des clés de `tokens.schema.json` — aucun profil
   n'invente de token.
2. `reducedTransparency` gagne sur `lowPower` et sur `remote`, dans les six ordres d'activation.
3. Le merge est cumulatif : `remote` + `lowPower` garde `density: "spacious"`.
4. `reducedTransparency` produit des couleurs de surface **sans canal alpha**.
5. Orthogonalité : `remote` + `reducedMotion` appliquent les deux ; `reducedMotion` n'apparaît
   dans aucun ordre de la cascade ; aucun profil de la cascade ne touche `motion`, et
   `reducedMotion` ne touche que `motion`.
6. `data-rf-profile` ne porte qu'un gagnant, et `reducedMotion` n'y apparaît jamais.

## 7. Conditions d'activation

Identiques au volet Library, et pour les mêmes raisons :

1. **LANE B** — marge bundle de **84,7 KiB** aujourd'hui (86 737 o ; 374 063 o sur `main`,
   plafond 460 800 o), objectif 30 KiB : seuil numériquement **atteint** depuis la fusion de
   #26. Le gate global reste fermé tant que LANE E2E l'est. La consommation des
   profils ajoute du code au chemin de thème, qui est sur le bundle principal (`useAppTheme` n'est
   pas lazy). Rien n'est activé avant que la marge soit acquise, et les leviers sont conjonctifs
   (reefin#44 §4).
2. **LANE E2E** — aucune capture desktop/mobile/TV n'est vérifiable sans serveur réel ;
   `playwright.config.ts` n'a pas de `webServer` et reefin#39 n'est pas fusionnée. Un profil qui
   changerait le rendu sans capture croisée est une régression non observable.
