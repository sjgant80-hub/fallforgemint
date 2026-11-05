#!/usr/bin/env node
// make-page.mjs — the page fixpoint. index.html runs the SAME code the witness gates and shows the SAME records the repo
// ships, by inlining them between markers:
//   · kernel.mjs and costcase.mjs, verbatim (exports stripped), between their ⟦…-BEGIN⟧ / ⟦…-END⟧ comment markers;
//   · the data the page reads, as <script type="application/json" id="data-…"> blocks: the sourced cost basis (vendored
//     byte for byte), the CI-minted proof bundle the "How it works" trace re-verifies, the gate's measured facts, and the
//     signed review-1b manifest + its two receipts.
// CI runs this and then `git diff --exit-code index.html`: if the shipped page's logic or data ever drifts from the gated
// files, the build goes red. One copy of each, gated once, is what the page runs — no second hand-typed copy to rot.
import { readFileSync, writeFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL('./' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = (f) => read(f).replace(/^export /gm, '').trimEnd();
let page = read('index.html');

const CODE = [
  ['kernel.mjs', '// ⟦KERNEL-BEGIN⟧ generated from kernel.mjs by make-page.mjs — do not edit here', '// ⟦KERNEL-END⟧'],
  ['costcase.mjs', '// ⟦COSTCASE-BEGIN⟧ generated from costcase.mjs by make-page.mjs — do not edit here', '// ⟦COSTCASE-END⟧'],
];
for (const [file, BEGIN, END] of CODE) {
  const a = page.indexOf(BEGIN), b = page.indexOf(END);
  if (a === -1 || b === -1 || b < a) { console.error('markers for ' + file + ' missing in index.html'); process.exit(1); }
  page = page.slice(0, a + BEGIN.length) + '\n' + code(file) + '\n' + page.slice(b);
}

const DATA = [
  ['data-basis', 'vendor/sovereign-enterprise/data/basis.json'],
  ['data-trace', 'rerun/proof/genuine.json'],
  ['data-facts', 'facts.json'],
  ['data-manifest', 'out/manifest.json'],
  ['data-receipt-base', 'out/receipt-vs-base.json'],
  ['data-receipt-qwen', 'out/receipt-vs-qwen.json'],
];
for (const [id, file] of DATA) {
  let text = read(file).trimEnd();
  try { JSON.parse(text); } catch (e) { console.error(file + ' is not JSON: ' + e.message); process.exit(1); }
  text = text.replace(/</g, '\\u003c');                       // valid JSON either way; a data block can never close itself
  const open = '<script type="application/json" id="' + id + '">';
  const a = page.indexOf(open);
  const b = a === -1 ? -1 : page.indexOf('</script>', a);
  if (a === -1 || b === -1) { console.error('data block #' + id + ' missing in index.html'); process.exit(1); }
  page = page.slice(0, a + open.length) + text + page.slice(b);
}

writeFileSync(new URL('./index.html', import.meta.url), page);
console.log('page built: ' + CODE.map(([f]) => f).join(' + ') + ' inlined, ' + DATA.length + ' data blocks (' + page.length + ' chars)');
