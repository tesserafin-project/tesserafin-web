// DISPOSABLE — enforcement control for tesserafin-project/tesserafin#180.
//
// This file exists to make the required `Run test` status check go red on
// purpose, so that branch protection can be observed REJECTING a merge rather
// than merely being configured. It is never merged and its branch is deleted as
// soon as the control is recorded.
import { describe, expect, it } from 'vitest';

describe('branch-protection enforcement control', () => {
    it('fails deterministically, by construction', () => {
        expect(1).toBe(2);
    });
});
