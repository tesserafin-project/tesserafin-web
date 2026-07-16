/**
 * Triggers a browser download of `blob` named `filename`, using the standard
 * `URL.createObjectURL` + temporary `<a download>` click technique (no server round-trip beyond
 * the fetch that produced `blob`). Used for "Export test case" (design doc §5.3) — the DiagnosticDrawer
 * already has the fixture as an in-memory `Blob` from `fetchPlaybackSessionFixture`.
 */
export const downloadBlob = (blob: Blob, filename: string): void => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
};
