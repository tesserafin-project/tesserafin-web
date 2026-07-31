/**
 * The shape the harness pages expose on `window` for the specs to drive.
 * Declared here so `tsc --noEmit` covers the reader suite like everything else.
 */
interface PdfHarness {
    open(url: string): Promise<{ numPages: number }>;
    loadPage(
        number: number
    ): Promise<{ scale: number; width: number; height: number }>;
    inkedPixels(): { inked: number; width: number; height: number };
    textOf(number: number): Promise<string>;
    metadata(): Promise<{ pdfFormatVersion: string | null }>;
    viewportAt(
        number: number,
        scale: number
    ): Promise<{ width: number; height: number }>;
    close(): Promise<{ destroyed: boolean; getPageRejected: boolean }>;
    isClosed(): boolean;
}

interface Window {
    harnessReady?: boolean;
    harness: PdfHarness;
}
