import { expect, test } from '@playwright/test';

import { FIXTURE_EPUB, HARNESS_EPUB, watchOrigin } from './support/origin';

/**
 * Server-free EPUB reader gate.
 *
 * Runs a real Chromium against the installed EPUB.js and a project-owned EPUB,
 * both served from one origin. There is no Reefin server and no mock of
 * EPUB.js.
 *
 * The harness mirrors src/plugins/bookPlayer/plugin.js call for call --
 * `ePub(url, { openAs: 'epub' })`, `renderTo(container, { flow: 'paginated' })`,
 * `themes.register`/`themes.select`, `display()`, `locations.generate(1024)`,
 * `next()`/`prev()`, `percentageFromCfi()`, `destroy()` -- so a break in the
 * plugin's contract with EPUB.js breaks this suite.
 *
 * SCOPE. This proves the *browser* path, where EPUB.js uses the native
 * DOMParser and XMLSerializer; the parser test below measures that rather than
 * assuming it. The non-browser path, where EPUB.js falls back to
 * `@xmldom/xmldom` -- the dependency this repository pins to 0.8.13 under an
 * epubjs-scoped override -- cannot be exercised here and is covered by
 * scripts/epub-xmldom-fallback.test.mjs. Neither suite is evidence for the
 * other's environment.
 */
const CHAPTER_ONE = 'Tesserafin EPUB fixture chapter one';
const CHAPTER_TWO = 'Tesserafin EPUB fixture chapter two';

test.describe('EPUB reader against the installed EPUB.js', () => {
    test('opens the archive, renders, navigates and destroys cleanly', async ({
        page
    }) => {
        const origin = watchOrigin(page);

        await page.goto(HARNESS_EPUB);
        await page.waitForFunction(() => window.harnessReady === true);

        // -- the archive opens and its package document parses ---------------
        const opened = await page.evaluate(
            (url) => window.epubHarness.open(url),
            FIXTURE_EPUB
        );
        expect(opened.archived, 'the book is opened as an archive').toBe(true);
        expect(opened.title).toBe('Tesserafin EPUB Fixture');
        expect(opened.creator).toBe('Tesserafin project');

        // -- the manifest and the spine resolve ------------------------------
        expect(opened.manifest).toEqual(['chapter1', 'chapter2', 'css', 'ncx']);
        expect(opened.spine).toEqual(['chapter1', 'chapter2']);
        expect(opened.ncxPath).toBe('toc.ncx');

        // -- the EPUB itself was fetched from this origin --------------------
        const archive = origin.responseFor(FIXTURE_EPUB);
        expect(archive, 'the page must fetch the fixture').toBeTruthy();
        expect(archive!.status).toBe(200);
        expect(archive!.contentType).toContain('epub');

        // -- the navigation document parses ----------------------------------
        expect(
            await page.evaluate(() => window.epubHarness.navigation())
        ).toEqual([
            { label: 'Chapter One', href: 'chapter1.xhtml' },
            { label: 'Chapter Two', href: 'chapter2.xhtml' }
        ]);

        // -- the first chapter renders, with the right text ------------------
        const first = await page.evaluate(() => window.epubHarness.render());
        expect(first.text).toContain(CHAPTER_ONE);
        expect(first.href).toBe('chapter1.xhtml');
        expect(first.cfi, 'a rendered location has a CFI').toBeTruthy();
        expect(first.percentage).not.toBeNull();

        // -- forward and back both land where they should --------------------
        const second = await page.evaluate(() => window.epubHarness.next());
        expect(second.text).toContain(CHAPTER_TWO);
        expect(second.href).toBe('chapter2.xhtml');
        expect(second.index).toBe(1);
        expect(
            second.percentage!,
            'progress must advance with the location'
        ).toBeGreaterThan(first.percentage!);

        const back = await page.evaluate(() => window.epubHarness.prev());
        expect(back.text).toContain(CHAPTER_ONE);
        expect(back.href).toBe('chapter1.xhtml');
        expect(back.index).toBe(0);
        expect(back.percentage).toBeCloseTo(first.percentage!, 6);

        // -- the injected theme applies inside, and only inside --------------
        const containment = await page.evaluate(() =>
            window.epubHarness.containment()
        );
        expect(containment.iframeCount).toBeGreaterThan(0);
        expect(
            containment.inside,
            'the registered theme must reach the content document'
        ).not.toContain('rgb(0, 0, 0)');
        for (const color of containment.inside) {
            expect(color).toBe('rgb(1, 2, 3)');
        }
        expect(
            containment.outside,
            'the theme must not escape into the host document'
        ).not.toBe('rgb(1, 2, 3)');
        expect(
            containment.sandbox.every((s) => s?.includes('allow-same-origin')),
            'content is rendered in a sandboxed iframe'
        ).toBe(true);
        expect(
            containment.sandbox.some((s) => s?.includes('allow-scripts')),
            'content scripting stays off'
        ).toBe(false);

        // -- destroy releases the rendition and the book ---------------------
        const closed = await page.evaluate(() => window.epubHarness.close());
        expect(closed.rendition).toBe(true);
        expect(closed.book).toBe(true);
        expect(
            closed.leftover,
            'destroying the rendition removes its iframes'
        ).toBe(0);
        expect(closed.bookGone, 'destroying the book releases its spine').toBe(
            true
        );
        expect(await page.evaluate(() => window.epubHarness.isClosed())).toBe(
            true
        );

        // -- nothing went wrong, and nothing left this origin ----------------
        origin.assertClean();
    });

    test('parses with the native DOMParser, not with xmldom', async ({
        page
    }) => {
        const origin = watchOrigin(page);

        await page.goto(HARNESS_EPUB);
        await page.waitForFunction(() => window.harnessReady === true);
        await page.evaluate(
            (url) => window.epubHarness.open(url),
            FIXTURE_EPUB
        );
        await page.evaluate(() => window.epubHarness.render());

        const parser = await page.evaluate(() => window.epubHarness.parser());

        // The globals EPUB.js resolves against are the browser's own.
        expect(parser.nativeDOMParserIsNative).toBe(true);
        expect(parser.nativeXMLSerializerIsNative).toBe(true);
        expect(parser.parsedIsNativeDocument).toBe(true);

        // And EPUB.js actually reached for them: `parse()` builds a DOMParser
        // per document (container, package, NCX...) and `Section.render()`
        // builds an XMLSerializer per section. The counters are read before the
        // probe constructs anything of its own, so a zero would mean EPUB.js
        // took the xmldom branch instead - which is what this test rules out.
        expect(
            parser.domParserConstructions,
            'EPUB.js constructed the page DOMParser'
        ).toBeGreaterThan(0);
        expect(
            parser.xmlSerializerConstructions,
            'EPUB.js constructed the page XMLSerializer'
        ).toBeGreaterThan(0);

        origin.assertClean();
    });

    test('never reaches a remote origin', async ({ page }) => {
        const origin = watchOrigin(page);

        await page.goto(HARNESS_EPUB);
        await page.waitForFunction(() => window.harnessReady === true);
        await page.evaluate(
            (url) => window.epubHarness.open(url),
            FIXTURE_EPUB
        );
        await page.evaluate(() => window.epubHarness.render());
        await page.evaluate(() => window.epubHarness.next());
        await page.evaluate(() => window.epubHarness.close());

        expect(origin.remoteRequests()).toEqual([]);
        origin.assertClean();
    });
});
