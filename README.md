# FallForge Mint

**▶ LIVE: https://sjgant80-hub.github.io/fallforgemint/**

**Launched 28 September 2026 — [v1.0.0](https://github.com/sjgant80-hub/fallforgemint/releases/tag/v1.0.0)**: the release carries a real CI-minted scorecard (4/5 vs its base 0/5, BEATS, link BOUND) and the CI runs that pass it and fail its forgeries.

<!-- film-2026-09 -->
**▶ [Watch the 90-second film](https://www.ai-nativesolutions.com/explainer.html#film)** — size it, mint it, prove it, own it; then the whole estate · [The brochure (PDF)](https://www.ai-nativesolutions.com/fall-os-prospectus.pdf) · [Every number, sourced](https://www.ai-nativesolutions.com/explainer.html#facts)

[![The sizer: the smallest open-weight model that clears your bar, ~1B to ~200B](https://www.ai-nativesolutions.com/media/images/sizer-ladder.jpg)](https://www.ai-nativesolutions.com/explainer.html#film)

Bring one job you do a lot. Walk out **owning** the small model that does it — private, on your own machine, no per-token bill. Everything runs in your browser; your examples never leave it. Free to try.

This is a **self-contained** product: one page, no links out to any other repository — except its own CI re-run template, [fallforgemint-rerun](https://github.com/sjgant80-hub/fallforgemint-rerun).

## What you do (plain English)

1. Type what you want the model to do.
2. Paste a few examples — an input, and the correct answer.
3. Press **Mint my model**. You get a real Ollama **Modelfile** — download it.
4. Install the free [Ollama](https://ollama.com) app and paste two lines. You now own a private model that does your job.

There's also a **live in-browser preview** (nothing to install) and a **proof** you can re-check yourself — a real signed mint receipt that the page re-verifies in front of you, and that is allowed to say a model *lost*.

## Why it's real, not a demo

The page runs the **exact same code the mutation gate proves**. `kernel.mjs` is inlined into `index.html` by `make-page.mjs`; CI regenerates it and fails if the shipped logic ever drifts from the gated kernel. The kernel is pure and total — garbage in returns a plain-English reason, never a crash.

## Re-run it in CI (the rail)

A scorecard proves nobody edited the numbers. The **re-run rail** (`.github/workflows/rerun.yml`) lets a neutral machine check the result itself. Give it a **re-run bundle** — the signed scorecard, the recipe (task, base, the examples the model was given) and the held-out rows. The page's *Download re-run bundle* button makes one. A clean GitHub runner then makes two judgements:

1. **Re-verify.** It recomputes every recorded number from the bundle: the bundle and receipt fingerprints, the rebuilt Modelfile's hash, the task and evidence hashes, the re-graded scores, the held-out disjointness against the rebuilt recipe, the runtime label, and the Ed25519 signature. If the receipt names a CI run (its `rerun` link), the rail looks that run up on GitHub and checks it made **this exact receipt** (see *The rerun link* below). Any mismatch is **TAMPERED**: the job fails and nothing is re-executed.
2. **Re-execute.** It installs Ollama (pinned), rebuilds the minted model, and runs every held-out input through the base and the minted model again at temperature 0. It then grades the results.
   - **Same runtime and model digest:** the hits must match exactly (**REPRODUCED**).
   - **Different runtime:** a browser scorecard is re-run on Ollama's `qwen2.5:0.5b`, so the verdict must hold (**AGREES**).
   - **Otherwise:** **DID_NOT_REPRODUCE**, and the job fails.

The verdict is written to the job summary. A self-hashed attestation, bound to that run's URL, is uploaded as the `rerun-result` artifact. Every judgement lives in `kernel.mjs`, which is mutation-gated. `tools/rerun.mjs` is only the edge that talks to Ollama.

**Run it yourself.** You can't start a workflow on someone else's repo, so the rail comes to yours:

- **Template (recommended):** open [fallforgemint-rerun](https://github.com/sjgant80-hub/fallforgemint-rerun), press *Use this template*, add your bundle (e.g. `bundle.json`), then Actions → **rerun** → Run workflow. Your repo calls this repo's `rerun.yml` as a reusable workflow, and the rail always checks its code out at the commit of the workflow you call, so the code that judges your bundle comes from here, not from your copy.
- **Fork:** fork this repo, open its **Actions** tab and enable workflows (GitHub switches them off in a new fork), then run `rerun` with your bundle's path. A fork runs its own copy of the workflow, so whoever reads your run should check it is unchanged, and a scorecard minted in a fork never counts as minted by the rail (below).

`mode: mint` (here or in the template) makes a fresh scorecard on the runner from a spec (`rerun/proof/spec.json`). Its receipt's `rerun` field is that run's URL.

### The rerun link

A `rerun` link is a claim: *this CI run measured me*. Anyone can paste a genuine run's link into a forged receipt, so the rail does not take the text on trust. It looks the run up on GitHub and returns one of three answers:

- **BOUND**: the run is real and succeeded, it ran the rail's own workflow at a commit on this repo's main line, the receipt was stamped while it was running, and the bundle it uploaded (its `rerun-result` artifact) holds **this exact receipt, signature included**. A run in another repo counts only when it is a single job that calls this rail at a main-line commit that checks out its own code; then nothing else in the run could have swapped the artifact, and the caller could not choose the code.
- **RUN ONLY**: all of that except the last. GitHub keeps a run's artifact for about 90 days. After that the rail says only what is still true: the run was the rail, it succeeded, and it was running when the receipt was stamped. It does not say the run made this exact receipt, because that can no longer be checked. The job passes and the summary says which it was.
- **NOT BOUND**: no such run, not the rail, not a success, the wrong time, or it minted a different receipt. That is **TAMPERED**, and the job fails.

The kernel still refuses any `rerun` value that is not shaped like a GitHub Actions run URL, so the field can never hold a placeholder.

### Proof runs

**Proven both ways, on real runs** (from one scorecard minted in CI; `rerun/proof/make-tampered.mjs` shows exactly how the forged and tampered ones were made):
<!-- RAIL-RUNS -->
The proof scorecard, [`genuine.json`](https://github.com/sjgant80-hub/fallforgemint/blob/main/rerun/proof/genuine.json), was minted on a GitHub runner by [run 36431565425](https://github.com/sjgant80-hub/fallforgemint/actions/runs/36431565425): 4/5 vs base 0/5, **BEATS**, held-out hash-disjoint. Its receipt's `rerun` link is that run.

| Bundle | What was done to it | Verdict | Real runs |
|---|---|---|---|
| [`genuine.json`](https://github.com/sjgant80-hub/fallforgemint/blob/main/rerun/proof/genuine.json) | nothing | ✓ link **BOUND** (the run it names made this exact receipt), then **REPRODUCED**; the job passes | [Xeon 8573C](https://github.com/sjgant80-hub/fallforgemint/actions/runs/36439560027) · from the template repo: [EPYC 9V45](https://github.com/sjgant80-hub/fallforgemint-rerun/actions/runs/36439663756) |
| [`caller-minted.json`](https://github.com/sjgant80-hub/fallforgemint/blob/main/rerun/proof/caller-minted.json) | nothing; minted through the template ([run 36439678449](https://github.com/sjgant80-hub/fallforgemint-rerun/actions/runs/36439678449)), so its link names a run in another repo | ✓ link **BOUND** through the caller path, then **REPRODUCED** | [EPYC 7763](https://github.com/sjgant80-hub/fallforgemint/actions/runs/36440212447) |
| [`forged.json`](https://github.com/sjgant80-hub/fallforgemint/blob/main/rerun/proof/forged.json) | the one wrong answer rewritten to the right one, every hash recomputed, re-signed with a fresh key, **the genuine run's link kept** | ✗ **TAMPERED** on the link alone: every number recomputes, but the run it names minted a different receipt. The job fails and nothing is re-executed | [EPYC 7763](https://github.com/sjgant80-hub/fallforgemint/actions/runs/36439573329) |
| [`forged-no-link.json`](https://github.com/sjgant80-hub/fallforgemint/blob/main/rerun/proof/forged-no-link.json) | the same forgery, claiming no CI run | ✗ **DID NOT REPRODUCE**: it re-verifies clean, re-execution catches it, the job fails | [Xeon 8573C](https://github.com/sjgant80-hub/fallforgemint/actions/runs/36439586892) |
| [`tampered.json`](https://github.com/sjgant80-hub/fallforgemint/blob/main/rerun/proof/tampered.json) | the minted hit count raised by one, nothing re-hashed | ✗ **TAMPERED**: the hashes, the signature and the link all fail | [EPYC 7763](https://github.com/sjgant80-hub/fallforgemint/actions/runs/36439601785) |
| [`fragile-first-mint.json`](https://github.com/sjgant80-hub/fallforgemint/blob/main/rerun/proof/fragile-first-mint.json) | nothing, but one borderline row flips between CPU types | ✗ **DID NOT REPRODUCE** where it flips | [EPYC 7763](https://github.com/sjgant80-hub/fallforgemint/actions/runs/36427036258) |
| [`fragile-second-mint.json`](https://github.com/sjgant80-hub/fallforgemint/blob/main/rerun/proof/fragile-second-mint.json) | nothing, but one borderline row flips between CPU types | ✓ on three runners ([1](https://github.com/sjgant80-hub/fallforgemint/actions/runs/36427814385), [2](https://github.com/sjgant80-hub/fallforgemint/actions/runs/36427851816), [3](https://github.com/sjgant80-hub/fallforgemint/actions/runs/36427865060)), ✗ where it flips | [EPYC 9V74, via the template](https://github.com/sjgant80-hub/fallforgemint-rerun/actions/runs/36427951661) |

Before the link check existed (commit 63b3899 and earlier), `genuine.json` was REPRODUCED on four runner CPU types ([Xeon 8370C](https://github.com/sjgant80-hub/fallforgemint/actions/runs/36432124174) · [Xeon 8573C](https://github.com/sjgant80-hub/fallforgemint/actions/runs/36432161176) · [EPYC 7763](https://github.com/sjgant80-hub/fallforgemint/actions/runs/36432186035) · [EPYC 9V74](https://github.com/sjgant80-hub/fallforgemint/actions/runs/36432198461)) and `forged.json`, link and all, got past re-verification and was caught only by re-execution ([EPYC 9V74](https://github.com/sjgant80-hub/fallforgemint/actions/runs/36432148743) · [EPYC 7763](https://github.com/sjgant80-hub/fallforgemint/actions/runs/36432173144)). Now it fails on the link.

**RUN ONLY has not happened on a real run yet.** Every proof run's artifact is still kept; the first expires on 2026-12-27. Until then that path is covered by the kernel's tests, not by a run.

The two fragile records are why the proof bundle holds out only rows that stay put: a local probe on the same Ollama and model digest flipped the borderline row under a change of thread count or batch size, and held every other row.
<!-- /RAIL-RUNS -->

What it shows and what it doesn't: every recorded number is recomputed, and the held-out set is run again on that runner. A small model on a CPU is not bit-exact across chip types: a borderline answer can flip between them, and the rail fails that record and shows you the row. It does not attest the machine that made the original. The link check takes GitHub's own record of the run (its commit, its jobs, its upload) as given. It says nothing about what the base model saw in its own training. The held-out claim stays narrow: the held-out answers were not in the spec the model was given (hash-disjoint).

## The gate (what CI checks on every push)

- `node --test kernel.test.mjs` — the contract and determinism suite.
- `node tools/witness.mjs mutate kernel.mjs` — the mutation gate must be **CLEAN** (survivors baselined only with a written reason in `witness.baseline.json`).
- `node make-page.mjs && git diff --exit-code index.html` — the live page IS the gated kernel.
- `node tools/page-gate.mjs` — scripts parse, no placeholders, no dead links, **no cross-repo links**, no committed secrets.
- The shipped signed manifest re-verifies — hash, Ed25519 signature, receipt and Modelfile hashes.

## Honest scope

The free mint here is **prompt-/few-shot tuning** at the Modelfile level: a real, owned, reproducible specialist — not weight fine-tuning. Weight-level tuning is the paid, done-for-you tier. The economics calculator will tell you to **keep renting** when that's genuinely cheaper. Regulated work (legal, tax, medical, financial) is off the menu — counsel first.

Published by AI-Native Solutions. MIT. ◊·κ=1.
