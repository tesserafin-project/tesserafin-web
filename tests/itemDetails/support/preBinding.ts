/**
 * Typed access to the pre-binding composition record.
 *
 * The JSON is the authority; this module only gives it a shape. It is read by
 * `preBinding.consistency.test.ts` (integrity) and `itemDetails.recipe.test.tsx` (equivalence),
 * and by nothing in `src/` — a production module that read the record would make the evidence part
 * of the product.
 */
import { join, resolve } from 'node:path';

import record from '../../fixtures/item-details/pre-binding-composition.json';

export interface PreBindingArtwork {
    backdropElement: number;
    backdropImage: boolean;
    posterElement: number;
    posterImage: boolean;
    posterPlaceholder: boolean;
    logoElement: number;
}

export interface PreBindingClass {
    id: string;
    itemTypes: string[];
    artwork: PreBindingArtwork;
    sections: string[];
    slots: { section: string; slot: string }[];
    headings: string[];
    actions: string[];
    selectors: string[];
    focusTarget: string;
}

export interface PreBindingRecord {
    version: number;
    startSha: string;
    capability: string;
    boundAtCapture: boolean;
    platformDefaultAtCapture: {
        source: string;
        hero: string;
        sections: string[];
        boundByRoute: boolean;
    };
    states: { malformedRoute: string[]; emptyCollection: string };
    classes: PreBindingClass[];
}

export const PRE_BINDING = record as unknown as PreBindingRecord;

export const PRE_BINDING_PATH = join(
    resolve(__dirname, '..', '..', '..'),
    'tests',
    'fixtures',
    'item-details',
    'pre-binding-composition.json'
);

export const preBindingClass = (id: string): PreBindingClass => {
    const found = PRE_BINDING.classes.find((entry) => entry.id === id);
    if (!found) throw new Error(`[pre-binding] no class "${id}"`);
    return found;
};
