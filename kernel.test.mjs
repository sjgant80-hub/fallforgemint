import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SYSTEM, MAX_FEWSHOT, MAX_MSG, MAX_ROUNDS, TEMP_MIN, TEMP_MAX, PREDICT_MIN, PREDICT_MAX,
  MONTHS_PER_YEAR, MAX_EXAMPLES,
  sha256, canon, validSpec, assembleModelfile, mintVerdict,
  makeManifest, signable, attachSignature, verifyManifest,
  ownVsRent, specFromTask,
} from './kernel.mjs';

test('sha256 + canon: FIPS-pinned, order-blind, primitive-distinct', () => {
  assert.equal(sha256('abc').hash, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256('').hash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256(7).ok, false);
  assert.equal(canon({ b: 1, a: 2 }), canon({ a: 2, b: 1 }));
  assert.notEqual(canon({ x: 5 }), canon({ x: '5' }));
  assert.notEqual(canon({ x: null }), canon({ x: 0 }));
  assert.notEqual(canon({ x: true }), canon({ x: false }));
});

const SPEC = {
  system: 'You are a triage engine. Reply with only JSON.',
  fewshot: [{ user: 'broken kettle, order 12', assistant: '{"category":"refund"}' }],
  params: { temperature: 0, num_predict: 200 },
};

test('validSpec: a good spec passes; every bound is exact', () => {
  assert.equal(validSpec(SPEC).ok, true);
  assert.equal(validSpec({ ...SPEC, system: 'x'.repeat(MAX_SYSTEM) }).ok, true);          // AT the bound
  assert.equal(validSpec({ ...SPEC, system: 'x'.repeat(MAX_SYSTEM + 1) }).ok, false);     // one past
  assert.equal(validSpec({ ...SPEC, fewshot: Array(MAX_FEWSHOT).fill(SPEC.fewshot[0]) }).ok, true);
  assert.equal(validSpec({ ...SPEC, fewshot: Array(MAX_FEWSHOT + 1).fill(SPEC.fewshot[0]) }).ok, false);
  assert.equal(validSpec({ ...SPEC, fewshot: [] }).ok, true);                             // empty fewshot allowed
  const long = { user: 'x'.repeat(MAX_MSG), assistant: 'y' };
  assert.equal(validSpec({ ...SPEC, fewshot: [long] }).ok, true);
  assert.equal(validSpec({ ...SPEC, fewshot: [{ user: 'x'.repeat(MAX_MSG + 1), assistant: 'y' }] }).ok, false);
  const P = (params) => validSpec({ ...SPEC, params });
  assert.equal(P({ temperature: TEMP_MIN, num_predict: 200 }).ok, true);                  // 0 valid
  assert.equal(P({ temperature: TEMP_MAX, num_predict: 200 }).ok, true);                  // 1 valid
  assert.equal(P({ temperature: -0.01, num_predict: 200 }).ok, false);
  assert.equal(P({ temperature: 1.01, num_predict: 200 }).ok, false);
  assert.equal(P({ temperature: 0, num_predict: PREDICT_MIN }).ok, true);
  assert.equal(P({ temperature: 0, num_predict: PREDICT_MAX }).ok, true);
  assert.equal(P({ temperature: 0, num_predict: PREDICT_MIN - 1 }).ok, false);
  assert.equal(P({ temperature: 0, num_predict: PREDICT_MAX + 1 }).ok, false);
  assert.equal(P({ temperature: 0, num_predict: 200.5 }).ok, false);
  assert.equal(P({ temperature: NaN, num_predict: 200 }).ok, false);
});

test('validSpec: each clause refuses with its TRUE reason', () => {
  assert.match(validSpec(null).why, /is an object/);
  assert.match(validSpec({ ...SPEC, system: '   ' }).why, /non-empty system/);
  assert.match(validSpec({ ...SPEC, system: 7 }).why, /non-empty system/);
  assert.match(validSpec({ ...SPEC, fewshot: 'x' }).why, /must be an array/);
  assert.match(validSpec({ ...SPEC, fewshot: [{ user: 'u', assistant: '  ' }] }).why, /empty side/);
  assert.match(validSpec({ ...SPEC, fewshot: [{ user: 'u' }] }).why, /user, assistant/);
  assert.match(validSpec({ ...SPEC, fewshot: [7] }).why, /user, assistant/);
  assert.match(validSpec({ ...SPEC, params: null }).why, /needs params/);
});

test('validSpec: the triple-quote fence is refused in EVERY field it could escape from', () => {
  assert.match(validSpec({ ...SPEC, system: 'a """ b' }).why, /triple-quote/);
  assert.match(validSpec({ ...SPEC, fewshot: [{ user: 'a """ b', assistant: 'y' }] }).why, /triple-quote/);
  assert.match(validSpec({ ...SPEC, fewshot: [{ user: 'u', assistant: 'a """ b' }] }).why, /triple-quote/);
});

test('assembleModelfile: deterministic, byte-pinned', () => {
  const r = assembleModelfile('llama3.2:1b', SPEC);
  assert.equal(r.ok, true);
  assert.equal(r.modelfile,
    'FROM llama3.2:1b\n' +
    'PARAMETER temperature 0\n' +
    'PARAMETER num_predict 200\n' +
    'SYSTEM """You are a triage engine. Reply with only JSON."""\n' +
    'MESSAGE user """broken kettle, order 12"""\n' +
    'MESSAGE assistant """{"category":"refund"}"""\n');
  assert.equal(assembleModelfile('llama3.2:1b', SPEC).modelfile, r.modelfile);   // same spec, same bytes
  assert.equal(assembleModelfile('', SPEC).ok, false);
  assert.equal(assembleModelfile('bad name', SPEC).ok, false);                   // whitespace in base
  assert.equal(assembleModelfile('llama3.2:1b', { ...SPEC, system: '"""' }).ok, false);
  const noShot = assembleModelfile('m:1', { ...SPEC, fewshot: [] });
  assert.equal(noShot.ok, true);
  assert.equal(noShot.modelfile.includes('MESSAGE'), false);
});

test('mintVerdict: ONLY a certified BEATS mints', () => {
  const base = { kind: 'fallforge-gate-receipt', verdict: 'BEATS', certified: true };
  assert.equal(mintVerdict(base).minted, true);
  assert.equal(mintVerdict({ ...base, certified: false }).minted, false);
  assert.match(mintVerdict({ ...base, certified: false }).why, /not certified/);
  assert.equal(mintVerdict({ ...base, verdict: 'LOSES' }).minted, false);
  assert.equal(mintVerdict({ ...base, verdict: 'MATCHES' }).minted, false);
  assert.match(mintVerdict({ ...base, verdict: 'LOSES' }).why, /did not beat/);
  assert.equal(mintVerdict({ ...base, kind: 'other' }).ok, false);
  assert.equal(mintVerdict({ kind: 'fallforge-gate-receipt', certified: true }).ok, false);  // no verdict
  assert.equal(mintVerdict(null).ok, false);
});

const MANI = {
  node: 'triage-1b', base: 'llama3.2:1b', limb: 'qwen2.5:14b',
  evalName: 'support-triage-v1', trainHash: 'a'.repeat(64),
  modelfile: 'FROM llama3.2:1b\n', rounds: 2, createdAt: '2026-09-14T20:00:00Z',
  receipts: [{ vs: 'llama3.2:1b', hash: 'b'.repeat(64), verdict: 'BEATS', certified: true }],
};

test('makeManifest: built from facts, hashed, tamper shows', () => {
  const r = makeManifest(MANI);
  assert.equal(r.ok, true);
  assert.equal(r.manifest.kind, 'fallforge-mint-manifest');
  assert.equal(r.manifest.modelfileHash, sha256(MANI.modelfile).hash);
  assert.match(r.manifest.tuning, /prompt-tuned/);
  assert.match(r.manifest.scope, /never a general claim/);
  assert.equal(verifyManifest(r.manifest).valid, true);
  assert.equal(verifyManifest({ ...r.manifest, node: 'other' }).valid, false);
  assert.equal(verifyManifest({ ...r.manifest, rounds: 1 }).valid, false);
  assert.equal(verifyManifest({ ...r.manifest, receipts: [] }).valid, false);
  assert.equal(verifyManifest({ kind: 'fallforge-mint-manifest' }).ok, false);
  assert.equal(verifyManifest('x').ok, false);
});

test('makeManifest: every guard refuses — bounds exact, hex exact', () => {
  assert.equal(makeManifest({ ...MANI, rounds: 1 }).ok, true);
  assert.equal(makeManifest({ ...MANI, rounds: MAX_ROUNDS }).ok, true);
  assert.equal(makeManifest({ ...MANI, rounds: 0 }).ok, false);
  assert.equal(makeManifest({ ...MANI, rounds: MAX_ROUNDS + 1 }).ok, false);
  assert.equal(makeManifest({ ...MANI, rounds: 1.5 }).ok, false);
  assert.equal(makeManifest({ ...MANI, trainHash: 'a'.repeat(63) }).ok, false);
  assert.equal(makeManifest({ ...MANI, trainHash: 'z'.repeat(64) }).ok, false);
  assert.equal(makeManifest({ ...MANI, node: '' }).ok, false);
  assert.equal(makeManifest({ ...MANI, limb: 7 }).ok, false);
  assert.equal(makeManifest({ ...MANI, receipts: [] }).ok, false);
  assert.equal(makeManifest({ ...MANI, receipts: [{ vs: 'x', hash: 'b'.repeat(64), verdict: 'BEATS' }] }).ok, false);   // no certified flag
  assert.equal(makeManifest({ ...MANI, receipts: [{ vs: '', hash: 'b'.repeat(64), verdict: 'B', certified: true }] }).ok, false);
  assert.equal(makeManifest({ ...MANI, receipts: [{ vs: 'x', hash: 'b'.repeat(63), verdict: 'B', certified: true }] }).ok, false);
  assert.equal(makeManifest(null).ok, false);
});

// ═══ kill probes — clause isolation + forgeries that pass every later check ═════════════════════

test('kill: fewshot assistant side has its own exact boundary', () => {
  const at = validSpec({ ...SPEC, fewshot: [{ user: 'y', assistant: 'x'.repeat(MAX_MSG) }] });
  assert.equal(at.ok, true);
  assert.equal(validSpec({ ...SPEC, fewshot: [{ user: 'y', assistant: 'x'.repeat(MAX_MSG + 1) }] }).ok, false);
});

test('kill: fewshot entry guard — an array with the right props and a numeric user both refuse', () => {
  const arr = []; arr.user = 'u'; arr.assistant = 'a';
  assert.equal(validSpec({ ...SPEC, fewshot: [arr] }).ok, false);
  assert.equal(validSpec({ ...SPEC, fewshot: [{ user: 7, assistant: 'a' }] }).ok, false);
});

test('kill: manifest receipt guards — each clause isolated', () => {
  const R = (r) => makeManifest({ ...MANI, receipts: [r] });
  const good = { vs: 'x', hash: 'b'.repeat(64), verdict: 'BEATS', certified: true };
  const arr = []; Object.assign(arr, good);
  assert.equal(R(arr).ok, false);                                  // array with honest fields
  assert.equal(R({ ...good, vs: 7 }).ok, false);                   // numeric vs
  assert.equal(R({ ...good, verdict: 7 }).ok, false);              // numeric verdict
  assert.equal(R({ ...good, verdict: '' }).ok, false);             // empty verdict
});

test('kill: signable and verifyManifest refuse forged arrays and hashless manifests', () => {
  const m = makeManifest(MANI).manifest;
  const arr = []; Object.assign(arr, m);
  assert.equal(signable(arr).ok, false);
  assert.equal(verifyManifest(arr).ok, false);
  assert.equal(signable({ kind: 'fallforge-mint-manifest' }).ok, false);       // right kind, no hash
  assert.equal(verifyManifest({ kind: 'fallforge-mint-manifest' }).ok, false);
  assert.equal(signable({ ...m, kind: 'other' }).ok, false);                   // wrong kind, hash present
  assert.equal(verifyManifest({ ...m, kind: 'other' }).ok, false);
});

test('signable + attachSignature: the payload excludes the signature and nothing else', () => {
  const m = makeManifest(MANI).manifest;
  const s = signable(m);
  assert.equal(s.ok, true);
  assert.equal(s.payload.includes('signature'), false);
  assert.equal(s.payload.includes(m.hash), true);                    // the hash IS signed
  const signed = attachSignature(m, 'ab'.repeat(16), 'cd'.repeat(64));
  assert.equal(signed.ok, true);
  assert.equal(signed.manifest.signature.alg, 'Ed25519');
  assert.equal(signable(signed.manifest).payload, s.payload);        // signing does not move the payload
  assert.equal(verifyManifest(signed.manifest).valid, true);         // signature does not break the hash
  assert.equal(attachSignature(m, 'xz'.repeat(16), 'cd'.repeat(64)).ok, false);   // non-hex pub
  assert.equal(attachSignature(m, 'ab'.repeat(15), 'cd'.repeat(64)).ok, false);   // short pub
  assert.equal(attachSignature(m, 'abc', 'cd'.repeat(64)).ok, false);             // odd-length pub
  assert.equal(attachSignature(m, 'ab'.repeat(16), 'cd'.repeat(63)).ok, false);   // 126-hex sig
  assert.equal(attachSignature(m, 'ab'.repeat(16), 'cd'.repeat(64) + 'aa').ok, false);
  assert.equal(attachSignature('x', 'ab'.repeat(16), 'cd'.repeat(64)).ok, false);
});

// ── ownVsRent: the honest calculator — every arithmetic and every branch pinned ──────────────────
test('ownVsRent: the arithmetic is exact (pins every operator and the 1e6/12 literals)', () => {
  // 1,000,000 calls * 1000 tokens = 1e9 tokens/mo; at £5/million = £5000/mo rent.
  const r = ownVsRent({ callsPerMonth: 1000000, tokensPerCall: 1000, rentPerMillion: 5, mintFee: 2000, runPerMonth: 100 });
  assert.equal(r.ok, true);
  assert.equal(r.tokensPerMonth, 1000000000);       // calls * tokens
  assert.equal(r.rentMonthly, 5000);                // tokensPerMonth / 1e6 * rentPerMillion
  assert.equal(r.rentAnnual, 60000);                // rentMonthly * 12
  assert.equal(r.ownedYear1, 3200);                 // mintFee + runPerMonth * 12
  assert.equal(r.monthlySaving, 4900);              // rentMonthly - runPerMonth
  assert.equal(r.year1Saving, 56800);               // rentAnnual - ownedYear1
  assert.ok(Math.abs(r.breakEvenMonths - (2000 / 4900)) < 1e-9);  // mintFee / monthlySaving
  assert.equal(r.verdict, 'OWN_WINS');              // pays back inside a year
  assert.equal(MONTHS_PER_YEAR, 12);
});

test('ownVsRent: the three verdicts sit on exact boundaries (kills <=0, <=12 mutants)', () => {
  // rentMonthly built to hit each boundary. calls*tokens/1e6*rentPerMillion:
  // 1e6 calls * 200 tokens /1e6 * £1 = £200/mo rent.
  const at = (runPerMonth, mintFee) => ownVsRent({ callsPerMonth: 1000000, tokensPerCall: 200, rentPerMillion: 1, mintFee, runPerMonth });
  // monthlySaving exactly 0 → RENT_WINS, no break-even. (kills <=0 → <0)
  const zero = at(200, 500);
  assert.equal(zero.monthlySaving, 0);
  assert.equal(zero.verdict, 'RENT_WINS');
  assert.equal(zero.breakEvenMonths, null);
  // monthlySaving negative → RENT_WINS. (kills <=0 → ==0)
  const neg = at(250, 500);
  assert.equal(neg.verdict, 'RENT_WINS');
  assert.equal(neg.breakEvenMonths, null);
  // saving £100/mo, mintFee £1200 → break-even EXACTLY 12 → OWN_WINS. (kills <=12 → <12)
  const edge = at(100, 1200);
  assert.equal(edge.monthlySaving, 100);
  assert.equal(edge.breakEvenMonths, 12);
  assert.equal(edge.verdict, 'OWN_WINS');
  // saving £100/mo, mintFee £1300 → break-even 13 → OWN_LATER. (kills <=12 → >=12/==12)
  const later = at(100, 1300);
  assert.equal(later.breakEvenMonths, 13);
  assert.equal(later.verdict, 'OWN_LATER');
});

test('ownVsRent: free mint (fee 0) pays back instantly; total on every garbage input', () => {
  const free = ownVsRent({ callsPerMonth: 1000000, tokensPerCall: 200, rentPerMillion: 1, mintFee: 0, runPerMonth: 100 });
  assert.equal(free.mintFee === undefined, true);   // not echoed
  assert.equal(free.breakEvenMonths, 0);            // fee 0 / positive saving = 0 (kills atLeast0 >= → >)
  assert.equal(free.verdict, 'OWN_WINS');
  // every required field rejects non-positive / non-finite (kills above0 > → >=, and isNum guards)
  const base = { callsPerMonth: 10, tokensPerCall: 10, rentPerMillion: 10, mintFee: 10, runPerMonth: 10 };
  assert.equal(ownVsRent({ ...base, callsPerMonth: 0 }).ok, false);
  assert.equal(ownVsRent({ ...base, tokensPerCall: 0 }).ok, false);
  assert.equal(ownVsRent({ ...base, rentPerMillion: 0 }).ok, false);
  assert.equal(ownVsRent({ ...base, callsPerMonth: -1 }).ok, false);
  assert.equal(ownVsRent({ ...base, mintFee: -1 }).ok, false);       // negative fee refused
  assert.equal(ownVsRent({ ...base, runPerMonth: -1 }).ok, false);
  assert.equal(ownVsRent({ ...base, mintFee: 0 }).ok, true);         // zero fee allowed
  assert.equal(ownVsRent({ ...base, runPerMonth: 0 }).ok, true);     // zero run allowed
  assert.equal(ownVsRent({ ...base, callsPerMonth: Infinity }).ok, false);
  assert.equal(ownVsRent({ ...base, tokensPerCall: NaN }).ok, false);
  assert.equal(ownVsRent({ ...base, rentPerMillion: '5' }).ok, false);
  assert.equal(ownVsRent(null).ok, false);
  assert.equal(ownVsRent([]).ok, false);            // arrays are not spec objects
  assert.equal(ownVsRent('nope').ok, false);
});

// ── specFromTask: the live mint — a real, byte-pinned Ollama Modelfile from plain input ───────────
const EX = [
  { input: 'kettle arrived broken, order 8842', output: '{"category":"refund","urgency":"high"}' },
  { input: 'when does my parcel arrive?', output: '{"category":"delivery","urgency":"low"}' },
];

test('specFromTask: a good task + examples mint a real, deterministic Modelfile', () => {
  const r = specFromTask('sort each support message into a JSON category and urgency', EX);
  assert.equal(r.ok, true);
  assert.equal(r.base, 'llama3.2:1b');                       // default base when none given
  assert.equal(r.exampleCount, 2);
  assert.ok(r.modelfile.startsWith('FROM llama3.2:1b\n'));
  assert.ok(r.modelfile.includes('PARAMETER temperature 0'));
  assert.ok(r.modelfile.includes('You do one job: sort each support message'));
  assert.ok(r.modelfile.includes('kettle arrived broken'));  // their example is baked in
  assert.ok(r.modelfile.includes('MESSAGE user'));
  assert.ok(r.modelfile.includes('MESSAGE assistant'));
  // deterministic + fingerprint matches a fresh hash of the exact bytes
  const again = specFromTask('sort each support message into a JSON category and urgency', EX);
  assert.equal(again.modelfile, r.modelfile);
  assert.equal(again.fingerprint, r.fingerprint);
  assert.equal(r.fingerprint, sha256(r.modelfile).hash);
  assert.equal(r.fingerprint.length, 64);
  // a custom base is honoured and trimmed
  const custom = specFromTask('x', EX, '  qwen2.5:0.5b  ');
  assert.equal(custom.base, 'qwen2.5:0.5b');
  assert.ok(custom.modelfile.startsWith('FROM qwen2.5:0.5b\n'));
  // a blank base falls back to the default (kills the isStr/length guard both ways)
  assert.equal(specFromTask('x', EX, '   ').base, 'llama3.2:1b');
  assert.equal(specFromTask('x', EX, 7).base, 'llama3.2:1b');
});

test('specFromTask: every bad input is refused with a plain-English reason', () => {
  assert.equal(specFromTask('', EX).ok, false);                             // empty task
  assert.equal(specFromTask('   ', EX).ok, false);                          // whitespace task
  assert.equal(specFromTask(7, EX).ok, false);                             // non-string task
  assert.equal(specFromTask('x'.repeat(MAX_SYSTEM - 400), EX).ok, true);    // AT the task bound
  assert.equal(specFromTask('x'.repeat(MAX_SYSTEM - 400 + 1), EX).ok, false); // one past
  assert.equal(specFromTask('has a """ fence', EX).ok, false);             // fence in task
  assert.equal(specFromTask('x', 'not a list').ok, false);
  assert.equal(specFromTask('x', []).ok, false);                           // no examples
  assert.equal(specFromTask('x', Array(MAX_EXAMPLES).fill(EX[0])).ok, true);       // AT the count bound
  assert.equal(specFromTask('x', Array(MAX_EXAMPLES + 1).fill(EX[0])).ok, false);  // one past
  assert.equal(specFromTask('x', [{ input: 'a' }]).ok, false);             // missing output
  assert.equal(specFromTask('x', [{ output: 'b' }]).ok, false);            // missing input
  assert.equal(specFromTask('x', [{ input: 'a', output: 7 }]).ok, false);  // non-string output
  assert.equal(specFromTask('x', [{ input: '  ', output: 'b' }]).ok, false); // empty input
  assert.equal(specFromTask('x', [{ input: 'a', output: '  ' }]).ok, false); // empty output
  assert.equal(MAX_EXAMPLES, MAX_FEWSHOT);

  // Each side AT the length bound is allowed (kills > → >= on both input and output).
  assert.equal(specFromTask('x', [{ input: 'x'.repeat(MAX_MSG), output: 'y' }]).ok, true);
  assert.equal(specFromTask('x', [{ input: 'a', output: 'y'.repeat(MAX_MSG) }]).ok, true);

  // The friendly per-row message is the one that actually fires — asserting its TEXT stops validSpec
  // from silently shadowing these checks (kills || → && on the length and fence lines), and the row
  // number kills + 1 → - 1. The error must name the RIGHT row for a non-technical person.
  const tooLongInput = specFromTask('x', [{ input: 'x'.repeat(MAX_MSG + 1), output: 'b' }]);
  assert.equal(tooLongInput.ok, false);
  assert.ok(tooLongInput.why.startsWith('example 1 is too long'), 'input-too-long → row-1 message, got: ' + tooLongInput.why);
  const tooLongOutput = specFromTask('x', [{ input: 'a', output: 'y'.repeat(MAX_MSG + 1) }]);
  assert.ok(tooLongOutput.why.startsWith('example 1 is too long'), 'output-too-long → row-1 message, got: ' + tooLongOutput.why);
  const fenceInput = specFromTask('x', [{ input: 'a """ b', output: 'c' }]);
  assert.equal(fenceInput.ok, false);
  assert.ok(fenceInput.why.startsWith('example 1 may not contain a triple-quote'), 'fence → row-1 message, got: ' + fenceInput.why);
  const fenceOutput = specFromTask('x', [{ input: 'a', output: 'c """ d' }]);
  assert.ok(fenceOutput.why.startsWith('example 1 may not contain a triple-quote'), 'output fence → row-1 message, got: ' + fenceOutput.why);
  // A bad SECOND row must say "example 2", not 1 or 0 (kills + 1 → - 1 on the row counter).
  const secondRow = specFromTask('x', [EX[0], { input: 'a' }]);
  assert.equal(secondRow.ok, false);
  assert.ok(secondRow.why.includes('example 2'), 'second bad row must name row 2, got: ' + secondRow.why);
});
