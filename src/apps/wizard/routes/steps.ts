import { AppType } from 'constants/appType';
import type { LegacyRoute } from 'components/router/LegacyRoute';

/**
 * The first run, in order, as one list.
 *
 * Every step but one is a directory under `../controllers` holding `index.js` beside
 * `index.html`, so the route table is derived from the step list rather than written out
 * once per step. `library` is the step that predates that layout and is still a flat pair
 * of files beside the directories; it is the only entry that has to say so.
 *
 * Deriving it matters beyond tidiness: this list is in `main.tesserafin.bundle.js` — the
 * wizard's *controllers* are async, but the table that routes to them is not — so six
 * spelled-out copies of the same shape are six copies of start-up delivery.
 */
const step = (path: string, controller: string, view: string): LegacyRoute => ({
    path,
    pageProps: { appType: AppType.Wizard, controller, view }
});

const directoryStep = (path: string, directory = path): LegacyRoute =>
    step(path, `${directory}/index`, `${directory}/index.html`);

export const WIZARD_STEPS: LegacyRoute[] = [
    directoryStep('start'),
    directoryStep('user'),
    step('library', 'library', 'library.html'),
    directoryStep('packs'),
    directoryStep('remoteaccess', 'remote'),
    directoryStep('finish')
];
