import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The wizard's decision ledger, executable.
 *
 * #129 and #139 gate 7 hold the first run to "a question only when the product cannot safely infer
 * an answer", and to fewer than ten decisions. Both claims used to live only in prose, in a pull
 * request body, where nothing could contradict them. This file is the version the build can check:
 * every interactive control in every wizard view has to map to a declared decision, and any control
 * that appears without being declared here fails the suite.
 *
 * A control is what a household has to look at and answer. Navigation buttons are not decisions,
 * and neither is a confirmation field that restates a decision already made — `txtPasswordConfirm`
 * belongs to the password, not beside it.
 */

const WIZARD = join(__dirname, 'controllers');

/** The seven decisions a first run actually asks for. */
const DECISIONS = [
    { id: 'server-name', why: 'what this server is called' },
    { id: 'username', why: 'who the first administrator is' },
    { id: 'password', why: 'their password' },
    { id: 'media-libraries', why: 'which folders hold the household media' },
    {
        id: 'remote-access',
        why: 'whether the server is reachable from outside'
    },
    { id: 'content-packs', why: 'which content packs to seed, if any' },
    { id: 'browsing-arrangement', why: 'how primary navigation is arranged' }
] as const;

type DecisionId = (typeof DECISIONS)[number]['id'];

/**
 * Every statically authored control, by the id the view gives it.
 *
 * `dynamic` marks a decision whose controls are built by its controller at runtime rather than
 * written into the view - the library list and the content-pack suggestion rows. They are still
 * decisions; they just cannot be counted by reading HTML, so they are declared with the controller
 * evidence that proves they exist.
 */
const CONTROLS: Record<string, DecisionId> = {
    txtServerName: 'server-name',
    txtUsername: 'username',
    txtManualPassword: 'password',
    txtPasswordConfirm: 'password',
    chkRemoteAccess: 'remote-access',
    txtCustomPackName: 'content-packs',
    radioMediaFamilyFirst: 'browsing-arrangement',
    radioContentPackFirst: 'browsing-arrangement'
};

const DYNAMIC: { decision: DecisionId; file: string; evidence: RegExp }[] = [
    {
        decision: 'media-libraries',
        file: 'library.js',
        evidence: /Dashboard\.navigate\('wizard\/packs'\)/
    },
    {
        decision: 'content-packs',
        file: 'packs/index.js',
        evidence: /SUGGESTED_PACKS|suggestedPacks/
    }
];

const viewFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return viewFiles(full);
        return full.endsWith('.html') ? [full] : [];
    });

const CONTROL_TAG = /<(input|select|textarea)\b[^>]*>/gi;
const ID_ATTR = /\bid="([^"]+)"/;

const controlsInWizardViews = () =>
    viewFiles(WIZARD).flatMap((file) => {
        const html = readFileSync(file, 'utf8');
        return [...html.matchAll(CONTROL_TAG)].map((match) => ({
            file: file.slice(WIZARD.length + 1),
            tag: match[0],
            id: ID_ATTR.exec(match[0])?.[1] ?? null
        }));
    });

describe('the first-run wizard decision ledger', () => {
    it('asks for seven decisions', () => {
        expect(DECISIONS).toHaveLength(7);
        expect(DECISIONS.length).toBeLessThan(10);
    });

    it('has no control that is not a declared decision', () => {
        const undeclared = controlsInWizardViews().filter(
            (control) => !control.id || !(control.id in CONTROLS)
        );
        expect(
            undeclared.map((control) => `${control.file}: ${control.tag}`)
        ).toEqual([]);
    });

    it('has a control, or controller evidence, for every declared decision', () => {
        const covered = new Set<string>(Object.values(CONTROLS));
        for (const dynamic of DYNAMIC) {
            const source = readFileSync(join(WIZARD, dynamic.file), 'utf8');
            expect(
                source,
                `${dynamic.file} no longer builds ${dynamic.decision}`
            ).toMatch(dynamic.evidence);
            covered.add(dynamic.decision);
        }
        expect([...covered].sort()).toEqual(
            DECISIONS.map((decision) => decision.id).sort()
        );
    });

    it('asks no language, region or country question', () => {
        const offenders = controlsInWizardViews().filter((control) =>
            /language|locale|culture|country|region/i.test(control.tag)
        );
        expect(
            offenders.map((control) => `${control.file}: ${control.tag}`)
        ).toEqual([]);
    });

    it('hides no required field behind the ones it shows', () => {
        const hidden = controlsInWizardViews().filter(
            (control) =>
                /\btype="hidden"/i.test(control.tag) ||
                /\bhidden\b/i.test(control.tag) ||
                /class="[^"]*\bhide\b[^"]*"/i.test(control.tag)
        );
        expect(
            hidden.map((control) => `${control.file}: ${control.tag}`)
        ).toEqual([]);
    });

    it('has no wizard view left behind by a removed step', () => {
        const views = viewFiles(WIZARD).map((file) =>
            file.slice(WIZARD.length + 1)
        );
        expect(views.sort()).toEqual([
            'finish/index.html',
            'library.html',
            'packs/index.html',
            'remote/index.html',
            'start/index.html',
            'user/index.html'
        ]);
    });

    it('routes exactly those views and nothing else', () => {
        const routes = readFileSync(
            join(__dirname, 'routes', 'routes.tsx'),
            'utf8'
        );
        const declared = [...routes.matchAll(/view: '([^']+)'/g)]
            .map((match) => match[1])
            .sort();
        expect(declared).toEqual([
            'finish/index.html',
            'library.html',
            'packs/index.html',
            'remote/index.html',
            'start/index.html',
            'user/index.html'
        ]);
    });
});

describe('post-onboarding metadata settings survive the wizard cleanup', () => {
    const read = (relative: string) =>
        readFileSync(join(__dirname, '..', relative), 'utf8');

    it('keeps the display-language control in ordinary settings', () => {
        expect(read('dashboard/routes/settings/index.tsx')).toContain(
            'LabelPreferredDisplayLanguage'
        );
    });

    it('keeps metadata language and country in library metadata settings', () => {
        const metadata = read('dashboard/routes/libraries/metadata.tsx');
        expect(metadata).toContain('HeaderPreferredMetadataLanguage');
        expect(metadata).toContain('PreferredMetadataLanguage');
        expect(metadata).toContain('MetadataCountryCode');
    });
});
