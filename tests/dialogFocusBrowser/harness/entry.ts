import dialogHelper from 'components/dialogHelper/dialogHelper';
import keyboardNavigation from 'scripts/keyboardNavigation';
import 'ui/tokens/official.classic.css';
import 'ui/tokens/official.glass.css';
import 'styles/focus-visible.scss';
import './fixture.css';

const params = new URLSearchParams(window.location.search);
const theme = params.get('theme') === 'glass' ? 'glass' : 'classic';
document.documentElement.dataset.rfTheme = `official.${theme}`;
document.documentElement.dataset.rfMode = 'dark';
document.documentElement.dataset.rfSurfaceVariant =
    theme === 'glass' ? 'glass' : 'solid';
document.documentElement.classList.add(
    `layout-${params.get('layout') || 'desktop'}`
);
keyboardNavigation.enable();

function button(
    label: string,
    id: string,
    container: HTMLElement,
    action?: () => void
) {
    const control = document.createElement('button');
    control.id = id;
    control.textContent = label;
    if (action) control.addEventListener('click', action);
    container.append(control);
    return control;
}

let sequence = 0;
function show(nested: boolean) {
    const dialog = dialogHelper.createDialog({
        enableHistory: false,
        scrollY: false,
        entryAnimation: 'scaleup',
        exitAnimation: 'scaledown'
    });
    dialog.id = `dialog-${++sequence}`;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute(
        'aria-label',
        nested ? 'Nested dialog' : 'First dialog'
    );
    button('Open nested dialog', `nested-${sequence}`, dialog, () =>
        show(true)
    );
    button('Close and focus destination', `handoff-${sequence}`, dialog, () => {
        dialog.addEventListener('closing', () => destination.focus(), {
            once: true
        });
        dialogHelper.close(dialog);
    });
    button('Close', `close-${sequence}`, dialog, () =>
        dialogHelper.close(dialog)
    );
    void dialogHelper.open(dialog);
}
const opener = button('Open dialog', 'opener', document.body, () =>
    show(false)
);
const destination = button('Destination', 'destination', document.body);
// DOM-only scenario controls: no hook or test entry is present in the shipped application.
Object.assign(window, {
    dialogFixture: {
        removeOpener: () => opener.remove(),
        disableOpener: () => {
            opener.disabled = true;
        },
        inertOpener: () => {
            opener.inert = true;
        },
        hideOpener: () => {
            opener.hidden = true;
        }
    }
});
