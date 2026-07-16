import './emby-checkbox.scss';
import 'webcomponents.js/webcomponents-lite';

const EmbyCheckboxPrototype = Object.create(HTMLInputElement.prototype);

function onKeyDown(e) {
    // Don't submit form on enter
    if (e.keyCode === 13) {
        e.preventDefault();

        this.checked = !this.checked;

        this.dispatchEvent(
            new CustomEvent('change', {
                bubbles: true
            })
        );

        return false;
    }
}

EmbyCheckboxPrototype.attachedCallback = function () {
    if (this.getAttribute('data-embycheckbox') === 'true') {
        return;
    }

    this.setAttribute('data-embycheckbox', 'true');

    this.classList.add('emby-checkbox');

    const labelElement = this.parentNode;
    labelElement.classList.add('emby-checkbox-label');

    const labelTextElement = labelElement.querySelector('span');

    let outlineClass = 'checkboxOutline';

    const customClass = this.getAttribute('data-outlineclass');
    if (customClass) {
        outlineClass += ' ' + customClass;
    }

    const checkedIcon = this.getAttribute('data-checkedicon') || 'check';
    const uncheckedIcon = this.getAttribute('data-uncheckedicon') || '';
    const checkHtml =
        '<span class="material-icons checkboxIcon checkboxIcon-checked ' +
        checkedIcon +
        '" aria-hidden="true"></span>';
    const uncheckedHtml =
        '<span class="material-icons checkboxIcon checkboxIcon-unchecked ' +
        uncheckedIcon +
        '" aria-hidden="true"></span>';
    labelElement.insertAdjacentHTML(
        'beforeend',
        '<span class="' +
            outlineClass +
            '">' +
            checkHtml +
            uncheckedHtml +
            '</span>'
    );

    labelTextElement.classList.add('checkboxLabel');

    this.addEventListener('keydown', onKeyDown);
};

EmbyCheckboxPrototype.detachedCallback = function () {
    this.removeEventListener('keydown', onKeyDown);
};

document.registerElement('emby-checkbox', {
    prototype: EmbyCheckboxPrototype,
    extends: 'input'
});
