# FallForge Mint · the number inside the check · sealed claims (seal 1, before any code)

2026-11-10. Every bar is fixed here before the code is written. A claim that misses its bar is kept and shown as failed.

## Why

A signed scorecard proves nobody edited the numbers. Signed, hash-chained receipts are now free open-source tools, so
that alone is no longer worth much. What a buyer cannot get from them is how strong the check behind the PASS is. This
build puts that number on every new scorecard receipt: the grader that judged the delivery is broken on purpose,
mutant by mutant (witness v0.6), and the receipt carries how many of those broken graders its own tests stopped, every
mutant they did not stop with its written reason, and one plain limit line. (Research brief #7, 26 Oct, and #8, 9 Nov:
"the receipt is the envelope; the number inside it is the product".)

## What is built

- A `gate` block on the scorecard receipt, additive: a receipt without one still verifies exactly as before.
  - `grader` (the file that judged: `kernel.mjs`);
  - `graderSha256`, the SHA-256 of the grader's code exactly as the page runs it (the file with `export ` removed at
    line starts and trailing space trimmed), and `testsSha256`, the SHA-256 of the test file the mutants faced;
  - `witness` (`sjgant80-hub/witness v0.6`), `tests`, `mutants`, `killed`, `equivalent`, `survived`;
  - `killRate` = killed ÷ mutants, with nothing excused in the number;
  - `survivors[]`: every mutant the tests did not kill, each `{ line, mutation, snippet, reason }`;
  - `limit`: one sentence generated from those numbers, never typed: how many broken versions were stopped out of
    how many tried, that the survivors are listed with their reasons, and that the check cannot see a fault outside
    what it grades and says nothing about inputs unlike the held-out set.
- The numbers come only from witness on GitHub's runner. `facts.json` (already re-measured and diffed by the gate on
  every push) gains each organ's two hashes and its survivors.

## The claims

- **G1 · the field.** Every scorecard receipt the page mints, and every receipt the rail mints in CI, carries the
  `gate` block with the numbers in the committed `facts.json` for `kernel.mjs`. Receipts made before this build verify
  unchanged.
- **G2 · it adds up, or it is refused.** `verifyScorecardReceipt` returns valid: false for a gate block that does not
  add up, and `scorecardReceipt` refuses to issue one. Bar: **every** planted inconsistent block is refused (a killRate
  that is not killed ÷ mutants; killed + equivalent + survived ≠ mutants; a survivor count ≠ mutants − killed; a
  survivor with no reason; a limit line that is not the one the numbers generate; a hash that is not 64 hex
  characters; a count that is not a whole number), at least 10 kinds; **zero** genuine blocks refused.
- **G3 · nobody touched the grader, checked in the tab.** The page hashes the grader code it is running and binds the
  gate block only when that hash equals `graderSha256` in `facts.json`. If they differ, the receipt carries no gate
  block and the page says why. Bar: on the live page the hashes match and the block is bound; a test that edits one
  byte of the inlined grader gets no block.
- **G4 · the rail confirms it.** For a receipt with a gate block, the re-run rail compares it with its own checkout:
  **CONFIRMED** when the grader and tests hashes equal its own and every number equals its `facts.json`;
  **CONTRADICTED** when the hashes are equal but any number differs (a re-verification failure, so TAMPERED, and the
  job fails); **OTHER_VERSION** when the hashes differ (it says it cannot confirm the number here and does not fail).
  The attestation records the level. Bar, on real runs of the rail on GitHub: a receipt minted in CI → CONFIRMED; the
  same receipt with its numbers edited consistently, re-hashed and re-signed → TAMPERED, job failed.
- **G5 · the page.** The page shows the gate block on every scorecard it mints and explains it in How it works, the
  blueprint and the brochure, read from `facts.json` and the receipt. No number of it is typed into the page.
- **G6 · the gate on the code.** witness v0.6 on `kernel.mjs`, uncapped: CLEAN, with nothing newly baselined (the one
  reviewed-equivalent mutant already baselined stays, with its reason). The kernel and cost-case tests pass, the page
  fixpoint holds, `facts.json` re-derives on the runner and the page gate passes. CI green.

## What this is not

The kill rate measures this grader against the mutants witness makes of it, with these tests. It bounds the faults we
tried, not every fault there is. It says nothing about whether the held-out examples are the right ones, or about
inputs unlike them. A receipt is still self-issued unless the rail re-runs it.
