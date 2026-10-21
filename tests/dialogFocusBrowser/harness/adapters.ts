// Only application/platform adapters are substituted. Dialog, browser detection,
// keyboard dispatcher, input command routing, DOM and focus manager are real.
import { createBrowserHistory } from 'history';
export const history = createBrowserHistory();
export const appHost = { supports: () => false };
export const playbackManager = {};
export const appRouter = { canGoBack: () => true, back: () => history.back() };
export default {
    tv: new URLSearchParams(window.location.search).get('layout') === 'tv',
    mobile:
        new URLSearchParams(window.location.search).get('layout') === 'mobile',
    enableSmoothScroll: () => false,
    enableGamepad: () => false
};
