#!/usr/bin/env node
// tools/facts.mjs — the gate's own numbers, for the page's blueprint. CI runs each organ's tests and its witness mutation
// gate, then runs this over their outputs and fails if facts.json differs from what it just measured. make-page.mjs inlines
// facts.json into index.html, so every test count and mutation score on the page is the runner's own — never typed.
//   node tools/facts.mjs <file>=<tests.out>,<witness.out> [...]   → writes facts.json
import { readFileSync, writeFileSync } from 'node:fs';

const WITNESS = 'sjgant80-hub/witness v0.6';
const pairs = process.argv.slice(2);
if (!pairs.length) { console.error('usage: node tools/facts.mjs <file>=<tests.out>,<witness.out> ...'); process.exit(2); }

function testsOf(text, file) {
  const n = text.match(/^(?:#|ℹ) tests (\d+)\s*$/m), fail = text.match(/^(?:#|ℹ) fail (\d+)\s*$/m);
  if (!n || !fail) throw new Error(file + ': no test summary in its test output');
  if (Number(fail[1]) !== 0) throw new Error(file + ': ' + fail[1] + ' test(s) fail — no facts from a red suite');
  return Number(n[1]);
}
function witnessOf(text, file) {
  const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  if (j.clean !== true) throw new Error(file + ': the mutation gate is not clean');
  if (j.capped !== false) throw new Error(file + ': the mutation run was capped — raise --cap so every mutant runs');
  return { mutants: j.total, killed: j.killed, equivalent: j.ignored.length, survived: j.survived.length, score: j.score };
}

const organs = [];
for (const p of pairs) {
  const [file, outs] = p.split('=');
  const [testsOut, witnessOut] = (outs || '').split(',');
  if (!file || !testsOut || !witnessOut) { console.error('bad argument: ' + p); process.exit(2); }
  organs.push({ file, tests: testsOf(readFileSync(testsOut, 'utf8'), file), ...witnessOf(readFileSync(witnessOut, 'utf8'), file) });
}
const facts = {
  about: 'Measured on GitHub\'s runner by the gate on every push: each organ\'s tests, then its witness mutation gate. tools/facts.mjs writes this file from those runs and the gate fails if the committed copy differs. The page reads it.',
  witness: WITNESS,
  organs,
};
writeFileSync(new URL('../facts.json', import.meta.url), JSON.stringify(facts, null, 2) + '\n');
console.log('facts: ' + organs.map((o) => o.file + ' ' + o.tests + ' tests, witness ' + o.killed + '/' + o.mutants + (o.equivalent ? ' (' + o.equivalent + ' reviewed-equivalent)' : '')).join(' · '));
