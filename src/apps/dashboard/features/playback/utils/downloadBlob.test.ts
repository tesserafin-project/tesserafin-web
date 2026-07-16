import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadBlob } from './downloadBlob';

describe('downloadBlob()', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        // jsdom has no native URL.createObjectURL/revokeObjectURL to restore via restoreAllMocks
        // (see below) — undo the direct assignment by hand so it doesn't leak into other tests.
        Reflect.deleteProperty(URL, 'createObjectURL');
        Reflect.deleteProperty(URL, 'revokeObjectURL');
    });

    it('creates a temporary anchor pointing at an object URL and clicks it', () => {
        // jsdom doesn't implement URL.createObjectURL/revokeObjectURL at all (not just
        // unimplemented — the properties don't exist), so they're assigned directly rather than
        // spied on.
        const objectUrl = 'blob:mock-url';
        const createObjectURL = vi.fn().mockReturnValue(objectUrl);
        const revokeObjectURL = vi.fn();
        URL.createObjectURL = createObjectURL;
        URL.revokeObjectURL = revokeObjectURL;
        const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

        const blob = new Blob([ '{}' ], { type: 'application/json' });
        downloadBlob(blob, 'fixture.json');

        expect(createObjectURL).toHaveBeenCalledWith(blob);
        expect(clickSpy).toHaveBeenCalledOnce();
        expect(revokeObjectURL).toHaveBeenCalledWith(objectUrl);
        // The anchor is removed again after the click, so nothing should be left in the DOM.
        expect(document.querySelector('a[download="fixture.json"]')).toBeNull();
    });
});
