/**
 * Mobile half of the Classic/Frosted capture matrix (#138 §8).
 *
 * The rows the matrix marks for mobile — the same states, at `devices['Pixel 7']`, so a reviewer
 * compares one state across widths rather than three different states.
 */
import {
    ITEM_ASSIGNMENT,
    MANAGER_CONTROLS,
    MIXED_MEDIA_PACK,
    POPULATED_MOSAIC
} from './support/captureScenarios';
import { captureMatrix } from './support/captureSpecBody';

captureMatrix('mobile', [
    POPULATED_MOSAIC,
    MIXED_MEDIA_PACK,
    MANAGER_CONTROLS,
    ITEM_ASSIGNMENT
]);
