import { describe, expect, it, vi } from 'vitest';

import { formatReasonCode } from './formatReasonCode';

vi.mock('lib/globalize', () => ({
    default: {
        translate: (key: string) => `translated(${key})`
    }
}));

describe('formatReasonCode()', () => {
    it('translates using the ReasonCode.<code> dotted-key convention', () => {
        expect(formatReasonCode('TonemapRequired')).toBe(
            'translated(ReasonCode.TonemapRequired)'
        );
    });

    it('works for every reason code without throwing', () => {
        const codes: Parameters<typeof formatReasonCode>[0][] = [
            'ContainerNotSupported',
            'MethodChosen',
            'NoViablePlan',
            'RequestedSourceNotFound'
        ];

        for (const code of codes) {
            expect(formatReasonCode(code)).toBe(
                `translated(ReasonCode.${code})`
            );
        }
    });
});
