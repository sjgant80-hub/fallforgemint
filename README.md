# FallForge Mint

**▶ LIVE: https://sjgant80-hub.github.io/fallforgemint/**

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

1. **Re-verify.** It recomputes every recorded number from the bundle: the bundle and receipt fingerprints, the rebuilt Modelfile's hash, the task and evidence hashes, the re-graded scores, the held-out disjointness against the rebuilt recipe, the runtime label, and the Ed25519 signature. Any mismatch is **TAMPERED**: the job fails and nothing is re-executed.
2. **Re-execute.** It installs Ollama (pinned), rebuilds the minted model, and runs every held-out input through the base and the minted model again at temperature 0. It then grades the results.
   - **Same runtime and model digest:** the hits must match exactly (**REPRODUCED**).
   - **Different runtime:** a browser scorecard is re-run on Ollama's `qwen2.5:0.5b`, so the verdict must hold (**AGREES**).
   - **Otherwise:** **DID_NOT_REPRODUCE**, and the job fails.

The verdict is written to the job summary. A self-hashed attestation, bound to that run's URL, is uploaded as the `rerun-result` artifact. Every judgement lives in `kernel.mjs`, which is mutation-gated. `tools/rerun.mjs` is only the edge that talks to Ollama.

**Run it yourself:** make a repo from the template [fallforgemint-rerun](https://github.com/sjgant80-hub/fallforgemint-rerun) (*Use this template*), add your bundle, then Actions → **rerun** → Run workflow. You can also fork this repo and run `rerun` with your bundle's path. `mode: mint` makes a fresh scorecard on the runner from a spec (`rerun/proof/spec.json`). Its receipt's `rerun` field is that run's URL. The kernel refuses any `rerun` value that is not a real GitHub Actions run URL, so it can never hold a placeholder.

**Proven both ways, on real runs** (from one scorecard minted in CI; `rerun/proof/make-tampered.mjs` shows exactly how the failing two were made):
<!-- RAIL-RUNS -->
_The proof runs are linked here once they have run._
<!-- /RAIL-RUNS -->

What it shows and what it doesn't: every recorded number is recomputed, and the held-out set is run again on that runner. It does not attest the machine that made the original. It says nothing about what the base model saw in its own training. The held-out claim stays narrow: the held-out answers were not in the spec the model was given (hash-disjoint).

## The gate (what CI checks on every push)

- `node --test kernel.test.mjs` — the contract and determinism suite.
- `node tools/witness.mjs mutate kernel.mjs` — the mutation gate must be **CLEAN** (survivors baselined only with a written reason in `witness.baseline.json`).
- `node make-page.mjs && git diff --exit-code index.html` — the live page IS the gated kernel.
- `node tools/page-gate.mjs` — scripts parse, no placeholders, no dead links, **no cross-repo links**, no committed secrets.
- The shipped signed manifest re-verifies — hash, Ed25519 signature, receipt and Modelfile hashes.

## Honest scope

The free mint here is **prompt-/few-shot tuning** at the Modelfile level: a real, owned, reproducible specialist — not weight fine-tuning. Weight-level tuning is the paid, done-for-you tier. The economics calculator will tell you to **keep renting** when that's genuinely cheaper. Regulated work (legal, tax, medical, financial) is off the menu — counsel first.

Published by AI-Native Solutions. MIT. ◊·κ=1.
