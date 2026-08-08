/**
 * TV half of the Classic/Frosted capture matrix (#138 §8).
 *
 * Captured with TV LAYOUT actually on, not merely at a 1920x1080 viewport, and with a control
 * focused — what a TV reviewer has to judge is whether the focus ring reads from across a room,
 * and an unfocused screenshot cannot show that.
 */
import { TV_FOCUS_MOSAIC, TV_FOCUS_PACK } from './support/captureScenarios';
import { captureMatrix } from './support/captureSpecBody';

captureMatrix('tv', [TV_FOCUS_MOSAIC, TV_FOCUS_PACK], { layout: 'tv' });
