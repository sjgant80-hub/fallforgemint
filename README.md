# FallForge Mint

**▶ LIVE: https://sjgant80-hub.github.io/fallforgemint/**

Bring one job you do a lot. Walk out **owning** the small model that does it — private, on your own machine, no per-token bill. Everything runs in your browser; your examples never leave it. Free to try.

This is a **self-contained** product: one page, no links out to any other repository.

## What you do (plain English)

1. Type what you want the model to do.
2. Paste a few examples — an input, and the correct answer.
3. Press **Mint my model**. You get a real Ollama **Modelfile** — download it.
4. Install the free [Ollama](https://ollama.com) app and paste two lines. You now own a private model that does your job.

There's also a **live in-browser preview** (nothing to install) and a **proof** you can re-check yourself — a real signed mint receipt that the page re-verifies in front of you, and that is allowed to say a model *lost*.

## Why it's real, not a demo

The page runs the **exact same code the mutation gate proves**. `kernel.mjs` is inlined into `index.html` by `make-page.mjs`; CI regenerates it and fails if the shipped logic ever drifts from the gated kernel. The kernel is pure and total — garbage in returns a plain-English reason, never a crash.

## The gate (what CI checks on every push)

- `node --test kernel.test.mjs` — the contract and determinism suite.
- `node tools/witness.mjs mutate kernel.mjs` — the mutation gate must be **CLEAN** (survivors baselined only with a written reason in `witness.baseline.json`).
- `node make-page.mjs && git diff --exit-code index.html` — the live page IS the gated kernel.
- `node tools/page-gate.mjs` — scripts parse, no placeholders, no dead links, **no cross-repo links**, no committed secrets.
- The shipped signed manifest re-verifies — hash, Ed25519 signature, receipt and Modelfile hashes.

## Honest scope

The free mint here is **prompt-/few-shot tuning** at the Modelfile level: a real, owned, reproducible specialist — not weight fine-tuning. Weight-level tuning is the paid, done-for-you tier. The economics calculator will tell you to **keep renting** when that's genuinely cheaper. Regulated work (legal, tax, medical, financial) is off the menu — counsel first.

Published by AI-Native Solutions. MIT. ◊·κ=1.
