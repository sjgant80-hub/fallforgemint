// costcase.mjs — the cost case for ONE repetitive job, for the buyer's brochure on the page: what the job costs a team in
// staff time today, what the two rented-AI routes add, and what owning the minted model costs to run. It follows the
// estate's mint cost case (liveware src/mintcase.mjs): the same method on the same sourced basis.
// Every external figure is read from the vendored, sourced basis (vendor/sovereign-enterprise/data/basis.json, byte for
// byte from sovereign-enterprise data/basis.json); the hours, the share and the counts are the reader's own.
// Floors, never top ends: staff time at the UK median wage with on-costs left out; CPI applied to every later year.
// Like for like: the cloud-API route takes the SAME share of the work off as the owned model, so the two differ only in
// the per-call bill (and where the data goes); rented assistant seats help each person but take no work off, so the
// staff time stays. No price of ours appears here — these are the buyer's own costs.
// calcDefaults seeds the page's own-vs-rent calculator from the same basis, so even its starting figures are sourced.
// Pure, total, deterministic: garbage in gives { ok: false, why }, never a throw. Names are prefixed so this file can be
// inlined beside kernel.mjs in one page scope.

export const CASE_DEFAULTS = Object.freeze({ hoursPerWeek: 20, share: 0.5, seats: 5, casesPerWeek: 500, tokensIn: 1500, tokensOut: 300, years: 3 });
export const CASE_BASIS_KEYS = Object.freeze(['wageMedianHourly', 'cpi', 'electricityPencePerKwh', 'laptopExtraWatts', 'hoursPerYear', 'seat.copilot', 'frontier', 'fxGbpPerUsd']);

const ccNum = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const ccR2 = (x) => Math.round(x * 100) / 100;

/** the basis entries the case reads, each a sourced number; null when one is missing or unreadable */
function ccFigures(basis) {
  const b = basis || {}, f = (k) => b[k] || {};
  const out = {
    wage: f('wageMedianHourly').value, cpi: f('cpi').value, pence: f('electricityPencePerKwh').value, watts: f('laptopExtraWatts').value,
    hours: f('hoursPerYear').value, seat: f('seat.copilot').value, apiIn: f('frontier').inPerM, apiOut: f('frontier').outPerM, fx: f('fxGbpPerUsd').value,
  };
  return Object.values(out).every(ccNum) ? out : null;
}

/** where each figure came from, for the page to list beside the numbers */
export function caseSources(basis) {
  try { return CASE_BASIS_KEYS.map((k) => ({ key: k, what: basis[k].what || basis[k].product, source: basis[k].source })); } catch { return []; }
}

/** a yearly cost carried over `years`, rising by CPI each year after the first */
export function caseOver(perYear, cpi, years) {
  let total = 0, factor = 1;
  for (let y = 0; y < years; y++) { total += perYear * factor; factor *= 1 + cpi; }
  return ccR2(total);
}

/** the case. input (all optional, defaults above): hoursPerWeek, share (0 to 1), seats, casesPerWeek, tokensIn, tokensOut, years */
export function costCase(basis, input) {
  try {
    const f = ccFigures(basis);
    if (!f) return { ok: false, why: 'a sourced basis with every figure the case reads' };
    const i = { ...CASE_DEFAULTS, ...(input || {}) };
    if (!ccNum(i.hoursPerWeek) || i.hoursPerWeek > 168) return { ok: false, why: 'hours a week: 0 to 168' };
    if (!ccNum(i.share) || i.share > 1) return { ok: false, why: 'the share of the work taken off: 0 to 1' };
    if (!Number.isInteger(i.seats) || i.seats < 0) return { ok: false, why: 'seats: a whole number' };
    if (!ccNum(i.casesPerWeek) || !ccNum(i.tokensIn) || !ccNum(i.tokensOut)) return { ok: false, why: 'cases and tokens: numbers' };
    if (!Number.isInteger(i.years) || i.years < 1 || i.years > 10) return { ok: false, why: 'years: 1 to 10' };
    const staff = ccR2(i.hoursPerWeek * 52 * f.wage);                                              // the job, in staff time, a year
    const takenOff = ccR2(staff * i.share);                                                        // the share the owned (or cloud) model does
    const seats = ccR2(i.seats * 12 * f.seat);                                                     // rented assistants: help, take nothing off
    const api = ccR2(i.casesPerWeek * 52 * (i.tokensIn * f.apiIn + i.tokensOut * f.apiOut) / 1e6 * f.fx);   // a cloud model on every case
    const power = ccR2(f.watts * f.hours / 1000 * f.pence / 100);                                  // owned: an always-on extra draw, a year
    const perYear = { today: staff, rentSeats: ccR2(staff + seats), cloudApi: ccR2(staff - takenOff + api), own: ccR2(staff - takenOff + power) };
    const total = Object.fromEntries(Object.entries(perYear).map(([k, v]) => [k, caseOver(v, f.cpi, i.years)]));
    return {
      ok: true, inputs: i, lines: { staff, takenOff, seats, api, power }, perYear, over: total,
      savingPerYear: ccR2(perYear.today - perYear.own), savingOver: ccR2(total.today - total.own), versusCloudOver: ccR2(total.cloudApi - total.own),
    };
  } catch { return { ok: false, why: 'the inputs could not be read' }; }
}

/** calcDefaults(basis, input) — sourced starting figures for the own-vs-rent calculator: the rented price per million
 *  tokens is the basis's frontier API price, blended at the case's in/out split and converted to pounds; the run cost is
 *  the case's always-on electricity, a month; the tokens per call are the case's in + out. The reader replaces any of them. */
export function calcDefaults(basis, input) {
  try {
    const f = ccFigures(basis);
    if (!f) return { ok: false, why: 'a sourced basis with every figure the case reads' };
    const i = { ...CASE_DEFAULTS, ...(input || {}) };
    if (!ccNum(i.tokensIn) || !ccNum(i.tokensOut)) return { ok: false, why: 'cases and tokens: numbers' };
    const tokensPerCall = i.tokensIn + i.tokensOut;
    if (tokensPerCall === 0) return { ok: false, why: 'a call has at least one token' };
    const rentPerMillion = ccR2((i.tokensIn * f.apiIn + i.tokensOut * f.apiOut) / tokensPerCall * f.fx);
    const runPerMonth = ccR2(f.watts * f.hours / 1000 * f.pence / 100 / 12);
    return { ok: true, tokensPerCall, rentPerMillion, runPerMonth };
  } catch { return { ok: false, why: 'the inputs could not be read' }; }
}
