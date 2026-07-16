import { describe, expect, it, vi } from 'vitest';

import { formatOutputSpec } from '../utils/formatOutputSpec';
import { formatReasonCode } from '../utils/formatReasonCode';
import getDivergenceClassColor from '../utils/getDivergenceClassColor';
import type { PlaybackDiagnosticDetail, ReasonNode } from './types';
import sessionDetailWithDiagnostic from './__fixtures__/sessionDetailWithDiagnostic.json';
import sessionDetailWithoutDiagnostic from './__fixtures__/sessionDetailWithoutDiagnostic.json';

// `lib/globalize`'s real module reaches `scripts/settings/webSettings.js`, which reads
// `__WEBPACK_SERVE__` — a webpack DefinePlugin global that doesn't exist under vitest (same
// constraint `formatReasonCode.test.ts` works around). The identity mock keeps
// `formatReasonCode(code)` equal to `ReasonCode.${code}` for the assertions below.
vi.mock('lib/globalize', () => ({
    default: { translate: (key: string) => key }
}));

/**
 * Contract check for `PlaybackDiagnosticDetail` (design doc §7.2), using hand-built local
 * fixtures rather than `reefin`'s `tests/PlaybackCompat/fixtures/`.
 *
 * That directory was checked (`/home/alex/Repos/reefin/tests/PlaybackCompat/fixtures/*.json`,
 * schema `tests/PlaybackCompat/schema/fixture.schema.json`) and found structurally incompatible
 * with the admin `GET /System/PlaybackDiagnostics/Sessions/{id}` response this file mirrors:
 * those fixtures are `{ input: { context, capabilities, sources, constraints }, expected: {
 * method, selectedStreams, output, transforms, reasonCodes, isViable } }` — the decision engine's
 * compat-lab *replay* format (confirmed by `Reefin.Api/Models/PlaybackSessionDtos/
 * PlaybackCompatFixtureExporter.cs`, which builds this exact shape from a
 * `ShadowDiagnosticRecord` via `PlaybackCompatFixtureExporter.Export`/`MapExpected`). It has no
 * `Id`/`Reasoning`/`Comparison`/`Timeline`/`RequestContext` fields and uses camelCase, not
 * PascalCase. There is no `reefin`-side fixture of the actual `PlaybackDiagnosticDetail` shape to
 * pin this contract against, so these two local fixtures stand in for it:
 * - `__fixtures__/sessionDetailWithoutDiagnostic.json`: the nominal shape while the server's
 *   shadow mode is disabled (the default) — every nullable/diagnostic-only field (RequestContext,
 *   Capabilities, SourceSnapshot, Reasoning, Comparison) is *absent* from the JSON, matching
 *   `JsonDefaults.Options`'s `DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull`
 *   (verified in `src/Reefin.Extensions/Json/JsonDefaults.cs`) rather than present with a literal
 *   `null` value.
 * - `__fixtures__/sessionDetailWithDiagnostic.json`: a fully populated shadow diagnostic,
 *   including a nested `Reasoning` tree, to exercise `ReasonTree`/`DiagnosticTimeline`/
 *   `DivergenceBadge` against a realistic multi-level payload.
 */
describe('PlaybackDiagnosticDetail contract (local fixtures)', () => {
    describe('sessionDetailWithoutDiagnostic.json', () => {
        const detail = sessionDetailWithoutDiagnostic as unknown as PlaybackDiagnosticDetail;

        it('always carries the legacy-derived decision fields', () => {
            expect(detail.Id).toBe('3fa85f64-5717-4562-b3fc-2c963f66afa6');
            expect(detail.Method).toBe('Transcode');
            expect(detail.Reasons).toEqual(['VideoCodecNotSupported', 'MethodChosen']);
            expect(detail.Timeline).toHaveLength(1);
            expect(detail.Timeline[0].Stage).toBe('Created');
        });

        it('has nullable diagnostic-only fields arrive as undefined, not null', () => {
            // This is the behavior the drawer's `hasDiagnostic` check (and every nullable-field
            // access in ReasonTree/DiagnosticDrawer) relies on: `!field`, never `field === null`.
            expect(detail.RequestContext).toBeUndefined();
            expect(detail.Capabilities).toBeUndefined();
            expect(detail.SourceSnapshot).toBeUndefined();
            expect(detail.Reasoning).toBeUndefined();
            expect(detail.Comparison).toBeUndefined();
        });

        it('formatOutputSpec handles the always-available Output without throwing', () => {
            expect(formatOutputSpec(detail.Output)).toBe('MP4 · H264 · 1920x1080 · AAC');
        });
    });

    describe('sessionDetailWithDiagnostic.json', () => {
        const detail = sessionDetailWithDiagnostic as unknown as PlaybackDiagnosticDetail;

        it('populates every diagnostic-only field', () => {
            expect(detail.RequestContext).toBeDefined();
            expect(detail.Capabilities).toBeDefined();
            expect(detail.SourceSnapshot).toHaveLength(1);
            expect(detail.Reasoning).toBeDefined();
            expect(detail.Comparison).toBeDefined();
            expect(detail.Timeline.length).toBeGreaterThan(1);
        });

        it('carries a multi-level Reasoning tree that formatReasonCode can render', () => {
            const root = detail.Reasoning as ReasonNode;
            expect(root.Children).toHaveLength(2);

            for (const node of [ root, ...root.Children ]) {
                // Exercises the real i18n-backed formatter against every code in the fixture;
                // translations aren't loaded in this test environment, so `translate()` falls
                // back to returning the dotted key itself — good enough to prove no code throws
                // and the ReasonCode.<code> key is well-formed.
                expect(formatReasonCode(node.Code)).toBe(`ReasonCode.${node.Code}`);
            }

            // A child with no further children (the ReasonTree "leaf" rendering path).
            expect(root.Children[0].Children).toHaveLength(0);
        });

        it('getDivergenceClassColor resolves a color for the fixture\'s DivergenceClass', () => {
            expect(getDivergenceClassColor(detail.Comparison!.DivergenceClass)).toBe('success');
        });

        it('a ReasonSubject without StreamIndex/SourceId omits both (root Method subject)', () => {
            const root = detail.Reasoning as ReasonNode;
            expect(root.Subject.Kind).toBe('Method');
            expect(root.Subject.StreamIndex).toBeUndefined();
            expect(root.Subject.SourceId).toBeUndefined();
        });
    });
});
