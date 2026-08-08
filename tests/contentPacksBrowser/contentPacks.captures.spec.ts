/**
 * Desktop half of the Classic/Frosted capture matrix (#138 §8).
 *
 * Every row the matrix marks for desktop, in both themes, with the theme-load proof described in
 * `support/captures.ts`. The artifacts land under
 * `test-results/content-packs-browser/captures/` beside an index naming each one.
 */
import {
    DELETE_CONFIRMATION,
    EMPTY_STATE,
    ERROR_STATE,
    ITEM_ASSIGNMENT,
    MANAGER_CONTROLS,
    MIXED_MEDIA_PACK,
    NON_MANAGER,
    POPULATED_MOSAIC
} from './support/captureScenarios';
import { captureMatrix } from './support/captureSpecBody';

captureMatrix('desktop', [
    POPULATED_MOSAIC,
    MIXED_MEDIA_PACK,
    MANAGER_CONTROLS,
    DELETE_CONFIRMATION,
    ITEM_ASSIGNMENT,
    NON_MANAGER,
    EMPTY_STATE,
    ERROR_STATE
]);
