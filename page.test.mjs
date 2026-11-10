// page.test.mjs — G3 (CLAIMS.md): the live page runs exactly the grader the gate measured, checked against the runner's
// facts.json. Kept OUT of kernel.test.mjs on purpose: witness runs that suite against every mutant of kernel.mjs, and a
// test that compares the page's grader with the (mutated) source would kill every mutant by a hash mismatch alone,
// which would make the kill rate meaningless. CI runs this after facts.json is measured.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sha256, graderForm, graderFromPage, gateFromFacts, verifyGate } from './kernel.mjs';

test('G3: the live page runs exactly the grader the gate measured; one changed byte unbinds it', () => {
  const page = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const src = readFileSync(new URL('./kernel.mjs', import.meta.url), 'utf8');
  const facts = JSON.parse(readFileSync(new URL('./facts.json', import.meta.url), 'utf8'));
  const script = [...page.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((t) => graderFromPage(t) !== null);
  const here = sha256(graderFromPage(script)).hash;
  assert.equal(graderFromPage(script), graderForm(src));
  const bound = gateFromFacts(facts, here);
  assert.deepEqual([bound.ok, bound.bound], [true, true]);
  assert.equal(bound.gate.graderSha256, here);
  const edited = script.replace('function gradeAnswer(correct, got) {', 'function gradeAnswer(correct, got)  {');
  assert.notEqual(edited, script);
  const unbound = gateFromFacts(facts, sha256(graderFromPage(edited)).hash);
  assert.deepEqual([unbound.ok, unbound.bound, 'gate' in unbound], [true, false, false]);
  assert.match(unbound.why, /not the one the gate measured/);
});

test('the committed facts.json carries the gate block for kernel.mjs, and it adds up', () => {
  const facts = JSON.parse(readFileSync(new URL('./facts.json', import.meta.url), 'utf8'));
  const src = readFileSync(new URL('./kernel.mjs', import.meta.url), 'utf8');
  const b = gateFromFacts(facts, sha256(graderForm(src)).hash);
  assert.deepEqual([b.ok, b.bound], [true, true]);
  assert.equal(verifyGate(b.gate).valid, true);
  const tests = readFileSync(new URL('./kernel.test.mjs', import.meta.url), 'utf8').split('\r\n').join('\n');
  assert.equal(b.gate.testsSha256, sha256(tests).hash, 'the tests the mutants faced are the ones committed');
});
