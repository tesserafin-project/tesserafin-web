import { expect, type Page } from '@playwright/test';

/**
 * Shared instrumentation for the server-free reader suite.
 *
 * Every claim this suite makes about "no console error", "no failed request"
 * and "no remote network request" is checked here rather than restated in each
 * spec, so a spec cannot forget one of them.
 */

export const HARNESS_PDF = '/__harness__/pdf.html';
export const FIXTURE_PDF = '/__fixtures__/sample.pdf';

interface SeenResponse {
    url: string;
    status: number;
    contentType: string;
}

export interface OriginWatch {
    responseFor(pathname: string): SeenResponse | undefined;
    remoteRequests(): string[];
    consoleErrors(): string[];
    pageErrors(): string[];
    failedRequests(): string[];
    abortedRequests(): string[];
    assertClean(): void;
}

export function watchOrigin(page: Page): OriginWatch {
    const responses: SeenResponse[] = [];
    const requested: string[] = [];
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failed: string[] = [];
    const aborted: string[] = [];

    page.on('request', (request) => requested.push(request.url()));
    page.on('response', (response) => {
        responses.push({
            url: response.url(),
            status: response.status(),
            contentType: response.headers()['content-type'] ?? ''
        });
    });
    page.on('requestfailed', (request) => {
        const reason = request.failure()?.errorText ?? '';
        // A reader that releases its document aborts the document's in-flight
        // range requests. That is the evidence of release, not a defect, so it
        // is tracked separately and asserted for explicitly by the spec.
        if (reason.includes('ERR_ABORTED')) {
            aborted.push(new URL(request.url()).pathname);
            return;
        }
        failed.push(`${request.url()} (${reason})`);
    });
    page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(String(error)));

    const isLocal = (url: string) =>
        url.startsWith('http://127.0.0.1:') ||
        url.startsWith('http://localhost:') ||
        url.startsWith('blob:') ||
        url.startsWith('data:');

    return {
        responseFor(pathname) {
            return responses.find((r) => new URL(r.url).pathname === pathname);
        },
        remoteRequests() {
            return requested.filter((url) => !isLocal(url));
        },
        consoleErrors: () => [...consoleErrors],
        pageErrors: () => [...pageErrors],
        failedRequests: () => [...failed],
        abortedRequests: () => [...aborted],
        assertClean() {
            expect(pageErrors, 'page errors').toEqual([]);
            expect(consoleErrors, 'console errors').toEqual([]);
            expect(failed, 'failed requests').toEqual([]);
            expect(
                responses.filter((r) => r.status >= 400).map((r) => r.url),
                'responses with a 4xx/5xx status'
            ).toEqual([]);
            expect(
                requested.filter((url) => !isLocal(url)),
                'requests that left this origin'
            ).toEqual([]);
        }
    };
}
