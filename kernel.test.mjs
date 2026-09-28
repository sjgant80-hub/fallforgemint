import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SYSTEM, MAX_FEWSHOT, MAX_MSG, MAX_ROUNDS, TEMP_MIN, TEMP_MAX, PREDICT_MIN, PREDICT_MAX,
  MONTHS_PER_YEAR, MAX_EXAMPLES,
  sha256, canon, validSpec, assembleModelfile, mintVerdict,
  makeManifest, signable, attachSignature, verifyManifest,
  ownVsRent, specFromTask, planProof, gradeAnswer, scorecard,
  b64encode, safeModelName, installerScript, INSTALLER_OS, suggestNames,
  inferFormat, hardenSpec, pickBest,
  scorecardReceipt, verifyScorecardReceipt, scorecardSignable, holdoutDisjoint,
  sizeRecommendation, LADDER, TASK_TIER, TASK_TYPES, DEPLOY_CAP, QUALITY_BUMP, SHAPE_ADJUST, CATALOG_VERSION,
  RERUN_URL, EVALUATED_ON, RUNTIME_TO_OLLAMA, evaluatorModel, rerunBundle, verifyBundle, compareRerun,
  RERUN_OUTCOMES, RERUN_SCOPE, rerunAttestation, verifyRerunAttestation,
  RAIL_HOME, RAIL_WORKFLOW, ARTIFACT_KEEP_DAYS, RERUN_LINK_LEVELS, rerunLinkCheck,
  HELDOUT_CLAIM_RUNNER, SCOPE_BROWSER, SCOPE_RUNNER,
} from './kernel.mjs';
import { Buffer } from 'node:buffer';

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

test('ownVsRent recycling: opt-in, default OFF — an absent factor leaves the receipt untouched', () => {
  const base = ownVsRent({ callsPerMonth: 1000000, tokensPerCall: 1000, rentPerMillion: 5, mintFee: 2000, runPerMonth: 100 });
  assert.equal(base.recyclingApplied, false, 'no recycling key → not applied');
  assert.equal(base.effectiveRunPerMonth, 100, 'run cost unchanged');
  assert.equal(base.runSavedPerMonth, 0);
});

test('ownVsRent recycling: cuts the OWN-side run cost only on the recurring share', () => {
  // 60% saving on a 50%-recurring workload → the run cost drops 30%
  const r = ownVsRent({ callsPerMonth: 1000000, tokensPerCall: 1000, rentPerMillion: 5, mintFee: 2000, runPerMonth: 100, recycling: { savingPct: 60, recurringFraction: 0.5 } });
  assert.equal(r.recyclingApplied, true);
  assert.equal(r.runSavedPerMonth, 30);
  assert.equal(r.effectiveRunPerMonth, 70);
  assert.equal(r.ownedYear1, 2000 + 70 * 12, 'the year-1 own cost uses the reduced run');
  // the boundary: savingPct EXACTLY 100 on all-recurring is valid → run cost to zero (kills <=100 → <100)
  const full = ownVsRent({ callsPerMonth: 1000000, tokensPerCall: 1000, rentPerMillion: 5, mintFee: 2000, runPerMonth: 100, recycling: { savingPct: 100, recurringFraction: 1 } });
  assert.equal(full.ok, true);
  assert.equal(full.effectiveRunPerMonth, 0);
});

test('ownVsRent recycling: all-unique work or 0% saving = NO discount, honestly', () => {
  const unique = ownVsRent({ callsPerMonth: 1000000, tokensPerCall: 1000, rentPerMillion: 5, mintFee: 2000, runPerMonth: 100, recycling: { savingPct: 90, recurringFraction: 0 } });
  assert.equal(unique.recyclingApplied, false, 'nothing recurs → nothing saved');
  assert.equal(unique.effectiveRunPerMonth, 100);
  const noSave = ownVsRent({ callsPerMonth: 1000000, tokensPerCall: 1000, rentPerMillion: 5, mintFee: 2000, runPerMonth: 100, recycling: { savingPct: 0, recurringFraction: 1 } });
  assert.equal(noSave.effectiveRunPerMonth, 100);
});

test('ownVsRent recycling: can flip RENT_WINS into OWN, but only via a real run-cost cut', () => {
  const inp = { callsPerMonth: 1000000, tokensPerCall: 200, rentPerMillion: 1, mintFee: 600, runPerMonth: 200 }; // rent 200/mo == run 200 → RENT_WINS
  assert.equal(ownVsRent(inp).verdict, 'RENT_WINS');
  const withRecycle = ownVsRent({ ...inp, recycling: { savingPct: 50, recurringFraction: 1 } }); // run drops to 100 → own wins
  assert.equal(withRecycle.effectiveRunPerMonth, 100);
  assert.equal(withRecycle.verdict, 'OWN_WINS');
});

test('ownVsRent recycling: a malformed factor is refused, never silently ignored', () => {
  const base = { callsPerMonth: 1000000, tokensPerCall: 1000, rentPerMillion: 5, mintFee: 2000, runPerMonth: 100 };
  assert.equal(ownVsRent({ ...base, recycling: 5 }).ok, false, 'not an object');
  assert.equal(ownVsRent({ ...base, recycling: { savingPct: 120, recurringFraction: 0.5 } }).ok, false, 'savingPct > 100');
  assert.equal(ownVsRent({ ...base, recycling: { savingPct: -1, recurringFraction: 0.5 } }).ok, false, 'savingPct < 0');
  assert.equal(ownVsRent({ ...base, recycling: { savingPct: 50, recurringFraction: 1.5 } }).ok, false, 'fraction > 1');
  assert.equal(ownVsRent({ ...base, recycling: { savingPct: 50 } }).ok, false, 'fraction missing');
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

// ── planProof: split train (few-shot) from a held-out test set the model never saw ───────────────
test('planProof: holds out the LAST n; bounds are exact', () => {
  const ex = [{input:'a',output:'1'},{input:'b',output:'2'},{input:'c',output:'3'}];
  const p = planProof(ex, 1);
  assert.equal(p.ok, true);
  assert.equal(p.train.length, 2);
  assert.equal(p.holdout.length, 1);
  assert.equal(p.holdout[0].input, 'c');            // the LAST one is held out (kills a slice-index swap)
  assert.equal(p.train[0].input, 'a');
  const p2 = planProof(ex, 2);
  assert.equal(p2.train.length, 1);
  assert.equal(p2.holdout.length, 2);
  assert.equal(p2.holdout[0].input, 'b');           // last TWO
  // bounds
  assert.equal(planProof([{input:'a',output:'1'},{input:'b',output:'2'}], 1).ok, true);  // AT the min (2 = 1+1)
  assert.equal(planProof([{input:'a',output:'1'}], 1).ok, false);                         // one too few (1 < 2)
  assert.equal(planProof(ex, 0).ok, false);         // must hold out at least 1 (kills < 1 → < 0)
  assert.equal(planProof(ex, -1).ok, false);
  assert.equal(planProof(ex, 1.5).ok, false);       // integer only
  assert.equal(planProof('nope', 1).ok, false);
});

// ── gradeAnswer: lenient, honest, deterministic ──────────────────────────────────────────────────
test('gradeAnswer: exact (normalised) or contained; never a semantic guess', () => {
  const exact = gradeAnswer('{"category":"refund"}', '  {"CATEGORY":"refund"}  '.replace('CATEGORY','category'));
  assert.equal(exact.ok, true);
  assert.equal(gradeAnswer('Refund', ' refund ').exact, true);     // whitespace + case normalised
  assert.equal(gradeAnswer('Refund', ' refund ').hit, true);
  const wrapped = gradeAnswer('refund', 'the answer is refund here');
  assert.equal(wrapped.exact, false);
  assert.equal(wrapped.contains, true);                            // contained in a chattier reply
  assert.equal(wrapped.hit, true);
  const miss = gradeAnswer('refund', 'delivery');
  assert.equal(miss.hit, false);
  assert.equal(miss.contains, false);
  // on an EXACT match, contains must be false (kills dropping the !exact guard)
  const both = gradeAnswer('refund', 'refund');
  assert.equal(both.exact, true);
  assert.equal(both.contains, false);
  assert.equal(both.hit, true);
  // total
  assert.equal(gradeAnswer('', 'x').ok, false);                    // empty correct
  assert.equal(gradeAnswer('x', 7).ok, false);
  assert.equal(gradeAnswer(7, 'x').ok, false);
});

// ── scorecard: the honest tally — BEATS / LOSES / TIES, small-sample flagged ──────────────────────
test('scorecard: counts base vs minted independently and picks the right verdict', () => {
  // minted gets both, base gets neither → BEATS by 2
  const beats = scorecard([
    { correct: 'refund', baseOut: 'delivery', mintedOut: 'refund' },
    { correct: 'fault', baseOut: 'other', mintedOut: 'fault' },
  ]);
  assert.equal(beats.ok, true);
  assert.equal(beats.baseHits, 0);
  assert.equal(beats.mintedHits, 2);
  assert.equal(beats.delta, 2);
  assert.equal(beats.verdict, 'BEATS');
  assert.equal(beats.mintedRate, 1);
  assert.equal(beats.baseRate, 0);
  assert.equal(beats.smallSample, true);            // n=2 < 5
  // base beats minted → LOSES, and proves base/minted aren't swapped (kills the ++ swap and delta order)
  const loses = scorecard([
    { correct: 'refund', baseOut: 'refund', mintedOut: 'delivery' },
    { correct: 'fault', baseOut: 'fault', mintedOut: 'other' },
  ]);
  assert.equal(loses.baseHits, 2);
  assert.equal(loses.mintedHits, 0);
  assert.equal(loses.delta, -2);
  assert.equal(loses.verdict, 'LOSES');
  // equal → TIES
  const ties = scorecard([{ correct: 'a', baseOut: 'a', mintedOut: 'a' }]);
  assert.equal(ties.delta, 0);
  assert.equal(ties.verdict, 'TIES');
  // small-sample boundary: exactly 5 rows is NOT flagged (kills < 5 → <= 5)
  const five = scorecard(Array(5).fill({ correct: 'a', baseOut: 'a', mintedOut: 'a' }));
  assert.equal(five.n, 5);
  assert.equal(five.smallSample, false);
  const four = scorecard(Array(4).fill({ correct: 'a', baseOut: 'a', mintedOut: 'a' }));
  assert.equal(four.smallSample, true);
  // total
  assert.equal(scorecard([]).ok, false);
  assert.equal(scorecard('nope').ok, false);
  assert.equal(scorecard([{ correct: 'a', baseOut: 'a' /* no mintedOut */ }]).ok, false);
  const badRow = scorecard([{ correct: 'a', baseOut: 'a', mintedOut: 'a' }, 7]);
  assert.equal(badRow.ok, false);
  assert.ok(badRow.why.includes('row 2'), 'bad second row names row 2, got: ' + badRow.why);
});

// ── frictionless own-it: base64, safe names, one-file installers ──────────────────────────────────
test('b64encode: RFC 4648 vectors + matches Buffer on every padding case and unicode', () => {
  assert.equal(b64encode('').b64, '');
  assert.equal(b64encode('f').b64, 'Zg==');
  assert.equal(b64encode('fo').b64, 'Zm8=');
  assert.equal(b64encode('foo').b64, 'Zm9v');
  assert.equal(b64encode('foob').b64, 'Zm9vYg==');
  assert.equal(b64encode('fooba').b64, 'Zm9vYmE=');
  assert.equal(b64encode('foobar').b64, 'Zm9vYmFy');
  for (const s of ['', 'a', 'ab', 'abc', 'café ☕ ◊', 'MESSAGE user """{"x":1}"""', '\n\t weird\r\n end']) {
    assert.equal(b64encode(s).b64, Buffer.from(s, 'utf8').toString('base64'), 'b64 mismatch for ' + JSON.stringify(s));
  }
  assert.equal(b64encode(7).ok, false);
});

test('safeModelName: tidy, valid, bounded — always a usable string', () => {
  assert.equal(safeModelName('My Model!'), 'my-model');
  assert.equal(safeModelName('triage-1b'), 'triage-1b');
  assert.equal(safeModelName('  Support Triage v2  '), 'support-triage-v2');
  assert.equal(safeModelName('good.name_1'), 'good.name_1');   // dot + underscore kept
  assert.equal(safeModelName('---abc---'), 'abc');             // leading/trailing punctuation stripped
  assert.equal(safeModelName(''), 'my-model');                 // empty → fallback (kills > 0 → >= 0)
  assert.equal(safeModelName('   '), 'my-model');
  assert.equal(safeModelName('!!!'), 'my-model');              // all punctuation → fallback
  assert.equal(safeModelName(7), 'my-model');                  // non-string → fallback
  assert.equal(safeModelName('a'.repeat(80)).length, 40);      // capped
});

test('installerScript: each OS embeds the real Modelfile + the ollama commands, no raw fences', () => {
  const mf = 'FROM llama3.2:1b\nPARAMETER temperature 0\nSYSTEM """do the one job"""\nMESSAGE user """hi"""\n';
  // refusals
  assert.equal(installerScript('bsd', 'x', mf).ok, false);
  assert.equal(installerScript('mac', 'x', '').ok, false);
  assert.equal(installerScript('mac', 'x', 7).ok, false);
  assert.deepEqual(INSTALLER_OS, ['mac', 'linux', 'windows']);

  const mac = installerScript('mac', 'My Model!', mf);
  assert.equal(mac.ok, true);
  assert.equal(mac.name, 'my-model');                          // name sanitised through safeModelName
  assert.equal(mac.filename, 'install-my-model.command');
  assert.ok(mac.script.startsWith('#!/bin/sh'));
  assert.ok(mac.script.includes('ollama create my-model'));
  assert.ok(mac.script.includes('ollama run my-model'));
  assert.ok(mac.script.includes('ollama.com/download'), 'honest: the installer says Ollama is needed');
  assert.ok(mac.script.includes('base64 -d > "$DIR/'), 'the redirect > must be exact shell (kills > → >= inside the script string)');
  assert.ok(mac.script.includes('&& pwd'), 'the && must be exact shell (kills && → || inside the script string)');
  assert.ok(mac.script.replace(/\n/g, '').includes(b64encode(mf.replace(/\r\n/g,'\n')).b64), 'the Modelfile is embedded as base64 (wrapped)');
  assert.ok(!mac.script.includes('"""'), 'no raw triple-quote fences leak into the script');

  const linux = installerScript('linux', 'x', mf);
  assert.equal(linux.filename, 'install-x.sh');
  assert.ok(linux.script.includes('sh install-x.sh'));         // linux run hint (kills mac/linux branch)

  const win = installerScript('windows', 'x', mf);
  assert.equal(win.filename, 'install-x.bat');
  assert.ok(win.script.startsWith('@echo off'));
  assert.ok(win.script.includes('certutil'));
  assert.ok(win.script.includes('ollama create x'));
  assert.ok(!win.script.includes('"""'));

  // round-trip: the base64 EMBEDDED IN THE SCRIPT decodes back to the exact Modelfile — proves the
  // installer actually reconstructs the model, not just that b64encode works.
  const between = mac.script.match(/<<'FF_B64_EOF'\n([\s\S]*?)\nFF_B64_EOF/);
  assert.ok(between, 'the mac script has a heredoc of base64');
  assert.equal(Buffer.from(between[1].replace(/\n/g, ''), 'base64').toString('utf8'), mf.replace(/\r\n/g,'\n'));
});

// ── model-name presets: a few sensible names read from the task ───────────────────────────────────
test('suggestNames: verb→role + nouns, capped at three, honest fallback', () => {
  const a = suggestNames('sort support messages into JSON category and urgency');
  assert.equal(a.ok, true);
  assert.equal(a.names.length, 3);                         // capped (kills >= 3 → > 3)
  assert.equal(a.names[0], 'support-sorter');              // role from the verb 'sort', paired with the first noun
  assert.ok(a.names.includes('sort-support'));             // verb + noun variant
  // no recognised verb → noun-only names, no role suffix
  const b = suggestNames('customer feedback tone');
  assert.equal(b.names[0], 'customer-feedback');
  assert.ok(b.names.includes('customer-node'));
  assert.ok(!b.names.some((n) => /sorter|classifier|extractor/.test(n)));
  // a 3-character verb still counts (kills the length >= 3 → > 3 filter)
  assert.ok(suggestNames('tag leads').names.includes('tag-leads'));
  // a 2-character word is dropped (kills length >= 3 → >= 2): 'ab' must not appear
  const c = suggestNames('ab support');
  assert.equal(c.names[0], 'support-node');
  assert.ok(!c.names.includes('ab-support'));
  // empty / all-stopwords / non-string → the default, never a broken name
  assert.deepEqual(suggestNames('').names, ['my-model']);
  assert.deepEqual(suggestNames('the a an of to').names, ['my-model']);
  assert.deepEqual(suggestNames(7).names, ['my-model']);
  // every suggestion is a valid, tidy name
  for (const n of a.names) assert.equal(safeModelName(n), n);
  // a SECOND action verb is a role-word, not a noun — it must not appear in the names (kills && → || in the noun filter)
  assert.ok(!suggestNames('sort and rank leads').names.some((n) => n.includes('rank')));
  // with only ONE noun, the role+secondNoun template must not fire and inject "undefined" (kills && → || there)
  assert.ok(!suggestNames('tag leads').names.some((n) => n.includes('undefined')));
  // duplicate candidates are de-duplicated (kills && → || in the dedup guard)
  const dup = suggestNames('sort tickets sorter').names;
  assert.equal(new Set(dup).size, dup.length);
});

// ── the refinement loop: read the format, harden the spec, pick the measured best ─────────────────
const O = (output) => ({ input: 'x', output });
test('inferFormat: reads json / number / label / freeform, json wins precedence', () => {
  assert.equal(inferFormat([O('{"a":1}'), O('[1,2]')]).format, 'json');
  assert.equal(inferFormat([O('42'), O('-3.5')]).format, 'number');
  assert.equal(inferFormat([O('refund'), O('high urgency')]).format, 'label');
  assert.equal(inferFormat([O('This is a long sentence with plenty of words here.')]).format, 'freeform');
  // a short JSON object is ALSO short/labelly — json must still win (kills the else-if order)
  assert.equal(inferFormat([O('{"x":1}')]).format, 'json');
  // looksJson needs BOTH braces: an open-brace-only string is NOT json → falls to label, not json
  assert.equal(inferFormat([O('{oops no close')]).format, 'label');       // kills the && → || in the {} clause (mutant would call it json)
  assert.equal(inferFormat([O('[1,2]')]).format, 'json');                 // bracket form (kills dropping the || second clause)
  assert.equal(inferFormat([O('[oops no close')]).format, 'label');       // kills the && → || in the [] clause too
  // label boundaries: exactly 40 chars / 4 words stays label; one past → freeform (kills <=40→<40, <=4→<4)
  assert.equal(inferFormat([O('a'.repeat(40))]).format, 'label');
  assert.equal(inferFormat([O('a'.repeat(41))]).format, 'freeform');
  assert.equal(inferFormat([O('one two three four')]).format, 'label');
  assert.equal(inferFormat([O('one two three four five')]).format, 'freeform');
  // total
  assert.equal(inferFormat([]).ok, false);
  assert.equal(inferFormat('nope').ok, false);
  assert.equal(inferFormat([{ input: 'x' }]).ok, false);
  assert.ok(inferFormat([O('{"a":1}')]).instruction.length > 0);
});

test('hardenSpec: adds a strict-format rule once, idempotent, honest', () => {
  const base = specFromTask('sort messages', [O('{"a":1}'), O('{"b":2}')]);
  assert.equal(base.ok, true);
  const h1 = hardenSpec(base.spec, [O('{"a":1}'), O('{"b":2}')]);
  assert.equal(h1.ok, true);
  assert.equal(h1.changed, true);
  assert.equal(h1.format, 'json');
  assert.ok(h1.spec.system.length > base.spec.system.length);
  assert.ok(h1.spec.system.includes('only the JSON'));
  // hardening again is a no-op (kills a mutant that always rebuilds)
  const h2 = hardenSpec(h1.spec, [O('{"a":1}'), O('{"b":2}')]);
  assert.equal(h2.changed, false);
  assert.equal(hardenSpec({ nope: true }, [O('a')]).ok, false);   // invalid spec refused
  // length guard is exact: a system that lands ON MAX_SYSTEM after hardening is still applied; one over is not.
  const instr = inferFormat([O('{"a":1}')]).instruction;
  const mkSpec = (sysLen) => ({ system: 'x'.repeat(sysLen), fewshot: [], params: { temperature: 0, num_predict: 200 } });
  const atBound = hardenSpec(mkSpec(MAX_SYSTEM - 1 - instr.length), [O('{"a":1}')]);   // final length === MAX_SYSTEM
  assert.equal(atBound.changed, true);                                                 // kills > → >=
  const overBound = hardenSpec(mkSpec(MAX_SYSTEM - instr.length), [O('{"a":1}')]);      // final length === MAX_SYSTEM + 1
  assert.equal(overBound.changed, false);
});

test('pickBest: highest score wins; a tie keeps the earlier candidate', () => {
  assert.equal(pickBest([{ score: 0.5 }, { score: 0.9 }, { score: 0.7 }]).index, 1);
  assert.equal(pickBest([{ score: 1 }]).index, 0);
  assert.equal(pickBest([{ score: 0.8 }, { score: 0.8 }]).index, 0);   // tie → earlier (kills > → >=)
  assert.equal(pickBest([{ score: 0.3 }, { score: 0.3 }, { score: 0.9 }]).index, 2);
  assert.equal(pickBest([]).ok, false);
  assert.equal(pickBest('nope').ok, false);
  const bad = pickBest([{ score: 0.5 }, { nope: 1 }]);
  assert.equal(bad.ok, false);
  assert.ok(bad.why.includes('round 2'), 'names the bad round, got: ' + bad.why);
});

// ── the downloadable scorecard receipt: self-hashed, tamper-evident, honest ───────────────────────
const RIN = {
  base: 'llama3.2:1b',
  modelFingerprint: 'a'.repeat(64), taskHash: 'b'.repeat(64), evidenceHash: 'c'.repeat(64),
  sc: { n: 2, baseHits: 0, mintedHits: 2, verdict: 'BEATS' },
  createdAt: '2026-09-17T00:00:00.000Z',
};
test('scorecardReceipt: builds a self-hashed receipt; refuses bad input', () => {
  const r = scorecardReceipt(RIN);
  assert.equal(r.ok, true);
  assert.equal(r.receipt.kind, 'fallforgemint-scorecard');
  assert.equal(r.receipt.score, 1);            // 2/2
  assert.equal(r.receipt.smallSample, true);   // n=2 < 5
  assert.equal(r.receipt.hash.length, 64);
  assert.equal(verifyScorecardReceipt(r.receipt).valid, true);
  // refusals — each guard isolated
  assert.equal(scorecardReceipt('nope').ok, false);
  assert.equal(scorecardReceipt({ ...RIN, base: '' }).ok, false);
  assert.equal(scorecardReceipt({ ...RIN, modelFingerprint: 'short' }).ok, false);
  assert.equal(scorecardReceipt({ ...RIN, taskHash: 'X'.repeat(64) }).ok, false);   // uppercase = non-hex
  assert.equal(scorecardReceipt({ ...RIN, evidenceHash: 'c'.repeat(63) }).ok, false);
  assert.equal(scorecardReceipt({ ...RIN, createdAt: '' }).ok, false);
  assert.equal(scorecardReceipt({ ...RIN, sc: { n: 0, baseHits: 0, mintedHits: 0, verdict: 'TIES' } }).ok, false);
  assert.equal(scorecardReceipt({ ...RIN, sc: { ...RIN.sc, verdict: 'MAYBE' } }).ok, false);
  assert.equal(scorecardReceipt({ ...RIN, sc: { ...RIN.sc, mintedHits: 3 } }).ok, false);   // hits > n
  assert.equal(scorecardReceipt({ ...RIN, sc: { ...RIN.sc, baseHits: -1 } }).ok, false);
  assert.equal(scorecardReceipt({ ...RIN, sc: { ...RIN.sc, mintedHits: 1.5 } }).ok, false); // non-integer
  assert.equal(scorecardReceipt({ ...RIN, sc: { ...RIN.sc, baseHits: 2, mintedHits: 2, verdict: 'TIES' } }).ok, true); // valid TIES
  // exact boundaries (kill the split < / > guards)
  assert.equal(scorecardReceipt({ ...RIN, sc: { n: 1, baseHits: 0, mintedHits: 1, verdict: 'BEATS' } }).ok, true);   // n=1 allowed (kills n<1 → n<=1)
  assert.equal(scorecardReceipt({ ...RIN, sc: { n: 2, baseHits: 0, mintedHits: 0, verdict: 'TIES' } }).ok, true);    // zero hits allowed (kills <0 → <=0)
  assert.equal(scorecardReceipt({ ...RIN, sc: { n: 2, baseHits: 2, mintedHits: 2, verdict: 'TIES' } }).receipt.verdict, 'TIES'); // hits === n allowed (kills >n → >=n)
  assert.equal(scorecardReceipt({ ...RIN, sc: { n: 2, baseHits: 3, mintedHits: 2, verdict: 'BEATS' } }).ok, false);  // baseHits > n rejected
  // smallSample boundary: n=5 is NOT small, n=4 is (kills n<5 → n<=5)
  const five = { base: 'b', modelFingerprint: 'a'.repeat(64), taskHash: 'b'.repeat(64), evidenceHash: 'c'.repeat(64), createdAt: 't', sc: { n: 5, baseHits: 1, mintedHits: 5, verdict: 'BEATS' } };
  assert.equal(scorecardReceipt(five).receipt.smallSample, false);
  assert.equal(scorecardReceipt({ ...five, sc: { ...five.sc, n: 4, mintedHits: 4 } }).receipt.smallSample, true);
});

test('holdoutDisjoint: the held-out answers are hash-disjoint from the minted spec (narrow-true anti-cheat)', () => {
  const mf = 'FROM llama3.2:1b\nSYSTEM you are a sorter\nMESSAGE user a\nMESSAGE assistant apple';
  const clean = holdoutDisjoint([{ correct: 'zebra' }, { correct: 'quokka' }], mf); // answers NOT in the spec
  assert.equal(clean.ok, true);
  assert.equal(clean.excludedFromSpec, true);            // kills leaked.length === 0 → !==0
  assert.equal(clean.checked, 2);
  assert.equal(clean.holdoutHash.length, 64);
  const leaked = holdoutDisjoint([{ correct: 'apple' }, { correct: 'zebra' }], mf); // "apple" IS in the spec
  assert.equal(leaked.excludedFromSpec, false);          // an answer present in the spec fails disjointness
  assert.equal(leaked.leaked, 1);                        // kills a.length !== 0 → === 0 (would miss the leak)
});
test('holdoutDisjoint: refuses a non-list, an empty spec, and an empty holdout', () => {
  assert.equal(holdoutDisjoint('nope', 'FROM x').ok, false);
  assert.equal(holdoutDisjoint([{ correct: 'a' }], '').ok, false);   // kills modelfile.length === 0 → !==
  assert.equal(holdoutDisjoint([], 'FROM x').ok, false);             // kills answers.length === 0 → !==
});
test('holdoutDisjoint: tolerates a malformed row (object without .correct) as an empty answer', () => {
  // kills the isObj && isStr → isObj || isStr row-map mutant (which would read .correct off a bad row and throw)
  const r = holdoutDisjoint([{ correct: 'zebra' }, { foo: 1 }], 'FROM x\nSYSTEM s');
  assert.equal(r.ok, true);
  assert.equal(r.checked, 2);
  assert.equal(r.excludedFromSpec, true);
});
test('scorecardReceipt hardening: keyClass always present; holdout + rerun bind only when valid', () => {
  const r = scorecardReceipt(RIN).receipt;
  assert.equal(r.keyClass, 'software-ed25519');          // default honest label (kills the isStr ? : default swap)
  assert.equal(r.holdoutHash, undefined);                // not given → not bound (backward-compatible)
  assert.equal(r.heldOutClaim, undefined);
  assert.equal(r.rerun, undefined);
  assert.equal(scorecardReceipt({ ...RIN, keyClass: 'hardware-tee' }).receipt.keyClass, 'hardware-tee');
  // a real 64-hex holdout hash + excluded=true binds the fields AND the narrow-true claim
  const withHold = scorecardReceipt({ ...RIN, holdoutHash: 'd'.repeat(64), holdoutExcludedFromSpec: true }).receipt;
  assert.equal(withHold.holdoutHash, 'd'.repeat(64));    // kills length === 64 → !== and the && guard
  assert.equal(withHold.holdoutExcludedFromSpec, true);  // kills === true → !==
  assert.ok(withHold.heldOutClaim.includes('hash-disjoint'));
  assert.ok(!withHold.heldOutClaim.toLowerCase().includes('memoris') && !withHold.heldOutClaim.toLowerCase().includes('hermetic')); // wording guard: never the hermetic claim
  // excluded=false → the claim is NOT shipped
  const notExcl = scorecardReceipt({ ...RIN, holdoutHash: 'd'.repeat(64), holdoutExcludedFromSpec: false }).receipt;
  assert.equal(notExcl.holdoutExcludedFromSpec, false);
  assert.equal(notExcl.heldOutClaim, undefined);
  // a too-short holdout hash is ignored (not bound)
  assert.equal(scorecardReceipt({ ...RIN, holdoutHash: 'd'.repeat(63) }).receipt.holdoutHash, undefined);
  // rerun binds ONLY a real GitHub Actions run URL; a placeholder or a non-string refuses the whole receipt
  const RUN = 'https://github.com/sjgant80-hub/fallforgemint/actions/runs/36419446992';
  assert.equal(scorecardReceipt({ ...RIN, rerun: RUN }).receipt.rerun, RUN);
  assert.equal(scorecardReceipt({ ...RIN, rerun: 'https://x/run' }).ok, false);          // the old placeholder — now refused
  assert.equal(scorecardReceipt({ ...RIN, rerun: 'TBD' }).ok, false);
  assert.equal(scorecardReceipt({ ...RIN, rerun: 123 }).ok, false);
  assert.equal(scorecardReceipt({ ...RIN, rerun: '' }).ok, false);
  // the hardened receipt still verifies
  assert.equal(verifyScorecardReceipt(withHold).valid, true);
});

test('verifyScorecardReceipt: catches tampering and a lying score, refuses non-receipts', () => {
  const rec = scorecardReceipt(RIN).receipt;
  assert.equal(verifyScorecardReceipt(rec).valid, true);
  // tamper any signed field → hash mismatch
  assert.equal(verifyScorecardReceipt({ ...rec, mintedHits: 1 }).valid, false);
  assert.equal(verifyScorecardReceipt({ ...rec, verdict: 'LOSES' }).valid, false);
  assert.equal(verifyScorecardReceipt({ ...rec, base: 'other' }).valid, false);
  // forge a receipt whose hash MATCHES its body but whose score lies vs the hits — the invariant catches it.
  const body = { ...rec }; delete body.hash; delete body.signature; body.score = 0.5;
  const forged = { ...body, hash: sha256(canon(body)).hash };
  const v = verifyScorecardReceipt(forged);
  assert.equal(v.valid, false);
  assert.ok(v.why.includes('score'), 'the lie is named, got: ' + v.why);
  // a signature does not disturb the hash (it is excluded from the body)
  assert.equal(verifyScorecardReceipt({ ...rec, signature: { alg: 'Ed25519', pub: 'aa', sig: 'bb' } }).valid, true);
  // not a receipt
  assert.equal(verifyScorecardReceipt({ kind: 'other', hash: 'x' }).ok, false);
  assert.equal(verifyScorecardReceipt({ kind: 'fallforgemint-scorecard' }).ok, false);   // no hash
});

test('scorecardSignable: the signed bytes exclude the signature and nothing else', () => {
  const rec = scorecardReceipt(RIN).receipt;
  const s = scorecardSignable(rec);
  assert.equal(s.ok, true);
  assert.equal(s.payload.includes('"signature"'), false);   // the signature is NOT part of what is signed
  assert.equal(s.payload.includes(rec.hash), true);          // the self-hash IS signed
  // attaching a signature does not move the payload → sign side and verify side agree
  const signed = { ...rec, signature: { alg: 'Ed25519', pub: 'aa', sig: 'bb' } };
  assert.equal(scorecardSignable(signed).payload, s.payload);
  // refuses non-receipts
  assert.equal(scorecardSignable({ kind: 'other', hash: 'x' }).ok, false);
  assert.equal(scorecardSignable({ kind: 'fallforgemint-scorecard' }).ok, false);   // no hash
});

test('sizeRecommendation: smallest rung that clears the bar — never upsells', () => {
  // a pure classification job with a strict short shape → the 1B rung
  const clsf = sizeRecommendation({ taskType: 'classify', outputShape: 'label' });
  assert.equal(clsf.ok, true);
  assert.equal(clsf.rung.tier, 0);
  assert.equal(clsf.rung.band, '~1B');
  assert.equal(clsf.model.id, LADDER[0].models[0].id);
  assert.equal(clsf.approach, 'few-shot');            // free tier is enough
  // code generation is genuinely bigger → ~32B, and it does NOT round down to please
  const code = sizeRecommendation({ taskType: 'code' });
  assert.equal(code.rung.tier, 4);
  // the SAME task at a critical bar bumps up one rung, and the factor is shown
  const strictCls = sizeRecommendation({ taskType: 'classify', outputShape: 'json', qualityBar: 'critical' });
  assert.equal(strictCls.rung.tier, 1);
  assert.ok(strictCls.factors.some((f) => /quality bar/.test(f.input)));
  // extraction with a strict short shape stays small (shape subtracts, clamped >= 0)
  const ext = sizeRecommendation({ taskType: 'extract', outputShape: 'label' });
  assert.equal(ext.rung.tier, 0);
});

test('sizeRecommendation: deployment caps the rung honestly (no impossible advice)', () => {
  // a reasoning job wants ~32B, but a phone can only run ~4B — it caps and SAYS so
  const onPhone = sizeRecommendation({ taskType: 'reason', deployment: 'phone' });
  assert.equal(onPhone.wantedTier, 4);
  assert.equal(onPhone.rung.tier, 1);                 // capped to DEPLOY_CAP.phone
  assert.equal(onPhone.capped, true);
  assert.ok(onPhone.factors.some((f) => /capped/.test(String(f.effect))));
  // on a server the same job is not capped
  const onServer = sizeRecommendation({ taskType: 'reason', deployment: 'server' });
  assert.equal(onServer.capped, false);
  assert.equal(onServer.rung.tier, 4);
  assert.equal(DEPLOY_CAP.phone < DEPLOY_CAP.server, true);
});

test('sizeRecommendation: real named models, a second opinion, and honesty — total on garbage', () => {
  const r = sizeRecommendation({ taskType: 'summarise', deployment: 'laptop' });
  assert.equal(r.rung.tier, 2);
  assert.equal(r.model.id, 'llama3.1:8b');
  assert.ok(r.model.paramsB > 0 && typeof r.model.licence === 'string');
  assert.equal(r.baseForMint, r.model.id);            // feeds straight into the mint's base field
  assert.equal(r.secondOpinion.model.id, LADDER[3].models[0].id);   // one rung up, for A/B
  assert.ok(r.honesty.includes('scorecard'));         // the proof is the scorecard, not the rung
  assert.equal(r.catalogVersion, CATALOG_VERSION);
  assert.ok(r.catalogNote.length > 20);               // provenance carried, not hidden
  // top rung (uncapped) has no second opinion
  assert.equal(sizeRecommendation({ taskType: 'frontier', deployment: 'server' }).secondOpinion, null);
  // and when a frontier task is capped down to laptop, a one-rung-up second opinion IS offered honestly
  assert.equal(sizeRecommendation({ taskType: 'frontier', deployment: 'laptop' }).capped, true);
  // refusals — each guard isolated, and never a throw
  assert.equal(sizeRecommendation('nope').ok, false);
  assert.equal(sizeRecommendation({}).ok, false);
  assert.equal(sizeRecommendation({ taskType: 'teleport' }).ok, false);
  assert.equal(sizeRecommendation({ taskType: 'classify', qualityBar: 'perfect' }).ok, false);
  assert.equal(sizeRecommendation({ taskType: 'classify', outputShape: 'haiku' }).ok, false);
  assert.equal(sizeRecommendation({ taskType: 'classify', deployment: 'toaster' }).ok, false);
});

test('sizeRecommendation: tune vs few-shot boundaries, shape factors, reasoning + context edges', () => {
  const S = (p) => sizeRecommendation({ deployment: 'server', ...p });
  // tuneWanted is TRUE only at tier>=3 AND (strict|critical) AND >=20 examples — pin every edge
  assert.equal(S({ taskType: 'summarise', qualityBar: 'strict', exampleCount: 20 }).approach, 'tune');  // tier 2+1=3 exactly (kills tier>=3 → tier>3)
  assert.equal(S({ taskType: 'instruct', qualityBar: 'strict', exampleCount: 20 }).approach, 'tune');   // tier 3+1=4
  assert.equal(S({ taskType: 'instruct', qualityBar: 'critical', exampleCount: 25 }).approach, 'tune');
  assert.equal(S({ taskType: 'instruct', qualityBar: 'strict', exampleCount: 19 }).approach, 'few-shot'); // 19 < 20 (kills >=20 → >20)
  assert.equal(S({ taskType: 'extract', qualityBar: 'strict', exampleCount: 50 }).approach, 'few-shot');   // tier 1+1=2 < 3 (kills tier>=3 → >3 and the first &&→||)
  assert.equal(S({ taskType: 'instruct', qualityBar: 'standard', exampleCount: 50 }).approach, 'few-shot'); // standard, not strict/critical (kills === and ||→&&)
  assert.equal(S({ taskType: 'reason', qualityBar: 'strict', exampleCount: 20 }).approach, 'tune');       // tier 4 >= 3 (kills tier>=3 → >3 needs a ==3 true AND >3 true; the ==3 case above covers <)
  // exampleCount is echoed and total on nonsense (kills the isInt guard both ways)
  assert.equal(S({ taskType: 'classify', exampleCount: 7 }).exampleCount, 7);
  assert.equal(S({ taskType: 'classify', exampleCount: 'lots' }).exampleCount, 0);
  assert.equal(S({ taskType: 'classify' }).exampleCount, 0);
  // shape factor: sa=0 shapes add NO shape factor; sa!=0 shapes DO, with the right sign (kills !==0→===0 and the sign)
  const jsonShape = S({ taskType: 'summarise', outputShape: 'json' });
  assert.equal(jsonShape.factors.some((f) => /output shape/.test(f.input)), false);
  const longShape = S({ taskType: 'summarise', outputShape: 'longform' });
  const lf = longShape.factors.find((f) => /output shape/.test(f.input));
  assert.ok(lf && /\+1/.test(lf.effect));                     // longform is +1 rung
  const labelShape = S({ taskType: 'summarise', outputShape: 'label' });
  const lb = labelShape.factors.find((f) => /output shape/.test(f.input));
  assert.ok(lb && /-1/.test(lb.effect));                      // label is -1 rung
  // needsReasoning bumps ONLY when the base task tier is below 4 (kills baseTier<4 → <=4)
  assert.equal(S({ taskType: 'summarise', needsReasoning: true }).rung.tier, 3);   // 2 + 1
  assert.equal(S({ taskType: 'reason', needsReasoning: true }).rung.tier, 4);      // baseTier 4: no bump (4<4 false, not 4<=4)
  assert.equal(S({ taskType: 'summarise', needsReasoning: false }).rung.tier, 2);  // false → no bump (kills ===true drift)
  // contextNote fires strictly above 8000 tokens and only for a numeric value (kills >8000→>=8000 and &&→||)
  assert.equal(S({ taskType: 'classify', contextTokens: 8001 }).contextNote === null, false);
  assert.equal(S({ taskType: 'classify', contextTokens: 8000 }).contextNote, null);   // exactly 8000 → no note
  assert.equal(S({ taskType: 'classify', contextTokens: 5000 }).contextNote, null);   // numeric but low → no note (kills &&→||)
  assert.equal(S({ taskType: 'classify' }).contextNote, null);                        // absent → no note
  // the deployment cap boundary: tier === cap is NOT capped (kills tier>cap → tier>=cap)
  const atCap = sizeRecommendation({ taskType: 'code', deployment: 'laptop' });        // tier 4 === laptop cap 4
  assert.equal(atCap.rung.tier, 4);
  assert.equal(atCap.capped, false);
});

test('LADDER + maps: the ladder is well-formed, ascending, and every task tier is reachable', () => {
  assert.equal(LADDER.length, 7);
  for (let i = 0; i < LADDER.length; i++) {
    assert.equal(LADDER[i].tier, i);                  // index === tier
    assert.ok(LADDER[i].models.length >= 1);
    for (const m of LADDER[i].models) {
      assert.ok(typeof m.id === 'string' && m.id.length > 0);
      assert.ok(m.paramsB > 0);
      assert.ok(typeof m.licence === 'string' && m.licence.length > 0);
    }
    if (i > 0) assert.ok(LADDER[i].approxParamsB > LADDER[i - 1].approxParamsB);   // strictly ascending
  }
  // every task tier points at a real rung
  for (const t of Object.values(TASK_TIER)) assert.ok(t >= 0 && t <= 6 && LADDER[t]);
  assert.ok(TASK_TYPES.length === Object.keys(TASK_TIER).length);
  // the shape/quality maps only ever nudge, never wildly
  for (const v of Object.values(QUALITY_BUMP)) assert.ok(v >= 0 && v <= 1);
  for (const v of Object.values(SHAPE_ADJUST)) assert.ok(v >= -1 && v <= 1);
});

// The shipped narrow-true claim must never drift to a hermetic/sealed/memorised over-claim. This asserts
// the guarantee on the REAL committed receipt path (heldOutClaim / keyClass / scope), so a future edit that
// upgrades the wording fails the build — the anti-drift guard the estate requires to survive.
test('anti-drift guard: the shipped scorecard claim carries no over-reach', () => {
  const FORBIDDEN = /hermetic|sealed|memoris|memoriz|tamper-proof|unforgeable|uncheatable|cannot have been|impossible to (?:cheat|fake|game|leak)/i;
  const mf = 'FROM llama3.2:1b\nSYSTEM """do one job"""\nMESSAGE user """train in"""\nMESSAGE assistant """train out"""\n';
  const disj = holdoutDisjoint([{ correct: 'held-answer-zzz' }], mf);   // answer NOT in the spec → claim ships
  assert.equal(disj.excludedFromSpec, true);
  const built = scorecardReceipt({
    base: 'llama3.2:1b', modelFingerprint: 'a'.repeat(64), taskHash: 'b'.repeat(64), evidenceHash: 'c'.repeat(64),
    sc: { n: 2, baseHits: 0, mintedHits: 2, verdict: 'BEATS' }, createdAt: 't',
    holdoutHash: disj.holdoutHash, holdoutExcludedFromSpec: disj.excludedFromSpec,
  });
  const r = built.receipt;
  assert.ok(r.heldOutClaim && r.heldOutClaim.length > 20);        // the narrow-true claim is present
  assert.equal(FORBIDDEN.test(r.heldOutClaim), false);           // and free of every over-reach token
  assert.equal(FORBIDDEN.test(r.scope), false);                  // so is the scope
  assert.equal(r.keyClass, 'software-ed25519');                  // honest key-class label survives
  // and the claim genuinely only ships when the answers are provably excluded (never otherwise)
  const leaked = scorecardReceipt({
    base: 'b', modelFingerprint: 'a'.repeat(64), taskHash: 'b'.repeat(64), evidenceHash: 'c'.repeat(64),
    sc: { n: 1, baseHits: 0, mintedHits: 1, verdict: 'BEATS' }, createdAt: 't',
    holdoutHash: 'd'.repeat(64), holdoutExcludedFromSpec: false,
  });
  assert.equal('heldOutClaim' in leaked.receipt, false);         // no exclusion proof → no claim
});

// ══════════════════════════ THE CI RE-RUN RAIL ══════════════════════════
const EV = 'ollama:llama3.2:1b@baf6a787fdff';
const R_TASK = 'Map a code letter to its word.';
const R_TRAIN = [{ input: 'a', output: 'alpha' }, { input: 'b', output: 'bravo' }];
const R_HOLD = [{ input: 'c', output: 'charlie' }, { input: 'd', output: 'delta' }];
function genuine(evaluatedOn = EV) {
  const spec = specFromTask(R_TASK, R_TRAIN, 'llama3.2:1b');
  const rows = R_HOLD.map((h) => ({ input: h.input, correct: h.output, baseOut: 'no idea', mintedOut: h.output }));
  const sc = scorecard(rows.map((r) => ({ correct: r.correct, baseOut: r.baseOut, mintedOut: r.mintedOut })));
  const d = holdoutDisjoint(rows, spec.modelfile);
  const receipt = scorecardReceipt({ base: spec.base, modelFingerprint: spec.fingerprint, taskHash: sha256(R_TASK).hash,
    evidenceHash: sha256(canon(rows)).hash, sc: { n: sc.n, baseHits: sc.baseHits, mintedHits: sc.mintedHits, verdict: sc.verdict },
    createdAt: 't', holdoutHash: d.holdoutHash, holdoutExcludedFromSpec: d.excludedFromSpec, evaluatedOn }).receipt;
  return { spec, rows, receipt, bundle: rerunBundle({ receipt, task: R_TASK, base: spec.base, train: R_TRAIN, rows, evaluatedOn }).bundle };
}
const rehash = (b) => { const body = { ...b }; delete body.hash; return { ...body, hash: sha256(canon(body)).hash }; };
const failing = (v) => v.checks.filter((c) => !c.ok).map((c) => c.name).sort();

test('RERUN_URL + EVALUATED_ON: only a real Actions run URL, only runtime:model[@digest]', () => {
  assert.ok(RERUN_URL.test('https://github.com/sjgant80-hub/fallforgemint/actions/runs/1'));
  assert.ok(RERUN_URL.test('https://github.com/a/b.c_d-e/actions/runs/36419446992'));
  for (const bad of ['http://github.com/a/b/actions/runs/1', 'https://gitlab.com/a/b/actions/runs/1', 'https://github.com/a/b/actions/runs/0',
    'https://github.com/a/b/actions/runs/1/job/2', 'https://github.com/a/b/actions/runs/', 'https://github.com/-a/b/actions/runs/1', 'https://x/run', ''])
    assert.equal(RERUN_URL.test(bad), false, bad);
  for (const good of [EV, 'ollama:qwen2.5:0.5b', 'webllm:Qwen2.5-0.5B-Instruct-q4f16_1-MLC', 'ollama:llama3.2:1b@' + 'a'.repeat(64)]) assert.ok(EVALUATED_ON.test(good), good);
  for (const bad of ['llama3.2:1b', 'cloud:gpt', 'ollama:', 'ollama:llama3.2:1b@abc', 'ollama:llama3.2:1b@' + 'G'.repeat(12), 'webllm: spaced']) assert.equal(EVALUATED_ON.test(bad), false, bad);
});

test('scorecardReceipt binds evaluatedOn only when valid — the runtime that produced the scores', () => {
  const g = genuine();
  assert.equal(g.receipt.evaluatedOn, EV);
  assert.equal(verifyScorecardReceipt(g.receipt).valid, true);
  const base = { base: 'b', modelFingerprint: 'a'.repeat(64), taskHash: 'b'.repeat(64), evidenceHash: 'c'.repeat(64), sc: { n: 1, baseHits: 0, mintedHits: 1, verdict: 'BEATS' }, createdAt: 't' };
  assert.equal(scorecardReceipt(base).receipt.evaluatedOn, undefined);        // absent → not bound (backward-compatible)
  assert.equal(scorecardReceipt({ ...base, evaluatedOn: 'somewhere' }).ok, false);
  assert.equal(scorecardReceipt({ ...base, evaluatedOn: 7 }).ok, false);
});

test('scope + held-out claim follow where it was measured: browser wording unchanged, Ollama wording names the runner', () => {
  const base = { base: 'b', modelFingerprint: 'a'.repeat(64), taskHash: 'b'.repeat(64), evidenceHash: 'c'.repeat(64), sc: { n: 1, baseHits: 0, mintedHits: 1, verdict: 'BEATS' }, createdAt: 't' };
  const held = { holdoutHash: 'd'.repeat(64), holdoutExcludedFromSpec: true };
  const browser = scorecardReceipt({ ...base, ...held }).receipt;                                          // an old-style browser receipt
  assert.equal(browser.scope, SCOPE_BROWSER);
  assert.ok(browser.heldOutClaim.endsWith('Anyone can re-run it in their browser.'));
  const web = scorecardReceipt({ ...base, ...held, evaluatedOn: 'webllm:Qwen2.5-0.5B-Instruct-q4f16_1-MLC' }).receipt;
  assert.deepEqual([web.scope, web.heldOutClaim], [browser.scope, browser.heldOutClaim]);               // webllm = browser wording
  const ci = scorecardReceipt({ ...base, ...held, evaluatedOn: EV }).receipt;
  assert.deepEqual([ci.scope, ci.heldOutClaim], [SCOPE_RUNNER, HELDOUT_CLAIM_RUNNER]);
  assert.equal(verifyScorecardReceipt(ci).valid, true);
  const ciNoClaim = scorecardReceipt({ ...base, evaluatedOn: EV }).receipt;                                // no disjointness proof → still no claim
  assert.deepEqual([ciNoClaim.scope, 'heldOutClaim' in ciNoClaim], [SCOPE_RUNNER, false]);
  const ciLeaky = scorecardReceipt({ ...base, holdoutHash: 'd'.repeat(64), holdoutExcludedFromSpec: false, evaluatedOn: EV }).receipt;
  assert.equal('heldOutClaim' in ciLeaky, false);
  assert.equal(SCOPE_BROWSER, "Self-issued: measured in the holder's own browser on their own held-out examples. Tamper-evident (re-hash to check) but NOT a certification by AI-Native Solutions. The done-for-you tier issues an issuer-signed certified receipt.");
});

test('evaluatorModel: which Ollama model re-executes a scorecard', () => {
  assert.deepEqual(evaluatorModel(EV), { ok: true, model: 'llama3.2:1b', runtime: 'ollama' });
  assert.deepEqual(evaluatorModel('ollama:qwen2.5:0.5b'), { ok: true, model: 'qwen2.5:0.5b', runtime: 'ollama' });
  assert.deepEqual(evaluatorModel('webllm:Qwen2.5-0.5B-Instruct-q4f16_1-MLC'), { ok: true, model: RUNTIME_TO_OLLAMA['webllm:Qwen2.5-0.5B-Instruct-q4f16_1-MLC'], runtime: 'webllm' });
  assert.equal(evaluatorModel('webllm:Unknown-Model').ok, false);           // re-verifiable, not re-executable — said so
  assert.equal(evaluatorModel('nope').ok, false);
  assert.equal(evaluatorModel(null).ok, false);
});

test('rerunBundle: a self-hashed bundle; every missing part refused', () => {
  const g = genuine();
  assert.equal(g.bundle.kind, 'fallforgemint-rerun-bundle');
  assert.equal(g.bundle.hash.length, 64);
  assert.equal(g.bundle.spec.base, 'llama3.2:1b');
  const ok = { receipt: g.receipt, task: R_TASK, base: 'llama3.2:1b', train: R_TRAIN, rows: g.rows, evaluatedOn: EV };
  assert.equal(rerunBundle(ok).ok, true);
  assert.equal(rerunBundle('x').ok, false);
  assert.equal(rerunBundle({ ...ok, receipt: { kind: 'other', hash: 'h' } }).ok, false);
  assert.equal(rerunBundle({ ...ok, receipt: { kind: 'fallforgemint-scorecard' } }).ok, false);
  assert.equal(rerunBundle({ ...ok, task: '  ' }).ok, false);
  assert.equal(rerunBundle({ ...ok, task: 5 }).ok, false);
  assert.equal(rerunBundle({ ...ok, base: '' }).ok, false);
  assert.equal(rerunBundle({ ...ok, base: 5 }).ok, false);
  assert.equal(rerunBundle({ ...ok, train: [] }).ok, false);
  assert.equal(rerunBundle({ ...ok, train: 'x' }).ok, false);
  assert.match(rerunBundle({ ...ok, train: [R_TRAIN[0], { input: 'x' }] }).why, /example 2/);
  assert.equal(rerunBundle({ ...ok, train: [{ output: 'x' }] }).ok, false);
  assert.equal(rerunBundle({ ...ok, rows: [] }).ok, false);
  assert.match(rerunBundle({ ...ok, rows: [g.rows[0], { input: 'c', correct: 'x', baseOut: 'y' }] }).why, /row 2/);
  assert.equal(rerunBundle({ ...ok, evaluatedOn: 'nowhere' }).ok, false);
});

test('verifyBundle: a genuine bundle recomputes exactly — every check named and passing', () => {
  const v = verifyBundle(genuine().bundle);
  assert.equal(v.ok, true);
  assert.equal(v.valid, true);
  assert.deepEqual(v.checks.map((c) => c.name), ['bundle-hash', 'receipt-intact', 'recipe-fingerprint', 'task-hash', 'evidence-hash', 'scores', 'held-out-disjoint', 'evaluated-on']);
  assert.ok(v.checks.every((c) => c.ok === true));
  assert.equal(v.why, 'every recorded number recomputes exactly');
  // a receipt made before evaluatedOn / holdoutHash existed skips those two checks (backward-compatible)
  const g = genuine(); const old = { ...g.receipt }; delete old.evaluatedOn; delete old.holdoutHash; delete old.holdoutExcludedFromSpec; delete old.heldOutClaim; delete old.hash;
  const oldR = { ...old, hash: sha256(canon(old)).hash };
  const vb = verifyBundle(rerunBundle({ receipt: oldR, task: R_TASK, base: 'llama3.2:1b', train: R_TRAIN, rows: g.rows, evaluatedOn: EV }).bundle);
  assert.equal(vb.valid, true);
  assert.deepEqual(vb.checks.map((c) => c.name), ['bundle-hash', 'receipt-intact', 'recipe-fingerprint', 'task-hash', 'evidence-hash', 'scores']);
});

test('verifyBundle: each tamper is caught by exactly the check that owns it', () => {
  const g = genuine();
  // edited without re-hashing → the bundle's own fingerprint breaks
  assert.deepEqual(failing(verifyBundle({ ...g.bundle, evaluatedOn: 'ollama:qwen2.5:0.5b' })), ['bundle-hash', 'evaluated-on']);
  // a recorded output rewritten (bundle re-hashed to hide it) → evidence and scores both break
  const rows2 = g.rows.map((r, i) => (i === 0 ? { ...r, baseOut: 'charlie' } : r));
  assert.deepEqual(failing(verifyBundle(rehash({ ...g.bundle, rows: rows2 }))), ['evidence-hash', 'scores']);
  // the receipt's score inflated after signing → the receipt is no longer intact
  assert.deepEqual(failing(verifyBundle(rehash({ ...g.bundle, receipt: { ...g.receipt, baseHits: 1 } }))), ['receipt-intact', 'scores']);
  // a forged receipt that is internally consistent (re-hashed) but claims hits the recorded outputs don't earn
  const forged = { ...g.receipt, baseHits: 2, mintedHits: 2, verdict: 'TIES', score: 1 }; delete forged.hash;
  assert.deepEqual(failing(verifyBundle(rehash({ ...g.bundle, receipt: { ...forged, hash: sha256(canon(forged)).hash } }))), ['scores']);
  // the recipe changed → it no longer hashes to the model that was measured
  assert.ok(failing(verifyBundle(rehash({ ...g.bundle, spec: { ...g.bundle.spec, train: [R_TRAIN[0]] } }))).includes('recipe-fingerprint'));
  // the base swapped → the fingerprint breaks
  assert.ok(failing(verifyBundle(rehash({ ...g.bundle, spec: { ...g.bundle.spec, base: 'qwen2.5:7b' } }))).includes('recipe-fingerprint'));
  // the task changed → the task hash breaks
  assert.ok(failing(verifyBundle(rehash({ ...g.bundle, spec: { ...g.bundle.spec, task: 'Something else.' } }))).includes('task-hash'));
  // a held-out answer smuggled into the recipe → the narrow-true disjointness no longer holds
  const leakyTrain = [...R_TRAIN, { input: 'z', output: 'charlie' }];
  const leaky = verifyBundle(rehash({ ...g.bundle, spec: { ...g.bundle.spec, train: leakyTrain } }));
  assert.ok(failing(leaky).includes('held-out-disjoint'));
  assert.equal(leaky.valid, false);
  assert.match(leaky.why, /^mismatch: /);
  // the runtime quietly relabelled on the bundle → the receipt still names the original
  assert.deepEqual(failing(verifyBundle(rehash({ ...g.bundle, evaluatedOn: 'ollama:qwen2.5:0.5b' }))), ['evaluated-on']);
});

test('verifyBundle: the held-out claim cannot be forged on a leaky recipe', () => {
  const leakyTrain = [...R_TRAIN, { input: 'z', output: 'charlie' }];
  const spec = specFromTask(R_TASK, leakyTrain, 'llama3.2:1b');
  const rows = R_HOLD.map((h) => ({ input: h.input, correct: h.output, baseOut: 'no', mintedOut: h.output }));
  const d = holdoutDisjoint(rows, spec.modelfile);
  assert.equal(d.excludedFromSpec, false);
  const lie = scorecardReceipt({ base: spec.base, modelFingerprint: spec.fingerprint, taskHash: sha256(R_TASK).hash, evidenceHash: sha256(canon(rows)).hash,
    sc: { n: 2, baseHits: 0, mintedHits: 2, verdict: 'BEATS' }, createdAt: 't', holdoutHash: d.holdoutHash, holdoutExcludedFromSpec: true, evaluatedOn: EV }).receipt;
  assert.ok(lie.heldOutClaim);                                                      // the receipt carries the claim…
  const v = verifyBundle(rerunBundle({ receipt: lie, task: R_TASK, base: 'llama3.2:1b', train: leakyTrain, rows, evaluatedOn: EV }).bundle);
  assert.deepEqual(failing(v), ['held-out-disjoint']);                              // …and the rail refuses it
});

test('verifyBundle: refuses what is not a bundle, never throws', () => {
  const g = genuine();
  assert.equal(verifyBundle('x').ok, false);
  assert.equal(verifyBundle({ kind: 'fallforgemint-rerun-bundle' }).ok, false);
  assert.equal(verifyBundle({ ...g.bundle, kind: 'other' }).ok, false);
  assert.equal(verifyBundle({ ...g.bundle, receipt: null }).ok, false);
  assert.equal(verifyBundle({ ...g.bundle, spec: 'x' }).ok, false);
  assert.equal(verifyBundle({ ...g.bundle, rows: 'x' }).ok, false);
  assert.equal(verifyBundle({ ...g.bundle, evaluatedOn: 5 }).ok, false);
  assert.equal(verifyBundle({ ...g.bundle, rows: [{ input: 'c' }] }).ok, false);
  // a broken recipe is reported as a failed check, not a crash
  const bad = verifyBundle(rehash({ ...g.bundle, spec: { ...g.bundle.spec, train: 'x' } }));
  assert.equal(bad.valid, false);
  assert.ok(failing(bad).includes('recipe-fingerprint') && failing(bad).includes('held-out-disjoint'));
});

test('compareRerun: REPRODUCED / AGREES / DID_NOT_REPRODUCE — the same runtime demands the same hits', () => {
  const g = genuine();
  const same = (rows) => compareRerun(g.bundle, { runtime: EV, rows });
  const r1 = same(g.rows.map((r) => ({ baseOut: r.baseOut, mintedOut: r.mintedOut })));
  assert.deepEqual([r1.outcome, r1.pass, r1.sameRuntime], ['REPRODUCED', true, true]);
  assert.deepEqual(r1.recorded, { n: 2, baseHits: 0, mintedHits: 2, verdict: 'BEATS' });
  assert.deepEqual(r1.fresh, r1.recorded);
  // same runtime, one base answer now right → hits differ → did not reproduce (even though the verdict still BEATS)
  const r2 = same([{ baseOut: 'charlie', mintedOut: 'charlie' }, { baseOut: 'x', mintedOut: 'delta' }]);
  assert.deepEqual([r2.outcome, r2.pass, r2.fresh.verdict], ['DID_NOT_REPRODUCE', false, 'BEATS']);
  // same runtime, a minted answer now wrong → hits differ
  assert.equal(same([{ baseOut: 'x', mintedOut: 'wrong' }, { baseOut: 'x', mintedOut: 'delta' }]).outcome, 'DID_NOT_REPRODUCE');
  // a DIFFERENT runtime: the exact hits may move, the verdict must hold
  const other = (rows) => compareRerun(g.bundle, { runtime: 'ollama:qwen2.5:0.5b', rows });
  const r3 = other([{ baseOut: 'x', mintedOut: 'charlie' }, { baseOut: 'x', mintedOut: 'wrong' }]);   // 1/2 vs 0/2 → still BEATS
  assert.deepEqual([r3.outcome, r3.pass, r3.sameRuntime], ['AGREES', true, false]);
  const r4 = other([{ baseOut: 'x', mintedOut: 'wrong' }, { baseOut: 'x', mintedOut: 'wrong' }]);        // TIES ≠ BEATS
  assert.deepEqual([r4.outcome, r4.pass], ['DID_NOT_REPRODUCE', false]);
  // refusals
  assert.equal(compareRerun('x', { runtime: EV, rows: [] }).ok, false);
  assert.equal(compareRerun({ rows: [] }, { runtime: EV, rows: [] }).ok, false);
  assert.equal(compareRerun({ rows: [{ input: 'c' }] }, { runtime: EV, rows: [{ baseOut: 'a', mintedOut: 'b' }] }).ok, false);
  assert.equal(compareRerun(g.bundle, 'x').ok, false);
  assert.equal(compareRerun(g.bundle, { rows: [] }).ok, false);
  assert.equal(compareRerun(g.bundle, { runtime: EV, rows: 'x' }).ok, false);
  assert.match(compareRerun(g.bundle, { runtime: EV, rows: [{ baseOut: 'a', mintedOut: 'b' }] }).why, /every held-out input \(2\), not 1/);
  assert.match(compareRerun(g.bundle, { runtime: EV, rows: [{ baseOut: 'a', mintedOut: 'b' }, { baseOut: 'a' }] }).why, /fresh row 2/);
  assert.equal(compareRerun(g.bundle, { runtime: EV, rows: [null, { baseOut: 'a', mintedOut: 'b' }] }).ok, false);
});

test('rerunAttestation: bound to a real run, internally consistent, self-hashed', () => {
  const g = genuine(), v = verifyBundle(g.bundle), cmp = compareRerun(g.bundle, { runtime: EV, rows: g.rows.map((r) => ({ baseOut: r.baseOut, mintedOut: r.mintedOut })) });
  const RUN = 'https://github.com/sjgant80-hub/fallforgemint/actions/runs/123';
  const good = { bundleHash: g.bundle.hash, receiptHash: g.receipt.hash, outcome: cmp.outcome, checks: v.checks, recorded: cmp.recorded, fresh: cmp.fresh, runtime: EV, runUrl: RUN, createdAt: 't' };
  const a = rerunAttestation(good).attestation;
  assert.deepEqual([a.kind, a.outcome, a.pass, a.runUrl, a.runtime], ['fallforgemint-rerun-attestation', 'REPRODUCED', true, RUN, EV]);
  assert.equal(a.scope, RERUN_SCOPE);
  assert.equal(verifyRerunAttestation(a).valid, true);
  assert.equal(verifyRerunAttestation({ ...a, outcome: 'AGREES' }).valid, false);          // edited after issue → caught
  assert.equal(verifyRerunAttestation({ ...a, kind: 'x' }).ok, false);
  assert.equal(verifyRerunAttestation('x').ok, false);
  assert.equal(rerunAttestation({ ...good, outcome: 'AGREES' }).attestation.pass, true);
  assert.equal(rerunAttestation({ ...good, outcome: 'DID_NOT_REPRODUCE' }).attestation.pass, false);
  // TAMPERED ⇔ a failed check; a tampered bundle is never re-executed
  const failedChecks = [{ name: 'scores', ok: false }, { name: 'bundle-hash', ok: true }];
  const t = rerunAttestation({ ...good, outcome: 'TAMPERED', checks: failedChecks, fresh: null, runtime: null }).attestation;
  assert.deepEqual([t.outcome, t.pass, t.fresh, t.runtime], ['TAMPERED', false, null, null]);
  assert.equal(rerunAttestation({ ...good, outcome: 'TAMPERED' }).ok, false);                        // TAMPERED with all checks passing
  assert.equal(rerunAttestation({ ...good, checks: failedChecks }).ok, false);                        // a failed check but not TAMPERED
  assert.equal(rerunAttestation({ ...good, outcome: 'TAMPERED', checks: failedChecks, fresh: cmp.fresh }).ok, false);
  // the run URL must be real — never a placeholder
  assert.equal(rerunAttestation({ ...good, runUrl: 'https://x/run' }).ok, false);
  assert.equal(rerunAttestation({ ...good, runUrl: undefined }).ok, false);
  // every other field isolated
  assert.equal(rerunAttestation('x').ok, false);
  assert.equal(rerunAttestation({ ...good, bundleHash: 'a'.repeat(63) }).ok, false);
  assert.match(rerunAttestation({ ...good, receiptHash: 'Z'.repeat(64) }).why, /receiptHash/);
  assert.equal(rerunAttestation({ ...good, outcome: 'MAYBE' }).ok, false);
  assert.equal(rerunAttestation({ ...good, checks: [] }).ok, false);
  assert.equal(rerunAttestation({ ...good, checks: [{ name: 'x', ok: 'yes' }] }).ok, false);
  assert.equal(rerunAttestation({ ...good, recorded: null }).ok, false);
  assert.equal(rerunAttestation({ ...good, fresh: null }).ok, false);
  assert.equal(rerunAttestation({ ...good, runtime: 'nowhere' }).ok, false);
  assert.equal(rerunAttestation({ ...good, runtime: null }).ok, false);
  assert.equal(rerunAttestation({ ...good, createdAt: '' }).ok, false);
  assert.deepEqual(RERUN_OUTCOMES, ['TAMPERED', 'REPRODUCED', 'AGREES', 'DID_NOT_REPRODUCE']);
});

test('anti-drift guard: the rail’s own claim stays narrow-true', () => {
  const FORBIDDEN = /hermetic|sealed|memoris|memoriz|tamper-proof|unforgeable|uncheatable|cannot have been|impossible to (?:cheat|fake|game|leak)/i;
  assert.equal(FORBIDDEN.test(RERUN_SCOPE), false);
  assert.ok(RERUN_SCOPE.includes('does not attest the machine that made the original'));
  assert.ok(RERUN_SCOPE.includes('says nothing about what the base model saw in its own training'));
});

// ── kill: the rail's guards, each clause isolated (from the witness run on the rail) ──
const rehashR = (r) => { const body = { ...r }; delete body.hash; delete body.signature; return { ...body, hash: sha256(canon(body)).hash }; };
test('kill: verifyBundle held-out check — an honest leaky recipe verifies; an under-claim or a swapped hash does not', () => {
  const leakyTrain = [...R_TRAIN, { input: 'z', output: 'charlie' }];
  const spec = specFromTask(R_TASK, leakyTrain, 'llama3.2:1b');
  const rows = R_HOLD.map((h) => ({ input: h.input, correct: h.output, baseOut: 'no', mintedOut: h.output }));
  const d = holdoutDisjoint(rows, spec.modelfile);
  const honest = scorecardReceipt({ base: spec.base, modelFingerprint: spec.fingerprint, taskHash: sha256(R_TASK).hash, evidenceHash: sha256(canon(rows)).hash,
    sc: { n: 2, baseHits: 0, mintedHits: 2, verdict: 'BEATS' }, createdAt: 't', holdoutHash: d.holdoutHash, holdoutExcludedFromSpec: d.excludedFromSpec, evaluatedOn: EV }).receipt;
  assert.equal('heldOutClaim' in honest, false);
  const v = verifyBundle(rerunBundle({ receipt: honest, task: R_TASK, base: 'llama3.2:1b', train: leakyTrain, rows, evaluatedOn: EV }).bundle);
  assert.equal(v.valid, true);                                                       // leaky but honest about it → intact
  const g = genuine();
  // a disjoint recipe whose receipt says NOT disjoint (the claim dropped) → the record does not match the recipe
  const under = rehashR({ ...g.receipt, holdoutExcludedFromSpec: false }); delete under.heldOutClaim;
  const under2 = rehashR(under);
  assert.deepEqual(failing(verifyBundle(rehash({ ...g.bundle, receipt: under2 }))), ['held-out-disjoint']);
  // the held-out hash swapped on a re-hashed receipt → only the held-out check breaks
  assert.deepEqual(failing(verifyBundle(rehash({ ...g.bundle, receipt: rehashR({ ...g.receipt, holdoutHash: 'e'.repeat(64) }) }))), ['held-out-disjoint']);
});

test('kill: evaluatorModel + compareRerun guards — each clause alone, never a throw', () => {
  const g = genuine();
  assert.equal(evaluatorModel([EV]).ok, false);                                     // a list that stringifies to a runtime is not one
  assert.equal(evaluatorModel({ toString: () => EV }).ok, false);
  for (const b of [null, { rows: 'x' }, { rows: [] }, { rows: [{}] }, { rows: [g.rows[0], { input: 'c' }] }])
    assert.match(compareRerun(b, { runtime: EV, rows: [] }).why, /needs a bundle with its held-out rows/);
  for (const f of [null, { runtime: 5, rows: [] }, { rows: g.rows }, { runtime: EV, rows: 'xy' }, { runtime: EV }])
    assert.match(compareRerun(g.bundle, f).why, /fresh must be/);
});

test('kill: the attestation carries the fresh scores it was given; its verifier names what it found', () => {
  const g = genuine(), v = verifyBundle(g.bundle);
  const fresh = { n: 2, baseHits: 1, mintedHits: 2, verdict: 'BEATS' };
  const a = rerunAttestation({ bundleHash: g.bundle.hash, receiptHash: g.receipt.hash, outcome: 'AGREES', checks: v.checks, recorded: { n: 2, baseHits: 0, mintedHits: 2, verdict: 'BEATS' },
    fresh, runtime: 'ollama:qwen2.5:0.5b', runUrl: 'https://github.com/sjgant80-hub/fallforgemint/actions/runs/7', createdAt: 't' }).attestation;
  assert.deepEqual(a.fresh, fresh);
  assert.equal(a.runtime, 'ollama:qwen2.5:0.5b');
  assert.deepEqual(a.checks, v.checks.map((c) => ({ name: c.name, ok: c.ok })));
  assert.deepEqual(verifyRerunAttestation(a), { ok: true, valid: true, why: 'attestation intact' });
  assert.match(verifyRerunAttestation({ ...a, pass: false }).why, /changed after it was issued/);
});

test('anti-drift guard: the runner wording stays narrow-true too', () => {
  const FORBIDDEN = /hermetic|sealed|memoris|memoriz|tamper-proof|unforgeable|uncheatable|cannot have been|impossible to (?:cheat|fake|game|leak)/i;
  for (const s of [HELDOUT_CLAIM_RUNNER, SCOPE_RUNNER, SCOPE_BROWSER]) assert.equal(FORBIDDEN.test(s), false, s);
  assert.ok(HELDOUT_CLAIM_RUNNER.startsWith('The held-out answers were not in the spec given to the model (hash-disjoint)'));
  assert.ok(SCOPE_RUNNER.includes('NOT a certification'));
});

// ══════════════════════════ THE RERUN LINK ══════════════════════════
const LINK = 'https://github.com/sjgant80-hub/fallforgemint/actions/runs/36431565425';
const RAIL_SHA = 'a65b803' + '1'.repeat(33), CALLED_SHA = 'b'.repeat(40);
function linkedReceipt(over = {}) {
  const g = genuine();
  const body = { ...g.receipt, createdAt: '2026-09-28T13:55:01.051Z', rerun: LINK, ...over }; delete body.hash;
  return { ...body, hash: sha256(canon(body)).hash, signature: { alg: 'Ed25519', pub: 'ab'.repeat(32), sig: 'cd'.repeat(64) } };
}
const facts = (made, over = {}) => ({ url: LINK, found: true, htmlUrl: LINK, repo: RAIL_HOME, path: RAIL_WORKFLOW, headSha: RAIL_SHA, referenced: [], jobs: 1,
  status: 'completed', conclusion: 'success', startedAt: '2026-09-28T13:51:02Z', updatedAt: '2026-09-28T13:55:10Z', onMain: { [RAIL_SHA]: true },
  pinsOwnCode: false, checkedAt: '2026-09-28T14:30:00Z', artifact: { state: 'present', expiresAt: '2026-12-27T13:51:03Z', receipt: made }, ...over });
const caller = (made, over = {}) => facts(made, { repo: 'someone/their-rerun', headSha: 'c'.repeat(40), jobs: 1, pinsOwnCode: true,
  referenced: [{ path: RAIL_HOME + '/' + RAIL_WORKFLOW + '@refs/heads/main', sha: CALLED_SHA }], onMain: { [CALLED_SHA]: true }, ...over });
const level = (r, ev) => { const c = rerunLinkCheck(r, ev); return c.ok ? c.level : 'ERR'; };

test('rerunLinkCheck: BOUND only when the run it names made this exact receipt', () => {
  const r = linkedReceipt(), c = rerunLinkCheck(r, facts(r));
  assert.deepEqual([c.ok, c.level, c.pass, c.why], [true, 'BOUND', true, 'the run it names made this exact receipt']);
  assert.equal(c.confirmed.length, 4);
  assert.ok(c.confirmed[1].includes(RAIL_SHA.slice(0, 12)) && !c.confirmed[1].includes('called from'));
  assert.ok(c.confirmed[3].includes('this exact receipt, signature included'));
  assert.deepEqual([RAIL_HOME, RAIL_WORKFLOW, ARTIFACT_KEEP_DAYS], ['sjgant80-hub/fallforgemint', '.github/workflows/rerun.yml', 90]);
  assert.deepEqual(RERUN_LINK_LEVELS, ['BOUND', 'RUN_ONLY', 'NOT_BOUND']);
});

test('rerunLinkCheck: a forgery that borrows a genuine run\'s link fails on the link itself', () => {
  const real = linkedReceipt(), forged = linkedReceipt({ baseHits: 1, verdict: 'TIES' });
  const c = rerunLinkCheck(forged, facts(real));
  assert.deepEqual([c.level, c.pass, c.confirmed], ['NOT_BOUND', false, []]);
  assert.match(c.why, /minted a different receipt — this one borrows its link/);
  // the same receipt re-signed by someone else is not the receipt the run made either
  const resigned = { ...real, signature: { ...real.signature, pub: 'ef'.repeat(32) } };
  assert.equal(level(resigned, facts(real)), 'NOT_BOUND');
  // a run whose artifact holds no minted receipt (a verify run) made no receipt
  assert.match(rerunLinkCheck(real, facts(real, { artifact: { state: 'present', receipt: null } })).why, /holds no minted receipt/);
});

test('rerunLinkCheck: after the artifact expires it says only what is still true (RUN_ONLY)', () => {
  const r = linkedReceipt(), c = rerunLinkCheck(r, facts(r, { artifact: { state: 'expired', expiresAt: '2026-12-27T13:51:03Z' } }));
  assert.deepEqual([c.level, c.pass, c.confirmed.length], ['RUN_ONLY', true, 3]);
  assert.match(c.why, /expired \(2026-12-27T13:51:03Z\), so which receipt it made can no longer be checked/);
  assert.equal(c.confirmed.some((s) => /exact|this receipt/.test(s)), false);          // never claims more than it saw
  assert.ok(c.confirmed.includes('the receipt was stamped while the run was going'));
  assert.equal(rerunLinkCheck(r, facts(r, { artifact: { state: 'expired' } })).why.includes('('), false);
  // gone without a trace: only a run older than the keep window may have lost it honestly
  const gone = (checkedAt) => level(r, facts(r, { checkedAt, artifact: { state: 'absent' } }));
  const day = 86400000, end = Date.parse('2026-09-28T13:55:10Z');
  assert.equal(gone(new Date(end + 90 * day).toISOString()), 'NOT_BOUND');
  assert.equal(gone(new Date(end + 90 * day + 1).toISOString()), 'RUN_ONLY');
  assert.equal(gone('2026-09-28T14:30:00Z'), 'NOT_BOUND');
  assert.match(rerunLinkCheck(r, facts(r, { artifact: { state: 'absent' } })).why, /recent enough to still hold its minted bundle and holds none/);
  assert.equal(gone('garbage'), 'NOT_BOUND');
  // an expired artifact never rescues a run that fails an earlier check
  assert.equal(level(r, facts(r, { conclusion: 'failure', artifact: { state: 'expired' } })), 'NOT_BOUND');
});

test('rerunLinkCheck: the run must exist, be this run, and have succeeded', () => {
  const r = linkedReceipt();
  assert.match(rerunLinkCheck(r, { url: LINK, found: false }).why, /GitHub has no such run/);
  assert.equal(level(r, facts(r, { found: 'yes' })), 'NOT_BOUND');
  assert.match(rerunLinkCheck(r, facts(r, { htmlUrl: LINK + '0' })).why, /different run/);
  assert.match(rerunLinkCheck(r, facts(r, { status: 'in_progress' })).why, /did not complete successfully/);
  assert.equal(level(r, facts(r, { conclusion: 'failure' })), 'NOT_BOUND');
  // the receipt's field must be a run link at all
  const odd = linkedReceipt({ rerun: 'see the CI' });
  assert.match(rerunLinkCheck(odd, { url: 'see the CI', found: true }).why, /not a GitHub Actions run link/);
});

test('rerunLinkCheck: only the rail\'s own code counts — its repo, or a pinned single-job caller on its main line', () => {
  const r = linkedReceipt();
  assert.equal(rerunLinkCheck(r, facts(r, { repo: 'someone/fallforgemint' })).why, 'the run is not the rail\'s workflow (it ran .github/workflows/rerun.yml in someone/fallforgemint) — a fork or a copy runs whatever workflow it holds, so only the rail\'s own counts');
  assert.equal(level(r, facts(r, { path: '.github/workflows/other.yml' })), 'NOT_BOUND');
  assert.match(rerunLinkCheck(r, facts(r, { onMain: { [RAIL_SHA]: false } })).why, /not on the rail's main line/);
  assert.equal(level(r, facts(r, { onMain: undefined })), 'NOT_BOUND');
  assert.equal(level(r, facts(r, { onMain: { [RAIL_SHA]: 'true' } })), 'NOT_BOUND');
  assert.match(rerunLinkCheck(r, facts(r, { headSha: 'abc' })).why, /rail commit the run used is unknown/);
  assert.equal(level(r, facts(r, { headSha: undefined, onMain: { undefined: true } })), 'NOT_BOUND');
  // a caller: BOUND only as a single job calling a main-line rail that checks out its own code
  const c = rerunLinkCheck(r, caller(r));
  assert.deepEqual([c.level, c.pass], ['BOUND', true]);
  assert.ok(c.confirmed[1].includes('called from someone/their-rerun') && c.confirmed[1].includes(CALLED_SHA.slice(0, 12)));
  assert.match(rerunLinkCheck(r, caller(r, { jobs: 2 })).why, /jobs besides the rail/);
  assert.equal(level(r, caller(r, { jobs: '1' })), 'NOT_BOUND');
  assert.match(rerunLinkCheck(r, caller(r, { pinsOwnCode: false })).why, /let the caller choose which code ran/);
  assert.equal(level(r, caller(r, { pinsOwnCode: 'yes' })), 'NOT_BOUND');
  assert.equal(level(r, caller(r, { onMain: { ['c'.repeat(40)]: true } })), 'NOT_BOUND');     // the caller's own commit is not the rail
  assert.equal(level(r, caller(r, { referenced: [{ path: 'someone/x/.github/workflows/rerun.yml@main', sha: CALLED_SHA }] })), 'NOT_BOUND');
  assert.equal(level(r, caller(r, { referenced: [{ path: RAIL_HOME + '/.github/workflows/gate.yml@main', sha: CALLED_SHA }] })), 'NOT_BOUND');
  assert.equal(level(r, caller(r, { referenced: [null, 5, { path: 7 }, { path: RAIL_HOME + '/' + RAIL_WORKFLOW + '@v1', sha: CALLED_SHA }] })), 'BOUND');
  assert.equal(level(r, caller(r, { referenced: 'x' })), 'NOT_BOUND');
  assert.equal(level(r, caller(r, { referenced: [{ path: RAIL_HOME + '/' + RAIL_WORKFLOW + '@v1', sha: 'nope' }] })), 'NOT_BOUND');
  // in the rail's own repo, the run's head is the rail commit even if it lists a called workflow
  assert.equal(level(r, facts(r, { referenced: [{ path: RAIL_HOME + '/' + RAIL_WORKFLOW + '@x', sha: CALLED_SHA }] })), 'BOUND');
});

test('rerunLinkCheck: the receipt must be stamped while the run was going (GitHub times are to the second)', () => {
  const at = (createdAt, over = {}) => { const r = linkedReceipt({ createdAt }); return level(r, facts(r, over)); };
  assert.equal(at('2026-09-28T13:51:02.000Z'), 'BOUND');
  assert.equal(at('2026-09-28T13:51:01.999Z'), 'NOT_BOUND');
  assert.equal(at('2026-09-28T13:55:10.000Z'), 'BOUND');
  assert.equal(at('2026-09-28T13:55:10.001Z'), 'NOT_BOUND');
  assert.equal(at('2026-09-28T13:55:01.200Z', { startedAt: '2026-09-28T13:55:01.500Z' }), 'BOUND');   // the second is floored, not rounded up
  assert.equal(at('2026-09-28T13:55:00.999Z', { startedAt: '2026-09-28T13:55:01.500Z' }), 'NOT_BOUND');
  assert.equal(at('t'), 'NOT_BOUND');
  assert.equal(at(''), 'NOT_BOUND');
  assert.equal(at('2026-09-28T13:52:00Z', { startedAt: 'soon' }), 'NOT_BOUND');
  assert.equal(at('2026-09-28T13:52:00Z', { updatedAt: undefined }), 'NOT_BOUND');
  const r = linkedReceipt({ createdAt: '2026-09-28T12:00:00Z' });
  assert.match(rerunLinkCheck(r, facts(r)).why, /stamped outside the run \(2026-09-28T12:00:00Z is not within 2026-09-28T13:51:02Z – 2026-09-28T13:55:10Z\)/);
});

test('rerunLinkCheck: refuses to judge without the facts — an unreadable artifact is not a verdict, never a throw', () => {
  const r = linkedReceipt();
  assert.match(rerunLinkCheck(null, facts(r)).why, /needs the scorecard receipt/);
  assert.equal(rerunLinkCheck({ ...r, kind: 'x' }, facts(r)).ok, false);
  const plain = genuine().receipt;
  assert.match(rerunLinkCheck(plain, facts(r)).why, /names no rerun run/);
  assert.match(rerunLinkCheck(r, 'facts').why, /needs the facts/);
  assert.match(rerunLinkCheck(r, facts(r, { url: LINK + '1' })).why, /different link/);
  for (const artifact of [undefined, null, 'present', { state: 'unreadable' }, { state: 'PRESENT' }])
    assert.match(rerunLinkCheck(r, facts(r, { artifact })).why, /present, expired or absent/);
  assert.equal(rerunLinkCheck(r, { url: LINK, found: false, artifact: { state: 'unreadable' } }).level, 'NOT_BOUND');
  for (const junk of [undefined, 0, [], [1], 'x', { url: LINK }, { url: LINK, found: true }])
    assert.doesNotThrow(() => rerunLinkCheck(r, junk));
});

test('rerunAttestation: the link it records must agree with the rerun-link check; without one it is unchanged', () => {
  const g = genuine(), v = verifyBundle(g.bundle);
  const RUN = 'https://github.com/sjgant80-hub/fallforgemint/actions/runs/9';
  const base = { bundleHash: g.bundle.hash, receiptHash: g.receipt.hash, outcome: 'REPRODUCED', recorded: { n: 2, baseHits: 0, mintedHits: 2, verdict: 'BEATS' },
    fresh: { n: 2, baseHits: 0, mintedHits: 2, verdict: 'BEATS' }, runtime: EV, runUrl: RUN, createdAt: 't' };
  const okChecks = [...v.checks, { name: 'rerun-link', ok: true }];
  const a = rerunAttestation({ ...base, checks: okChecks, link: { level: 'BOUND', url: LINK } }).attestation;
  assert.deepEqual(a.link, { level: 'BOUND', url: LINK });
  assert.equal(verifyRerunAttestation(a).valid, true);
  assert.equal(verifyRerunAttestation({ ...a, link: { level: 'RUN_ONLY', url: LINK } }).valid, false);
  assert.equal(rerunAttestation({ ...base, checks: okChecks, link: { level: 'RUN_ONLY', url: LINK } }).attestation.link.level, 'RUN_ONLY');
  assert.match(rerunAttestation({ ...base, checks: okChecks, link: { level: 'NOT_BOUND', url: LINK } }).why, /must agree with the rerun-link check/);
  assert.equal(rerunAttestation({ ...base, checks: v.checks, link: { level: 'BOUND', url: LINK } }).ok, false);     // no rerun-link check at all
  const failedLink = [...v.checks, { name: 'rerun-link', ok: false }];
  const t = rerunAttestation({ ...base, outcome: 'TAMPERED', checks: failedLink, fresh: null, runtime: null, link: { level: 'NOT_BOUND', url: LINK } });
  assert.deepEqual([t.ok, t.attestation.link.level, t.attestation.pass], [true, 'NOT_BOUND', false]);
  assert.equal(rerunAttestation({ ...base, outcome: 'TAMPERED', checks: failedLink, fresh: null, runtime: null, link: { level: 'BOUND', url: LINK } }).ok, false);
  for (const link of [null, 'BOUND', { level: 'MAYBE', url: LINK }, { level: 'BOUND', url: 'https://x/run' }, { level: 'BOUND' }])
    assert.match(rerunAttestation({ ...base, checks: okChecks, link }).why, /link must be/);
  // additive: no link given → no link key, and the same hash as before this field existed
  const plainA = rerunAttestation({ ...base, checks: v.checks }).attestation;
  assert.equal('link' in plainA, false);
  const { hash, ...rest } = plainA;
  assert.equal(sha256(canon(rest)).hash, hash);
});

test('anti-drift guard: the link check never claims more than it saw', () => {
  const r = linkedReceipt();
  const ro = rerunLinkCheck(r, facts(r, { artifact: { state: 'expired' } }));
  const FORBIDDEN = /hermetic|sealed|tamper-proof|unforgeable|guarantee|certif/i;
  for (const s of [ro.why, ...ro.confirmed]) assert.equal(FORBIDDEN.test(s), false, s);
  assert.equal(/made this exact receipt/.test(ro.why), false);
});
