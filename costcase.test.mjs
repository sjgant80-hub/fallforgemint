// costcase — the buyer's cost case: every figure from the sourced basis, floors not top ends, like for like, never a throw
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CASE_DEFAULTS, CASE_BASIS_KEYS, caseSources, caseOver, costCase, calcDefaults } from './costcase.mjs';

const RAW = readFileSync(new URL('./vendor/sovereign-enterprise/data/basis.json', import.meta.url));
const BASIS = JSON.parse(RAW.toString('utf8'));
const base = (patch) => ({ ...BASIS, ...patch });

test('basis · vendored byte for byte from sovereign-enterprise data/basis.json (commit 003e447)', () => {
  assert.equal(createHash('sha256').update(RAW).digest('hex'), '83e9c2effa2f81596dcfa7110f030940032c1910cdf928d27d628ae59d73bb42');
});

test('costCase · the default case, every line from the sourced basis', () => {
  const r = costCase(BASIS, {});
  assert.equal(r.ok, true);
  assert.deepEqual(r.inputs, CASE_DEFAULTS);
  assert.deepEqual(r.lines, { staff: 20456.8, takenOff: 10228.4, seats: 1386, api: 117.62, power: 32.21 });
  assert.deepEqual(r.perYear, { today: 20456.8, rentSeats: 21842.8, cloudApi: 10346.02, own: 10260.61 });
  assert.deepEqual(r.over, { today: 63292.54, rentSeats: 67580.77, cloudApi: 32010.18, own: 31745.93 });
  assert.deepEqual([r.savingPerYear, r.savingOver, r.versusCloudOver], [10196.19, 31546.61, 264.25]);
  assert.deepEqual(costCase(BASIS), r);
});

test('costCase · like for like: rented seats take nothing off; cloud and owned take the same share off', () => {
  const r = costCase(BASIS, { share: 0.8, seats: 2, casesPerWeek: 1000, tokensIn: 2000, tokensOut: 500 });
  assert.equal(r.perYear.rentSeats, Math.round((r.lines.staff + r.lines.seats) * 100) / 100);
  assert.equal(r.perYear.cloudApi, Math.round((r.lines.staff - r.lines.takenOff + r.lines.api) * 100) / 100);
  assert.equal(r.perYear.own, Math.round((r.lines.staff - r.lines.takenOff + r.lines.power) * 100) / 100);
  assert.equal(r.lines.takenOff, Math.round(r.lines.staff * 0.8 * 100) / 100);
  assert.equal(r.lines.seats, Math.round(2 * 12 * BASIS['seat.copilot'].value * 100) / 100);
  assert.equal(r.lines.api, Math.round(1000 * 52 * (2000 * 2 + 500 * 10) / 1e6 * BASIS.fxGbpPerUsd.value * 100) / 100);
});

test('costCase · the figures move with the basis, not with anything typed', () => {
  const dear = costCase(base({ wageMedianHourly: { ...BASIS.wageMedianHourly, value: 30 } }), {});
  assert.equal(dear.lines.staff, 20 * 52 * 30);
  const cheapPower = costCase(base({ electricityPencePerKwh: { ...BASIS.electricityPencePerKwh, value: 10 } }), {});
  assert.equal(cheapPower.lines.power, Math.round(15 * 8760 / 1000 * 10 / 100 * 100) / 100);
  const fx = costCase(base({ fxGbpPerUsd: { ...BASIS.fxGbpPerUsd, value: 1 } }), {});
  assert.equal(fx.lines.api, Math.round(500 * 52 * (1500 * 2 + 300 * 10) / 1e6 * 100) / 100);
  const seat = costCase(base({ 'seat.copilot': { ...BASIS['seat.copilot'], value: 10 } }), {});
  assert.equal(seat.lines.seats, 5 * 12 * 10);
  const flat = costCase(base({ cpi: { ...BASIS.cpi, value: 0 } }), {});
  assert.equal(flat.over.today, Math.round(20456.8 * 3 * 100) / 100);
});

test('costCase · boundaries hold at both ends of every input', () => {
  for (const ok of [{ hoursPerWeek: 0 }, { hoursPerWeek: 168 }, { share: 0 }, { share: 1 }, { seats: 0 }, { years: 1 }, { years: 10 }, { casesPerWeek: 0, tokensIn: 0, tokensOut: 0 }]) assert.equal(costCase(BASIS, ok).ok, true, JSON.stringify(ok));
  assert.equal(costCase(BASIS, { share: 1 }).perYear.own, costCase(BASIS, { share: 1 }).lines.power);
  assert.equal(costCase(BASIS, { share: 0 }).savingPerYear, -32.21);
  assert.equal(costCase(BASIS, { years: 1 }).over.today, 20456.8);
  assert.equal(costCase(BASIS, { years: 10 }).inputs.years, 10);
});

test('costCase · each bad input refused with its reason', () => {
  const why = (i) => costCase(BASIS, i).why;
  assert.equal(why({ hoursPerWeek: 168.5 }), 'hours a week: 0 to 168');
  assert.equal(why({ hoursPerWeek: -1 }), 'hours a week: 0 to 168');
  assert.equal(why({ hoursPerWeek: '20' }), 'hours a week: 0 to 168');
  assert.equal(why({ share: 1.01 }), 'the share of the work taken off: 0 to 1');
  assert.equal(why({ share: -0.1 }), 'the share of the work taken off: 0 to 1');
  assert.equal(why({ seats: 2.5 }), 'seats: a whole number');
  assert.equal(why({ seats: -1 }), 'seats: a whole number');
  assert.equal(why({ casesPerWeek: -1 }), 'cases and tokens: numbers');
  assert.equal(why({ tokensIn: NaN }), 'cases and tokens: numbers');
  assert.equal(why({ tokensOut: 'x' }), 'cases and tokens: numbers');
  assert.equal(why({ years: 0 }), 'years: 1 to 10');
  assert.equal(why({ years: 11 }), 'years: 1 to 10');
  assert.equal(why({ years: 2.5 }), 'years: 1 to 10');
});

test('costCase · refuses a basis missing any figure it reads', () => {
  const refused = { ok: false, why: 'a sourced basis with every figure the case reads' };
  assert.deepEqual(costCase(null, {}), refused);
  for (const k of CASE_BASIS_KEYS) { const b = { ...BASIS }; delete b[k]; assert.deepEqual(costCase(b, {}), refused, k); }
  assert.deepEqual(costCase(base({ cpi: { value: -0.1 } }), {}), refused);
  assert.deepEqual(costCase(base({ frontier: { inPerM: 2 } }), {}), refused);
  assert.deepEqual(costCase(base({ hoursPerYear: { value: Infinity } }), {}), refused);
});

test('caseOver · CPI on every year after the first, compounding', () => {
  assert.equal(caseOver(100, 0.1, 1), 100);
  assert.equal(caseOver(100, 0.1, 2), 210);
  assert.equal(caseOver(100, 0.1, 3), 331);
  assert.equal(caseOver(100, 0, 4), 400);
  assert.equal(caseOver(100, 0.1, 0), 0);
  assert.equal(caseOver(1.006, 0, 1), 1.01);
});

test('caseSources · every figure the case reads, with what it is and where it came from', () => {
  const s = caseSources(BASIS);
  assert.deepEqual(s.map((x) => x.key), [...CASE_BASIS_KEYS]);
  assert.match(s.find((x) => x.key === 'wageMedianHourly').source, /^https:\/\/www\.ons\.gov\.uk\//);
  assert.equal(s.find((x) => x.key === 'wageMedianHourly').what, BASIS.wageMedianHourly.what);
  assert.equal(s.find((x) => x.key === 'seat.copilot').what, 'Microsoft 365 Copilot (enterprise)');
  assert.equal(s.find((x) => x.key === 'frontier').what, 'Claude Sonnet 5 (API)');
  assert.ok(s.filter((x) => x.key !== 'hoursPerYear').every((x) => /^https:\/\//.test(x.source)));
  assert.equal(s.find((x) => x.key === 'hoursPerYear').source, undefined);
  assert.deepEqual(caseSources(null), []);
});

test('calcDefaults · the calculator starts from the sourced basis, not from a typed figure', () => {
  assert.deepEqual(calcDefaults(BASIS, {}), { ok: true, tokensPerCall: 1800, rentPerMillion: 2.51, runPerMonth: 2.68 });
  assert.deepEqual(calcDefaults(BASIS), calcDefaults(BASIS, {}));
  // the blend follows the in/out split: all input → the input price; all output → the output price (both in pounds)
  assert.equal(calcDefaults(BASIS, { tokensIn: 1000, tokensOut: 0 }).rentPerMillion, Math.round(2 * BASIS.fxGbpPerUsd.value * 100) / 100);
  assert.equal(calcDefaults(BASIS, { tokensIn: 0, tokensOut: 1000 }).rentPerMillion, Math.round(10 * BASIS.fxGbpPerUsd.value * 100) / 100);
  assert.equal(calcDefaults(BASIS, { tokensIn: 0, tokensOut: 7 }).tokensPerCall, 7);
  assert.equal(calcDefaults(base({ fxGbpPerUsd: { value: 1 } }), {}).rentPerMillion, 3.33);
  assert.equal(calcDefaults(base({ electricityPencePerKwh: { value: 12 } }), {}).runPerMonth, Math.round(15 * 8760 / 1000 * 12 / 100 / 12 * 100) / 100);
  // the month is one twelfth of the case's yearly electricity line
  assert.equal(calcDefaults(BASIS, {}).runPerMonth, Math.round(costCase(BASIS, {}).lines.power / 12 * 100) / 100);
});

test('calcDefaults · refuses what it cannot source or read', () => {
  assert.deepEqual(calcDefaults(null, {}), { ok: false, why: 'a sourced basis with every figure the case reads' });
  assert.deepEqual(calcDefaults(base({ frontier: { outPerM: 10 } }), {}), { ok: false, why: 'a sourced basis with every figure the case reads' });
  assert.deepEqual(calcDefaults(BASIS, { tokensIn: 0, tokensOut: 0 }), { ok: false, why: 'a call has at least one token' });
  assert.deepEqual(calcDefaults(BASIS, { tokensIn: -1 }), { ok: false, why: 'cases and tokens: numbers' });
  assert.deepEqual(calcDefaults(BASIS, { tokensOut: 'x' }), { ok: false, why: 'cases and tokens: numbers' });
});

test('costCase / calcDefaults · totality: garbage never throws', () => {
  const G = [undefined, null, 0, 'x', [], {}, { hoursPerWeek: {} }, { years: Infinity }, true, () => 1];
  for (const a of G) for (const b of G) { assert.doesNotThrow(() => costCase(a, b)); assert.doesNotThrow(() => calcDefaults(a, b)); }
  for (const g of G) { assert.doesNotThrow(() => caseSources(g)); assert.doesNotThrow(() => caseOver(g, g, 3)); }
  assert.equal(costCase(BASIS, { hoursPerWeek: {} }).ok, false);
  const toxic = { get wageMedianHourly() { throw new Error('boom'); } };
  assert.deepEqual(costCase(toxic, {}), { ok: false, why: 'the inputs could not be read' });
  assert.deepEqual(calcDefaults(toxic, {}), { ok: false, why: 'the inputs could not be read' });
  assert.deepEqual(calcDefaults(BASIS, { get tokensIn() { throw new Error('boom'); } }), { ok: false, why: 'the inputs could not be read' });
});
