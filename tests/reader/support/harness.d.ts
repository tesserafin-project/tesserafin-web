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

interface EpubLocation {
    text: string;
    cfi: string | null;
    href: string | null;
    index: number | null;
    percentage: number | null;
}

interface EpubHarness {
    open(url: string): Promise<{
        title: string;
        creator: string;
        spine: string[];
        manifest: string[];
        ncxPath: string | false;
        archived: boolean;
    }>;
    navigation(): Promise<{ label: string; href: string }[]>;
    render(): Promise<EpubLocation>;
    next(): Promise<EpubLocation>;
    prev(): Promise<EpubLocation>;
    containment(): {
        inside: string[];
        outside: string;
        iframeCount: number;
        sandbox: (string | null)[];
        srcdoc: boolean[];
    };
    parser(): {
        domParserConstructions: number;
        xmlSerializerConstructions: number;
        nativeDOMParserIsNative: boolean;
        nativeXMLSerializerIsNative: boolean;
        parsedIsNativeDocument: boolean;
    };
    close(): Promise<{
        rendition: boolean;
        book: boolean;
        leftover: number;
        bookGone: boolean;
    }>;
    isClosed(): boolean;
}

interface Window {
    harnessReady?: boolean;
    // Two globals rather than one reused name: `open()` and `close()` mean
    // different things to the two readers, and an intersection type would let a
    // spec call the wrong one and still typecheck.
    harness: PdfHarness;
    epubHarness: EpubHarness;
}
