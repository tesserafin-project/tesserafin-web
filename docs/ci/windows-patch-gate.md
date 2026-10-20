# Windows patch gate (#156)

The required-context candidate is **`Windows patch gate`**, emitted by
`.github/workflows/ci-windows-dependency-patch.yml` on every pull request. There is
no top-level path filter. This change prepares that context; it does not modify
branch protection or make the context required by itself.

## Execution

1. An Ubuntu job checks out the PR head with complete commit/tree history and
   runs `node --test scripts/windows-patch-gate.test.mjs`. It computes the merge-base
   diff against the event's base SHA. NUL-delimited paths and disabled rename
   detection preserve unusual filenames and both sides of a rename. No API
   pagination or truncated file listing is used. Invalid/missing history or a
   mismatched checkout fails classification, not a quiet "irrelevant" result.
2. Relevant changes run the existing Windows install lifecycle on that exact
   head: Node selection, npm ci/postinstall, patched digest, absent source map,
   no temporary residue, verifier and control suite. The final attestation
   requires every mandatory step's `outcome` **and** `conclusion` to be success.
   It also checks `git rev-parse HEAD` against the event's head SHA.
3. An Ubuntu verdict job uses `always()` and requires successful classification
   for that same head. Relevant changes require a successful Windows job plus
   its completion marker and matching tested SHA. Irrelevant changes require
   Windows to be skipped and no attestation. Missing, failed, cancelled, skipped
   required execution or malformed outputs fail the verdict.

The critical paths include `.nvmrc`, `.npmrc`, `.gitattributes`, package files,
both postinstall patchers and their tests, this workflow and its gate scripts.
`ci/windows-patch-gate.mjs` owns the list. Ordinary docs/CSS changes spend Ubuntu
classification/verdict time, but allocate no Windows runner and install no npm
dependencies for those two jobs. A reusable call from a non-PR event runs the
full Windows lifecycle. The workflow retains its existing `workflow_call` API.

Permissions remain read-only and checkout credentials are not persisted.
No artifact upload, publication, secret or repository-setting change is needed.

## Validation and limits

The Node controls exercise actual throwaway Git repositories, divergent base
history, rename/deletion/newline paths, positive and negative verdicts, each
missing/failed/skipped step, continue-on-error outcomes, wrong heads and CLI exit
statuses/outputs. Run them with `node --test scripts/windows-patch-gate.test.mjs`;
they need no npm install and make no network request.

The implementation PR is itself relevant, so its hosted run must show the real
Windows steps, attestation and final successful context on the candidate SHA.
The irrelevant path is covered by the controls; verify the first actual
docs-only PR after merging before declaring the scheduler's skip path accepted.
GitHub outages or forced workflow cancellation can prevent a job from running;
the mechanism cannot manufacture a report then, and no successful required
context should be inferred from an absent/cancelled run.

## Separate activation after evidence is accepted

1. Inspect the hosted relevant run and the first unrelated PR: the latter must
   have no allocated Windows runner and a successful `Windows patch gate`.
2. Require **only the stable final context** for this Windows mechanism, not
   `Patch lifecycle on Windows 🪟`, whose skipped state is normal on unrelated PRs.
3. Confirm the app ID/context names and preserve the existing required-check set.
   #156 also records four Ubuntu contexts to add if still absent:
   - `Quality checks 👌🧪 / Run verify:jellyfin-apiclient-patch 🕵️‍♂️`
   - `Quality checks 👌🧪 / Run test:jellyfin-apiclient-patch 🕵️‍♂️`
   - `Quality checks 👌🧪 / Run verify:console-url-hygiene 🕵️‍♂️`
   - `Quality checks 👌🧪 / Run test:console-url-hygiene 🕵️‍♂️`
4. Verify the resulting branch protection/ruleset on a subsequent PR. Keep #156
   open until the accepted rollout is complete; a green advisory check alone
   does not enforce merging policy.
