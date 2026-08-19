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
    /** For `unreached`, what is missing. For `required`, which spec drives it. */
    note: string;
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
        note: 'the rig seeds Smoke Test Movie; direct-play is its default path'
    },
    'universal-audio': {
        status: 'required',
        note: 'seedAudioLibrary; the client builds /universal for every audio item'
    },
    'hls-master': {
        status: 'required',
        note: 'the rig seeds Transcode Probe, whose PlaybackInfo returns an HLS master'
    },
    'hls-variant': {
        status: 'required',
        note: 'follows the master'
    },
    'hls-segment': {
        status: 'required',
        note: 'follows the variant'
    },
    subtitle: {
        status: 'required',
        note: 'the rig seeds an external subtitle track on the movie'
    },
    font: {
        status: 'unreached',
        note: 'needs libass to actually RENDER an ASS track. seedAssLibrary and enableFallbackFont both run in matrix.spec.ts, but pressing `c` does not select the track, so renderSsaAss is never entered and the fallback-font list is never fetched.'
    },
    attachment: {
        status: 'unreached',
        note: 'same path as font: attachments are fetched by renderSsaAss, which the suite never reaches'
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
    }
};

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
