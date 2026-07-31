import { expect, test } from '@playwright/test';

import { FIXTURE_PDF, HARNESS_PDF, watchOrigin } from './support/origin';

/**
 * Server-free PDF reader gate.
 *
 * Runs a real Chromium against the real production build output: the worker
 * under test is `dist/libraries/pdf.worker.mjs`, the artifact
 * `npm run build:production` copied, served from the same origin as the page.
 * There is no Reefin server and no mock of pdf.js.
 *
 * The harness mirrors src/plugins/pdfPlayer/plugin.js call for call --
 * `GlobalWorkerOptions.workerSrc`, `getDocument({ url, isEvalSupported: false })`,
 * `getPage`, `getViewport`, `render({ canvasContext, viewport })`, `destroy()` --
 * so a break in the plugin's contract with pdfjs-dist breaks this suite.
 */
test.describe('PDF reader against the production build', () => {
    test('opens the document, renders, navigates, zooms and closes cleanly', async ({
        page
    }) => {
        const origin = watchOrigin(page);

        await page.goto(HARNESS_PDF);
        await page.waitForFunction(() => window.harnessReady === true);

        // -- the document loads -------------------------------------------
        const opened = await page.evaluate(
            (url) => window.harness.open(url),
            FIXTURE_PDF
        );
        expect(opened.numPages).toBe(3);

        // -- the worker was fetched from this origin, as JavaScript --------
        const worker = origin.responseFor('/libraries/pdf.worker.mjs');
        expect(worker, 'the page must fetch the built worker').toBeTruthy();
        expect(worker!.status).toBe(200);
        expect(worker!.contentType).toMatch(/javascript|ecmascript/i);

        // -- the first page renders ---------------------------------------
        const firstGeometry = await page.evaluate(() =>
            window.harness.loadPage(1)
        );
        expect(firstGeometry.width).toBeGreaterThan(0);
        expect(firstGeometry.height).toBeGreaterThan(0);

        const firstInk = await page.evaluate(() =>
            window.harness.inkedPixels()
        );
        expect(
            firstInk.inked,
            'the canvas must contain painted pixels, not just a blank bitmap'
        ).toBeGreaterThan(0);

        // -- multi-page navigation works ----------------------------------
        for (const number of [2, 3, 2, 1]) {
            const geometry = await page.evaluate(
                (n) => window.harness.loadPage(n),
                number
            );
            expect(geometry.width).toBeGreaterThan(0);

            const ink = await page.evaluate(() => window.harness.inkedPixels());
            expect(ink.inked, `page ${number} must paint`).toBeGreaterThan(0);
        }

        // -- the fit arithmetic the UI uses still scales ---------------------
        const atOne = await page.evaluate(() =>
            window.harness.viewportAt(1, 1)
        );
        const atTwo = await page.evaluate(() =>
            window.harness.viewportAt(1, 2)
        );
        expect(atTwo.width).toBeCloseTo(atOne.width * 2, 1);
        expect(atTwo.height).toBeCloseTo(atOne.height * 2, 1);

        // -- text and metadata the UI can rely on --------------------------
        for (const [number, expected] of [
            [1, 'page one'],
            [2, 'page two'],
            [3, 'page three']
        ] as const) {
            const text = await page.evaluate(
                (n) => window.harness.textOf(n),
                number
            );
            expect(text).toContain(expected);
        }

        const metadata = await page.evaluate(() => window.harness.metadata());
        expect(metadata.pdfFormatVersion).toBeTruthy();

        // -- close releases the document and its worker --------------------
        const closed = await page.evaluate(() => window.harness.close());
        expect(
            closed.destroyed,
            'the loading task reports itself destroyed'
        ).toBe(true);
        expect(
            closed.getPageRejected,
            'the document must be unusable once its worker is gone'
        ).toBe(true);
        expect(await page.evaluate(() => window.harness.isClosed())).toBe(true);

        // -- nothing went wrong, and nothing left this origin ---------------
        origin.assertClean();
    });

    test('never reaches a remote origin', async ({ page }) => {
        const origin = watchOrigin(page);

        await page.goto(HARNESS_PDF);
        await page.waitForFunction(() => window.harnessReady === true);
        await page.evaluate((url) => window.harness.open(url), FIXTURE_PDF);
        await page.evaluate(() => window.harness.loadPage(1));
        await page.evaluate(() => window.harness.close());

        expect(origin.remoteRequests()).toEqual([]);
        origin.assertClean();
    });
});
