/**
 * #153-A1 — which media families the runtime suite OWES a real request, and which it does not.
 *
 * WHY THIS EXISTS. Every spec in this directory used to validate the requests it happened to
 * observe and then assert a disjunction over them - `matrix.spec.ts` required
 * `direct-audio || universal-audio`, and nothing required the rest at all. Measured on the rig, the
 * matrix reached exactly two families and passed; the whole suite reached seven of the twelve the
 * classifier can name. A branch that stops reaching a family therefore goes green by absence, which
 * is the same failure mode as a test that never runs.
 *
 * So the contract is declared here, once, and every family has a status. Two failures, not one:
 *
 *   * a `required` family that was NOT reached fails - that is the hole above;
 *   * an `unreached` family that WAS reached also fails - the written reason has gone stale, and
 *     the entry has to be promoted rather than kept as a standing excuse.
 *
 * Promoting an entry means seeding the fixture that reaches it, in the same change.
 */

/** What the suite owes one family. */
export type FamilyStatus = 'required' | 'unreached';

export interface FamilyEntry {
    status: FamilyStatus;
    /** For `unreached`, what is missing. For `required`, how it is driven. */
    note: string;
    /**
     * The spec file that must reach this family. Mandatory for `required`, absent for `unreached`.
     *
     * Naming the owner HERE rather than in the spec is what stops a family being declared required
     * and then checked by nobody - the hole this whole module exists to close, wearing a different
     * hat. The invariant at the bottom of this file fails at import if one is missing.
     */
    owner?: string;
}

/**
 * Every family `family()` classifies, and its status.
 *
 * The statuses here are measurements, not intentions: each `unreached` note records what was
 * actually tried on the rig.
 */
export const FAMILY_CONTRACT: Record<string, FamilyEntry> = {
    'direct-video': {
        status: 'required',
        owner: 'matrix.spec.ts',
        note: 'the rig seeds Smoke Test Movie; direct-play is its default path'
    },
    'universal-audio': {
        status: 'required',
        owner: 'matrix.spec.ts',
        note: 'seedAudioLibrary; the client builds /universal for every audio item'
    },
    'hls-master': {
        status: 'required',
        owner: 'migratedTrace.spec.ts',
        note: 'the rig seeds Transcode Probe, whose PlaybackInfo returns an HLS master'
    },
    'hls-variant': {
        status: 'required',
        owner: 'migratedTrace.spec.ts',
        note: 'follows the master'
    },
    'hls-segment': {
        status: 'required',
        owner: 'migratedTrace.spec.ts',
        note: 'follows the variant'
    },
    subtitle: {
        status: 'required',
        owner: 'migratedTrace.spec.ts',
        note: 'the rig seeds an external subtitle track on the movie'
    },
    font: {
        status: 'required',
        owner: 'libassFamilies.spec.ts',
        note: "the OSD subtitle control opens an action sheet; choosing the ASS track calls setSubtitleStreamIndex, which enters renderSsaAss and fetches /FallbackFont/Fonts. Pressing `c` never did - that was a driving bug wearing a product gap's clothes."
    },
    attachment: {
        status: 'required',
        owner: 'libassFamilies.spec.ts',
        note: 'same path as font: renderSsaAss consumes the server-emitted attachment DeliveryUrl once the ASS track is really selected'
    },
    trickplay: {
        status: 'unreached',
        note: 'the rig seeds no trickplay tiles. Needs the library option plus a run of the trickplay task before playback.'
    },
    'direct-audio': {
        status: 'unreached',
        note: 'getAudioStreamUrl always builds /Audio/{id}/universal. /Audio/{id}/stream would only appear if universal redirected to it, and it did not on this rig (200 and 206, no 302).'
    },
    'legacy-hls': {
        status: 'unreached',
        note: 'no current client path was observed emitting /hls/. May be dead for this client; needs a ruling before it is either driven or dropped from the classifier.'
    },
    'livetv-delivery': {
        status: 'unreached',
        note: 'the rig provisions no tuner, so no live stream can be delivered. migratedTrace.spec.ts asserts only STRUCTURALLY that nothing live-tv shaped was seen, which is not the same statement. Reaching it needs an M3U tuner fixture, or #153-A0 reopened to model the family - the owner has to choose.'
    }
};

/** The required families one spec file is responsible for reaching. */
export function familiesOwnedBy(spec: string): string[] {
    return Object.entries(FAMILY_CONTRACT)
        .filter(
            ([, entry]) => entry.status === 'required' && entry.owner === spec
        )
        .map(([name]) => name)
        .sort();
}

export function requiredFamilies(): string[] {
    return Object.entries(FAMILY_CONTRACT)
        .filter(([, entry]) => entry.status === 'required')
        .map(([name]) => name)
        .sort();
}

export function unreachedFamilies(): string[] {
    return Object.entries(FAMILY_CONTRACT)
        .filter(([, entry]) => entry.status === 'unreached')
        .map(([name]) => name)
        .sort();
}

export interface ContractVerdict {
    /** Required families this run did not reach. Non-empty is a failure. */
    missing: string[];
    /** Families declared unreachable that this run DID reach. Non-empty is a failure. */
    staleExcuses: string[];
}

/**
 * Compare one run's reached set against the contract.
 *
 * `owned` is the subset of required families the CALLING spec is responsible for. A spec that
 * drives audio is not failed for not driving HLS; what it cannot do is quietly require nothing.
 */
export function checkFamilyContract(
    reached: Iterable<string>,
    owned: readonly string[]
): ContractVerdict {
    if (owned.length === 0) {
        throw new Error(
            'a spec that checks the family contract must own at least one required family'
        );
    }
    const seen = new Set(reached);
    const ownedSet = new Set(owned);
    for (const name of ownedSet) {
        if (FAMILY_CONTRACT[name]?.status !== 'required') {
            throw new Error(
                `family "${name}" is claimed as owned but is not declared required in FAMILY_CONTRACT`
            );
        }
    }
    return {
        missing: [...ownedSet].filter((name) => !seen.has(name)).sort(),
        staleExcuses: unreachedFamilies().filter((name) => seen.has(name))
    };
}

/**
 * Import-time invariant: every `required` family names an owner.
 *
 * Checked here rather than in a test, so it holds the moment either spec loads the contract. A
 * required family with no owner is in no spec's `owned` list and is therefore checked by nobody -
 * green by absence, which is exactly the defect this module was written to remove.
 */
for (const [name, entry] of Object.entries(FAMILY_CONTRACT)) {
    if (entry.status === 'required' && !entry.owner) {
        throw new Error(
            `family "${name}" is required but names no owning spec; nothing would check it`
        );
    }
    if (entry.status === 'unreached' && entry.owner) {
        throw new Error(
            `family "${name}" is declared unreached but names an owner; promote it or drop the owner`
        );
    }
}
