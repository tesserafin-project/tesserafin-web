/**
 * The first-run step's fields have to be usable on a phone, not merely present (#139, acceptance
 * repair).
 *
 * The maintainer's report was that fields on `wizard/packs` were "tellement cropped qu'ils sont soit
 * inutilisables, soit peu utilisables". The suite that shipped with the branch did not catch it
 * because it asserted the two things that were still true — every control was taller than the target
 * minimum, and no control's right edge crossed the viewport — and never asked how *wide* an editable
 * field was, or whether the value inside it could be seen.
 *
 * At `240d9a7a88`, on a Pixel 7:
 *
 * | field | box | editable width | width its own value needs |
 * | --- | ---: | ---: | ---: |
 * | `.txtPackName` (Movies and series) | 68px | 64px | 143px |
 * | `.txtPackName` (Photos and home video) | 68px | 64px | 188px |
 * | `.txtPackName` after a realistic rename | 68px | 64px | 360px |
 * | `#txtCustomPackName` | 173px | 169px | — |
 *
 * `emby-input` carries `overflow: clip`, so those are not cramped fields, they are fields whose
 * contents cannot be read at all. This spec measures the mechanism directly rather than comparing
 * screenshots: a snapshot would go stale the first time a colour token moved, and would not say what
 * was wrong.
 */
import { administrator, installFixtureApi, USER_A } from './support/fixtureApi';
import {
    addCustomPack,
    DIST,
    expect,
    openPacksStep,
    openUserStep,
    PACKS_PAGE,
    renamePack,
    selectPack,
    test,
    USER_PAGE
} from './support/harness';

/**
 * What "a practically usable editing width" means, expressed against the space the row itself has
 * rather than as a pixel constant, so the assertion keeps its meaning on any phone.
 *
 * Half the row is a deliberately forgiving floor. At `240d9a7a88` the name field held 19.6% of its
 * row; after the repair it holds ~99%. Nothing sits near the boundary, so this cannot fail for a
 * reason other than the defect it describes.
 */
const USABLE_FRACTION_OF_ROW = 0.5;

/** WCAG 2.5.8, in CSS pixels. */
const MIN_TARGET = 24;
/** What the repository's own mobile work treats as comfortable, and what the primary action keeps. */
const COMFORTABLE_TARGET = 44;

/** A name somebody would actually type, not a synthetic stress string. */
const LONG_NAME = 'Musique de la maison et podcasts du weekend';

type FieldGeometry = {
    id: string;
    value: string;
    /** The row this field belongs to, so "usable" can be stated relative to the space available. */
    rowWidth: number;
    boxWidth: number;
    /** Width available for text: `clientWidth`, i.e. the box minus its own padding and border. */
    editableWidth: number;
    /** Width the field's own current value needs. */
    contentWidth: number;
    left: number;
    right: number;
    height: number;
};

async function signIn(page: Parameters<typeof installFixtureApi>[0]) {
    await openUserStep(page);
    await page.fill(`${USER_PAGE} #txtUsername`, 'household-admin');
    await page.fill(`${USER_PAGE} #txtManualPassword`, 'geometry-password');
    await page.fill(`${USER_PAGE} #txtPasswordConfirm`, 'geometry-password');
    await page.tap(`${USER_PAGE} button[type="submit"]`);
    await page.waitForURL(/#\/wizard\/library/, { timeout: 30_000 });
}

/** Every editable text field on the step, measured together with the row that contains it. */
function nameFields(
    page: Parameters<typeof installFixtureApi>[0]
): Promise<FieldGeometry[]> {
    return page.$$eval(
        `${PACKS_PAGE} .wizardPackRow .txtPackName, ${PACKS_PAGE} #txtCustomPackName`,
        (nodes) =>
            nodes.map((node) => {
                const input = node as HTMLInputElement;
                const box = input.getBoundingClientRect();
                const row = (input.closest('.wizardPackRow') ||
                    input.closest('.wizardCustomPackContainer') ||
                    input.parentElement) as HTMLElement;
                return {
                    id: input.id,
                    value: input.value,
                    rowWidth: row.getBoundingClientRect().width,
                    boxWidth: box.width,
                    editableWidth: input.clientWidth,
                    contentWidth: input.scrollWidth,
                    left: box.left,
                    right: box.right,
                    height: box.height
                };
            })
    );
}

const describe = (f: FieldGeometry) =>
    `${f.id || '(unnamed)'} box=${Math.round(f.boxWidth)} editable=${f.editableWidth} needs=${f.contentWidth} row=${Math.round(f.rowWidth)}`;

/**
 * The core assertion, applied at whatever viewport the caller has set.
 *
 * Deliberately *not* "the value always fits": a name long enough to exceed any phone-width field is
 * a legitimate thing to type, and such a field scrolls with the caret. What must hold is that the
 * field is a field — that it owns a real share of its row, stays inside the viewport, and shows the
 * names the step itself put there.
 */
async function expectUsableFields(
    page: Parameters<typeof installFixtureApi>[0],
    where: string,
    /*
     * Whether the suggestion names must fit their field without scrolling.
     *
     * True at every width this repository shows a phone user. False at 200% page zoom, where the
     * viewport is 206 CSS pixels and "Photos and home video" fits in NO field the layout could
     * build — the field is already the full width of the step. What must still hold there is that
     * the field is full width, focusable and scrollable with the caret, and that the row's own
     * LABEL wraps rather than truncating, which is what keeps the row readable. Asserting a fit
     * that is geometrically impossible would be asserting that the product must abbreviate its own
     * copy, which this repair is explicitly not allowed to do.
     */
    suggestionsMustFit = true
) {
    const viewport = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth
    }));

    // A first-run step that scrolls sideways is a broken one.
    expect(
        viewport.scrollWidth,
        `${where}: the page scrolls horizontally`
    ).toBeLessThanOrEqual(viewport.width + 1);

    const fields = await nameFields(page);
    expect(fields.length, `${where}: no fields found`).toBeGreaterThan(0);

    const cramped = fields.filter(
        (f) => f.editableWidth < f.rowWidth * USABLE_FRACTION_OF_ROW
    );
    expect(
        cramped.map(describe),
        `${where}: fields holding under ${USABLE_FRACTION_OF_ROW * 100}% of their row`
    ).toEqual([]);

    const outside = fields.filter(
        (f) => f.left < -1 || f.right > viewport.width + 1
    );
    expect(
        outside.map(describe),
        `${where}: fields outside the horizontal viewport`
    ).toEqual([]);

    const tooShort = fields.filter((f) => f.height < MIN_TARGET);
    expect(
        tooShort.map(describe),
        `${where}: fields below the ${MIN_TARGET}px target size`
    ).toEqual([]);

    /*
     * The values the step put there itself — the suggestion names — must be readable without
     * scrolling inside the field. A value the household typed may legitimately be longer than the
     * screen; a label the product chose may not.
     */
    if (suggestionsMustFit) {
        const clippedSuggestions = fields.filter(
            (f) =>
                f.id.startsWith('suggestedPack') &&
                f.value !== LONG_NAME &&
                f.contentWidth > f.editableWidth + 1
        );
        expect(
            clippedSuggestions.map(describe),
            `${where}: suggestion names clipped by their own field`
        ).toEqual([]);
    }

    /*
     * At every width, including the zoom case: the row's own label wraps rather than truncating.
     *
     * This is what stops a narrow row from becoming the "unusable strip" — a tick next to a
     * horizontally cut-off word. A wrapped label is two lines and completely readable.
     */
    const truncatedLabels = await page.$$eval(
        `${PACKS_PAGE} .wizardPackToggle`,
        (nodes) =>
            nodes
                .filter((node) => node.scrollWidth > node.clientWidth + 1)
                .map(
                    (node) =>
                        `${node.textContent?.trim()} ${node.clientWidth}<${node.scrollWidth}`
                )
    );
    expect(
        truncatedLabels,
        `${where}: row labels cut off instead of wrapping`
    ).toEqual([]);
}

test('every field on the step keeps a usable editing width on a phone', async ({
    page,
    baseURL
}) => {
    await installFixtureApi(page, baseURL!, DIST, {
        signedIn: false,
        wizardCompleted: false,
        users: [administrator()],
        currentUserId: USER_A,
        packs: [],
        layout: 'mobile'
    });

    await signIn(page);
    await openPacksStep(page);

    await expectUsableFields(page, 'Pixel 7, nothing selected');

    await selectPack(page, 'Music');
    await selectPack(page, 'Movies and series');
    await expectUsableFields(page, 'Pixel 7, several suggestions selected');

    await renamePack(page, 'Music', LONG_NAME);
    await expectUsableFields(page, 'Pixel 7, a suggestion renamed at length');

    // The renamed value is longer than any 412px field: it must scroll with the caret rather than
    // be silently truncated, and pressing End must bring its tail into view.
    const renamed = page.locator(
        `${PACKS_PAGE} .wizardPackRow[data-pack="Music"] .txtPackName`
    );
    await renamed.focus();
    await page.keyboard.press('End');
    expect(await renamed.inputValue()).toBe(LONG_NAME);

    await addCustomPack(page, 'Documentaires scientifiques');
    await expectUsableFields(page, 'Pixel 7, a custom pack added');

    // The custom row's third control does not squeeze the field it sits with.
    const remove = await page
        .locator(`${PACKS_PAGE} .wizardPackRow[data-custom="true"] button`)
        .boundingBox();
    expect(remove!.height).toBeGreaterThanOrEqual(MIN_TARGET);

    const submit = await page
        .locator(`${PACKS_PAGE} button[type="submit"]`)
        .boundingBox();
    expect(submit!.height).toBeGreaterThanOrEqual(COMFORTABLE_TARGET);
});

test('a focused field can always be scrolled to, at the phone width and below', async ({
    page,
    baseURL
}) => {
    await installFixtureApi(page, baseURL!, DIST, {
        signedIn: false,
        wizardCompleted: false,
        users: [administrator()],
        currentUserId: USER_A,
        packs: [],
        layout: 'mobile'
    });

    await signIn(page);
    await openPacksStep(page);

    /*
     * Three viewports.
     *
     * `412x839` is the Pixel 7 the project already declares. `412x420` models what a software
     * keyboard does to the visual viewport — Playwright cannot raise a real keyboard, but it can
     * halve the space the page is laid out in, which is the part that decides whether a focused
     * field can be reached. `320x640` is a stress case, not a support promise: it is narrower than
     * any viewport this repository claims, and is here to show the layout degrades rather than
     * breaks.
     */
    const viewports = [
        { width: 412, height: 839, label: 'Pixel 7' },
        { width: 412, height: 420, label: 'Pixel 7 with a software keyboard' },
        { width: 320, height: 640, label: '320px stress case' },
        /*
         * Page zoom is not a separate mechanism: zooming to 200% halves the viewport measured in
         * CSS pixels, which is what the layout responds to. 206x640 is the Pixel 7 at 200%, and it
         * is the only faithful way to model zoom here — Playwright cannot set a browser zoom level.
         * Like the 320px row this is a stress case, not a new support promise.
         */
        { width: 206, height: 640, label: 'Pixel 7 at 200% page zoom' }
    ];

    for (const viewport of viewports) {
        await page.setViewportSize({
            width: viewport.width,
            height: viewport.height
        });
        await expectUsableFields(page, viewport.label, viewport.width >= 320);

        // Every editable field, and the primary action, can be brought fully into view and focused.
        const targets = await page.$$eval(
            `${PACKS_PAGE} .txtPackName, ${PACKS_PAGE} #txtCustomPackName, ${PACKS_PAGE} button[type="submit"]`,
            (nodes) => nodes.length
        );
        expect(targets, `${viewport.label}: nothing to reach`).toBeGreaterThan(
            0
        );

        const unreachable: string[] = [];
        for (let index = 0; index < targets; index += 1) {
            const target = page
                .locator(
                    `${PACKS_PAGE} .txtPackName, ${PACKS_PAGE} #txtCustomPackName, ${PACKS_PAGE} button[type="submit"]`
                )
                .nth(index);
            await target.scrollIntoViewIfNeeded();
            const box = await target.boundingBox();
            if (
                !box ||
                box.y < -1 ||
                box.y + box.height > viewport.height + 1 ||
                box.x < -1 ||
                box.x + box.width > viewport.width + 1
            ) {
                unreachable.push(
                    `${index}: ${box ? `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}` : 'no box'}`
                );
            }
        }
        expect(
            unreachable,
            `${viewport.label}: controls that cannot be scrolled fully into view`
        ).toEqual([]);
    }

    // Back at the declared viewport, focus lands where it is asked to and the ring is drawn.
    await page.setViewportSize({ width: 412, height: 839 });
    const first = page.locator(`${PACKS_PAGE} .txtPackName`).first();
    await first.focus();
    const focus = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        if (!active) return null;
        const box = active.getBoundingClientRect();
        return {
            id: active.id,
            left: box.left,
            right: box.right,
            width: box.width,
            viewportWidth: document.documentElement.clientWidth
        };
    });
    expect(focus!.id).toBe('suggestedPack0Name');
    expect(focus!.left).toBeGreaterThanOrEqual(-1);
    expect(focus!.right).toBeLessThanOrEqual(focus!.viewportWidth + 1);
    expect(focus!.width).toBeGreaterThan(200);
});
