# Local CI — reference merge gate during the GitHub Actions outage

> ## Update 2026-07-27 — hosted CI is back (tesserafin#94)
>
> GitHub allocates hosted runners for this organisation again. The July 2026
> allocation refusal described in section 1 is **over** and is kept below only
> as an archive. Evidence comes from the sibling server repository, run
> [30229812748](https://github.com/tesserafin-project/tesserafin/actions/runs/30229812748):
> job `ABI - HEAD` **completed/success**, **8 steps executed**, runner
> `GitHub Actions 1000000000` — the exact opposite of the parked signature
> (failure in 1-3 s, zero steps, no runner, billing annotation). Both
> repositories are owned by the same free organisation `tesserafin-project`
> and meter against the same pool, so that result establishes allocation here
> too. The personal `all3f0r1` account named throughout section 1 is no longer
> the metered pool.
>
> `pull_request.yml` and `push.yml` are re-armed, which brings back the
> quality-check matrix, the production build and CodeQL. `workflow_run.yml`
> stays parked: it is the only ungated deployment path in this repository.
>
> `paths-ignore: '**/*.md'` was deliberately **not** restored. These workflows
> are the entry point for `__codeql.yml`, and a documentation-only exclusion
> there silently suppresses security analysis on any pull request that happens
> to touch only Markdown.
>
> **Not resolved, and the reason tesserafin#94 stays open:** required status
> checks remain unavailable. `GET .../branches/main/protection` and
> `GET .../rulesets` both return
> `403 "Upgrade to GitHub Pro or make this repository public to enable this
> feature"` (private repository, free organisation plan). The checks run and
> report a status; none of them can be made mandatory. The local gate
> therefore keeps conventional authority only, and remains the discipline of
> record.

**Status: active since 2026-07-19.** Until required checks can be enforced,
the **local gate described here remains the mandatory merge gate**. No change
lands without it passing.

---

## 1. Why the hosted CI is parked

The cause is **external and account-wide**. It is not a defect in this
repository's code, tests, or workflow files.

- `all3f0r1` is on the **free** plan and its repositories are **private**, so
  Actions minutes are metered.
- The allowance of **2000 minutes/month is shared by ALL repositories** of the
  account.
- July 2026 weighted usage: Linux 634 min (x1) + Windows 266 min (x2 = 532) +
  macOS 148 min (x10 = 1480) ≈ **2646 weighted minutes > 2000**. The overage
  holds even if Windows is ignored entirely: 634 + 1480 = 2114 > 2000.
- The pool is drained mostly by **another repository of the account**,
  `youtube-chapter-splitter`, whose macOS runs are billed **x10**.
- The **spending limit is $0**, so the overage is **refused rather than
  billed**.

GitHub therefore refuses to allocate a hosted runner **before the first step**.

### Evidence verified on 2026-07-19

| Run | Workflow | Jobs | Steps executed | Duration | Conclusion |
|---|---|---|---|---|---|
| 29700069992 | Pull Request | 7 | **0** | 1–3 s | all `failure` |
| 29700076245 | Push & Release 🌍 | 8 | **0** | 1–2 s | 7 `failure`, 1 `skipped` |
| 29700073736 | Workflow Run | 3 | **0** | 2 s | 1 `failure`, 2 `skipped` |
| 29696265791 | Workflow Run | 3 | **0** | 3 s | 1 `failure`, 2 `skipped` |

Every failing job carries exactly **one** GitHub annotation, and its text is
the refusal itself:

> The job was not started because recent account payments have failed or your
> spending limit needs to be increased. Please check the 'Billing & plans'
> section in your settings

`GET /repos/all3f0r1/reefin-web/actions/runners` returns `total_count: 0`.

**No step ever executed, in any job, including the cheapest ones.** This is an
allocation refusal, not a build or test regression. Nothing has been rewritten
to work around it — the triggers are simply disarmed to stop the permanent red.

---

## 2. Which workflows are parked

| File | Trigger before | Trigger after | Decision |
|---|---|---|---|
| `.github/workflows/pull_request.yml` | `pull_request` (branches `main`, `release*`; `paths-ignore: **/*.md`) | `workflow_dispatch` | **PARKED** — red on every PR |
| `.github/workflows/push.yml` | `push` (branches `main`, `release*`; `paths-ignore: **/*.md`) | `workflow_dispatch` | **PARKED** — red on every push |
| `.github/workflows/workflow_run.yml` | `workflow_run` (workflows `Pull Request`, types `completed`) | `workflow_dispatch` | **PARKED** — its ungated `Automation` job went red on every PR-workflow completion |

### Left intact, on purpose

| File | Trigger | Why untouched |
|---|---|---|
| `__automation.yml` | `workflow_call` only | Reusable workflow, no trigger of its own. Cannot fire by itself. |
| `__codeql.yml` | `workflow_call` only | Idem. |
| `__deploy.yml` | `workflow_call` only | Idem. |
| `__job_messages.yml` | `workflow_call` only | Idem. |
| `__package.yml` | `workflow_call` only | Idem. |
| `__quality_checks.yml` | `workflow_call` + `workflow_dispatch` | No automatic trigger; already manual-only. Nothing to disarm. |
| `schedule.yml` | `schedule` (cron) + `workflow_dispatch` | Its single job is guarded by `if: contains(github.repository, 'jellyfin/')`, which is **false** here. Verified: run 29673840647 concluded `skipped`. Burns no minutes and produces no red. |

---

## 3. SECURITY DEBT — visible and temporary

**CodeQL is no longer running on this repository. At all.**

`__codeql.yml` (`Analyze javascript-typescript`) has no trigger of its own; it
was invoked from `pull_request.yml:34` and `push.yml:32`. Both are now parked,
so:

- no CodeQL analysis on pull requests;
- no CodeQL analysis on pushes to `main` / `release*`;
- **nothing compensates for this.** The local gate below runs lint, type
  checks, unit tests and E2E — it performs **no** static security analysis.

Do not describe this repository as covered by CodeQL while this document says
otherwise. Restoring CodeQL is a closure condition (see §5).

Also disarmed as a side effect, and not security-related but worth stating:
merge-conflict labeling, PR preview deployment and preview comments, and
unstable-release publishing on push.

---

## 4. The local gate (mandatory)

```bash
npm run validate:full
```

**plus the real end-to-end suite** (Playwright, against a real server — not a
mocked run).

### Measured reference

Obtained on unmodified `main`:

| Item | Value |
|---|---|
| Working directory | `/home/alex/Repos/.wt-web/it13-d-l15a` |
| Commit SHA | `c2bac0b11c5de1188b448ecaa137dfcd99d2b2b8` |
| Exit code | **0** |
| Wall time | **3 min 45 s** |
| Tests | **723 tests across 70 files** |
| Bundle `main.jellyfin.bundle.js` | **380 233 bytes** (budget **460 800**) |

A change is mergeable during the outage only if it reproduces **exit 0** with
no test regression against that reference, and keeps the main bundle under the
460 800-byte budget.

---

## 5. Retour à la normale — closure checklist

All five conditions must hold before this document is removed:

- [ ] **1. Quota or billing restored.** Either the account-wide 2000-minute
      allowance has reset / freed up (notably by curbing the macOS x10 runs of
      `youtube-chapter-splitter`), or a spending limit above $0 is set, or the
      repositories are made public so minutes stop being metered.
- [ ] **2. Original triggers restored.** The three parked files get their
      `on:` blocks back, verbatim from the "Previous trigger" section of each
      parking stamp, and the stamps are deleted.
- [ ] **3. Self-hosted runner available, or the local gate retired cleanly.**
      This repository has **no** self-hosted-runner workflow to re-arm — the
      condition is met either by registering a runner
      (`GET /actions/runners` must stop returning `total_count: 0`) or by
      retiring this local-gate document and its references once hosted runners
      allocate again.
- [ ] **4. The checks really execute their steps.** Re-verify via
      `gh api /repos/all3f0r1/reefin-web/actions/runs/<id>/jobs` that jobs
      report a **non-zero** step count and realistic durations — not a
      1–3 s zero-step failure — and that the billing annotation is gone.
- [ ] **5. One full green run observed.** A complete `Pull Request` run **and**
      a complete `Push & Release 🌍` run conclude `success`, **including the
      CodeQL job**, closing the security debt of §3.

---

## 6. Related

The server repository `all3f0r1/reefin` was hit by the same account-wide
outage and received the same treatment (parking PR #66, issue #62). Its
equivalent document is `docs/local-ci.md` in that repository.

---

## 7. Secret scanning (fail-closed) — tesserafin-project/tesserafin#172 / [C3]

Unlike everything above, this gate **does run on GitHub Actions**
(`.github/workflows/secret-scan.yml`). It needs no CodeQL, no GitHub Advanced Security, no
self-hosted runner and no secret of any kind. It is still not a *required* check — no branch
protection is available on this plan (§1) — so it reports automatically without being able to
block.

It **detects** a committed secret. It does not **prevent** one: by the time it starts, GitHub
has already accepted the push. Prevention needs native push protection, which needs GitHub
Secret Protection, which is unavailable here. tesserafin-project/tesserafin#96 and #94 stay
open for that.

### Running it locally

```bash
# 1. install the pinned scanner (archive verified BEFORE it is executed)
./ci/install-gitleaks.sh

# 2. the deterministic controls — these are what prove the gate knows how to refuse
./ci/tests/secret-scan.test.sh          # add --no-live to skip the real scans

# 3. the current tree (the historical baseline does not apply here)
./ci/secret-scan.sh --mode tree --repo-name tesserafin-web

# 4. the complete history, compared against the committed baseline
./ci/secret-scan.sh --mode history --repo-name tesserafin-web \
  --default-branch main --min-commits 25000 --min-refs 10

# 5. the baseline artefacts alone
./ci/secret-scan.sh --mode baseline --repo-name tesserafin-web
```

npm equivalents are wired for convenience:

```bash
npm run secret-scan:controls
npm run secret-scan:tree
npm run secret-scan:history
```

Two deliberate choices. The scanner installs **outside the working tree** (`$TMPDIR`), so
`git status` stays clean and the tree scan does not scan the scanner. And the tree scan must
run on a **pristine checkout** — `ci/secret-scan.sh` refuses outright if `node_modules` is
present, because scanning a dependency tree answers a different question. Run it before
`npm ci`, or from a clean clone.

The secret scan is deliberately **not** part of `npm run validate:full`: it is an independent
gate with its own workflow, and folding it in would change that command's test count for a
reason unrelated to the application.

### Three verdicts, not two

| Code | Verdict | Meaning |
| --- | --- | --- |
| `0` | CLEAN | the question was asked and the answer is "no secret" |
| `1` | FINDINGS | the question was asked and the answer is "a secret" |
| `2` | INDETERMINATE | the question was **not** asked |

The third is the point. A missing scanner, a wrong version, a bad checksum, a shallow clone, a
missing default-branch ref, a crash, a timeout, an unknown flag, an absent or unparseable
report, an exit code contradicted by its report, and every invalid, duplicate, unsorted or
stale baseline — all of those produce "no findings" from a naive wrapper, and all of them exit
`2` here. Both `1` and `2` are red.

Gitleaks runs with `--exit-code 7`, because its default `1` is also what Cobra returns for an
unknown flag: with the default, "you typed an option this version does not have" and "there is
a secret in your repository" would be the same integer.

### Historical baseline

`.gitleaksignore` and `ci/secret-history-baseline.json` describe **exactly the same set**: 20
exact `<commit>:<path>:<rule>:<line>` fingerprints, sorted, unique, no glob, no path-wide
exception, no rule-wide exception, no regex. The JSON adds each one's provenance,
classification and disposition, and stores no value.

Eighteen are inherited pre-fork `dashboard-ui` history. **Two are not**, and are classified
separately rather than being folded into "inherited": they are the two commits of the
negative-login end-to-end fixture, conclusively a non-secret, removed from the current tree by
[PR #96](https://github.com/tesserafin-project/tesserafin-web/pull/96) by assembling the value
from fragments at run time rather than by suppressing the rule.

Editing either file to make CI green is not a fix. A new finding needs an owner disposition.
