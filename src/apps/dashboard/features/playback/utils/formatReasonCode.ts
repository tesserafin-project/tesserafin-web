import globalize from 'lib/globalize';
import type { ReasonCode } from '../api/types';

/**
 * Renders a `ReasonCode` as a translated, human-readable label (`ReasonCode.<code>` keys in
 * `src/strings/en-us.json`), the same dotted-key convention already used for `PlaybackMethod.*`
 * (`PlaybackMethodChip`) and `LogLevel.*` (`LogLevelChip`).
 */
export const formatReasonCode = (code: ReasonCode): string =>
    globalize.translate(`ReasonCode.${code}`);
