// FallForge Mint — the minting pipeline's pure core. Layer 2 of the sovereign-node factory:
// a limb model writes a SPEC (system prompt + few-shot exemplars), this kernel assembles it
// deterministically into a Modelfile, the minted node is gated by fallforge-gate against its
// own raw base, and the whole mint is sealed into a signable manifest. v1 mints PROMPT-TUNED
// nodes (Modelfile-level — owned, private, reproducible); weight-level LoRA is v2 and lands
// in these same stages. A node is MINTED only on a certified BEATS receipt — the pipeline
// cannot declare success, it can only measure it.
// No I/O here. Pure and total: garbage in → { ok:false, why }, never a throw.

export const MAX_SYSTEM = 4000;      // a spec is a distillation, not a dataset dump
export const MAX_FEWSHOT = 8;
export const MAX_MSG = 2000;
export const MAX_ROUNDS = 5;         // refinement is bounded — a mint that needs more is a bad spec
export const TEMP_MIN = 0, TEMP_MAX = 1;
export const PREDICT_MIN = 16, PREDICT_MAX = 1024;

const isStr = (v) => typeof v === 'string';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const HEX = /^[0-9a-f]+$/;

// ── SHA-256 + canonical JSON (the same proven pair the gate runs on) ────────────────────────────
const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256(text) {
  if (!isStr(text)) return { ok: false, why: 'sha256 takes a string' };
  const data = new TextEncoder().encode(text);
  const len = data.length;
  const padded = new Uint8Array((((len + 8) >> 6) << 6) + 64);
  padded.set(data);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  const bitLen = len * 8;
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 4294967296));
  dv.setUint32(padded.length - 4, bitLen >>> 0);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let i = 0; i < padded.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4);
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15], y = w[t - 2];
      const s0 = (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) >>> 0;
      const s1 = (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)) >>> 0;
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, hh = h7;
    for (let t = 0; t < 64; t++) {
      const S1 = (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (hh + S1 + ch + K256[t] + w[t]) >>> 0;
      const S0 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + hh) >>> 0;
  }
  const hex = (n) => n.toString(16).padStart(8, '0');
  return { ok: true, hash: hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4) + hex(h5) + hex(h6) + hex(h7) };
}

export function canon(v) {
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return '"?"';
}

// ── the spec: what the limb writes, bounded and clean ───────────────────────────────────────────
const FENCE = '"""';

export function validSpec(spec) {
  if (!isObj(spec)) return { ok: false, why: 'a spec is an object' };
  if (!isStr(spec.system) || spec.system.trim().length === 0) return { ok: false, why: 'a spec needs a non-empty system prompt' };
  if (spec.system.length > MAX_SYSTEM) return { ok: false, why: 'system prompt exceeds ' + MAX_SYSTEM + ' characters — a spec is a distillation, not a dump' };
  if (spec.system.includes(FENCE)) return { ok: false, why: 'system prompt may not contain a triple-quote fence' };
  if (!Array.isArray(spec.fewshot)) return { ok: false, why: 'fewshot must be an array (it may be empty)' };
  if (spec.fewshot.length > MAX_FEWSHOT) return { ok: false, why: 'more than ' + MAX_FEWSHOT + ' few-shot exemplars — trim the spec' };
  for (const [i, m] of spec.fewshot.entries()) {
    if (!isObj(m) || !isStr(m.user) || !isStr(m.assistant)) return { ok: false, why: 'fewshot ' + i + ' must be { user, assistant } strings' };
    if (m.user.trim().length === 0 || m.assistant.trim().length === 0) return { ok: false, why: 'fewshot ' + i + ' has an empty side' };
    if (m.user.length > MAX_MSG || m.assistant.length > MAX_MSG) return { ok: false, why: 'fewshot ' + i + ' exceeds ' + MAX_MSG + ' characters' };
    if (m.user.includes(FENCE) || m.assistant.includes(FENCE)) return { ok: false, why: 'fewshot ' + i + ' may not contain a triple-quote fence' };
  }
  if (!isObj(spec.params)) return { ok: false, why: 'a spec needs params' };
  if (!isNum(spec.params.temperature) || spec.params.temperature < TEMP_MIN || spec.params.temperature > TEMP_MAX) return { ok: false, why: 'temperature must be within ' + TEMP_MIN + '..' + TEMP_MAX };
  if (!isInt(spec.params.num_predict) || spec.params.num_predict < PREDICT_MIN || spec.params.num_predict > PREDICT_MAX) return { ok: false, why: 'num_predict must be an integer within ' + PREDICT_MIN + '..' + PREDICT_MAX };
  return { ok: true };
}

/** assembleModelfile(base, spec) — the deterministic mint: same spec, same bytes, every time. */
export function assembleModelfile(base, spec) {
  if (!isStr(base) || base.trim().length === 0) return { ok: false, why: 'a mint needs a base model name' };
  if (/\s/.test(base)) return { ok: false, why: 'a base model name may not contain whitespace' };
  const v = validSpec(spec);
  if (!v.ok) return v;
  const lines = [
    'FROM ' + base,
    'PARAMETER temperature ' + spec.params.temperature,
    'PARAMETER num_predict ' + spec.params.num_predict,
    'SYSTEM ' + FENCE + spec.system + FENCE,
  ];
  for (const m of spec.fewshot) {
    lines.push('MESSAGE user ' + FENCE + m.user + FENCE);
    lines.push('MESSAGE assistant ' + FENCE + m.assistant + FENCE);
  }
  return { ok: true, modelfile: lines.join('\n') + '\n' };
}

// ── the mint verdict: only a certified BEATS receipt mints a node ───────────────────────────────
export function mintVerdict(receipt) {
  if (!isObj(receipt)) return { ok: false, why: 'mintVerdict takes a receipt' };
  if (receipt.kind !== 'fallforge-gate-receipt') return { ok: false, why: 'not a fallforge-gate receipt' };
  if (!isStr(receipt.verdict)) return { ok: false, why: 'the receipt has no verdict' };
  if (receipt.verdict !== 'BEATS') return { ok: true, minted: false, why: 'the candidate did not beat its base — verdict ' + receipt.verdict };
  if (receipt.certified !== true) return { ok: true, minted: false, why: 'the win is not certified — not enough evidence' };
  return { ok: true, minted: true, why: 'certified BEATS — the mint measurably improved the base' };
}

// ── own vs rent: the honest economics of owning a node vs renting a frontier model per token ─────
// Pure and total: garbage in → { ok:false, why }, never a throw. It can, and does, return RENT_WINS
// — a calculator that could only ever say "own" would be marketing, not a measurement. All money is
// in whole pounds-per-million-tokens and pounds-per-month; the page formats, the kernel just counts.
export const MONTHS_PER_YEAR = 12;

export function ownVsRent(input) {
  if (!isObj(input)) return { ok: false, why: 'ownVsRent takes an object of numbers' };
  const { callsPerMonth, tokensPerCall, rentPerMillion, mintFee, runPerMonth } = input;
  const above0 = (v) => isNum(v) && v > 0;
  const atLeast0 = (v) => isNum(v) && v >= 0;
  if (!above0(callsPerMonth)) return { ok: false, why: 'calls per month must be a number above zero' };
  if (!above0(tokensPerCall)) return { ok: false, why: 'tokens per call must be a number above zero' };
  if (!above0(rentPerMillion)) return { ok: false, why: 'the rented price per million tokens must be a number above zero' };
  if (!atLeast0(mintFee)) return { ok: false, why: 'the one-off mint fee must be zero or more' };
  if (!atLeast0(runPerMonth)) return { ok: false, why: 'the monthly cost to run your own node must be zero or more' };

  const tokensPerMonth = callsPerMonth * tokensPerCall;
  const rentMonthly = (tokensPerMonth / 1000000) * rentPerMillion;
  const rentAnnual = rentMonthly * MONTHS_PER_YEAR;
  const ownedYear1 = mintFee + runPerMonth * MONTHS_PER_YEAR;
  const monthlySaving = rentMonthly - runPerMonth;
  const year1Saving = rentAnnual - ownedYear1;

  let verdict, breakEvenMonths;
  if (monthlySaving <= 0) {
    breakEvenMonths = null;
    verdict = 'RENT_WINS';                                   // owning your node costs as much to run as renting — say so
  } else {
    breakEvenMonths = mintFee / monthlySaving;
    verdict = breakEvenMonths <= MONTHS_PER_YEAR ? 'OWN_WINS' : 'OWN_LATER';
  }
  return { ok: true, tokensPerMonth, rentMonthly, rentAnnual, ownedYear1, monthlySaving, year1Saving, breakEvenMonths, verdict };
}

// ── the working mint: turn a plain task + a few worked examples into a real, ownable Modelfile ────
// This is the sovereign path the live page runs. It distils the visitor's examples into a spec
// (deterministically — same examples, same spec, same bytes) and assembles the Ollama Modelfile that
// `ollama create` turns into a private specialist they own. Honest scope: this is prompt-/few-shot-
// tuned at the Modelfile level — a real, owned, reproducible node, NOT weight fine-tuning (that is the
// done-for-you tier). Pure and total: bad input → { ok:false, why } a non-technical person can read.
export const MAX_EXAMPLES = MAX_FEWSHOT;

export function specFromTask(task, examples, base) {
  if (!isStr(task) || task.trim().length === 0) return { ok: false, why: 'tell the model what its job is — the task box is empty' };
  if (task.length > MAX_SYSTEM - 400) return { ok: false, why: 'the task description is too long — keep it under ' + (MAX_SYSTEM - 400) + ' characters, it is an instruction not a manual' };
  if (task.includes(FENCE)) return { ok: false, why: 'the task may not contain a triple-quote (""") — remove it' };
  if (!Array.isArray(examples)) return { ok: false, why: 'examples must be a list' };
  if (examples.length === 0) return { ok: false, why: 'add at least one worked example — one input and the correct answer' };
  if (examples.length > MAX_EXAMPLES) return { ok: false, why: 'that is more than ' + MAX_EXAMPLES + ' examples — a handful of clear ones works better than many' };
  const fewshot = [];
  for (const [i, ex] of examples.entries()) {
    const n = i + 1;
    if (!isObj(ex) || !isStr(ex.input) || !isStr(ex.output)) return { ok: false, why: 'example ' + n + ' needs both an input and the correct answer' };
    if (ex.input.trim().length === 0) return { ok: false, why: 'example ' + n + ' has an empty input' };
    if (ex.output.trim().length === 0) return { ok: false, why: 'example ' + n + ' has an empty answer' };
    if (ex.input.length > MAX_MSG || ex.output.length > MAX_MSG) return { ok: false, why: 'example ' + n + ' is too long — keep each side under ' + MAX_MSG + ' characters' };
    if (ex.input.includes(FENCE) || ex.output.includes(FENCE)) return { ok: false, why: 'example ' + n + ' may not contain a triple-quote (""")' };
    fewshot.push({ user: ex.input, assistant: ex.output });
  }
  const system = 'You do one job: ' + task.trim()
    + '\nFollow the worked examples exactly — match their style, format and level of detail.'
    + '\nIf you are unsure, give your single best answer in the same shape as the examples. Do not explain yourself unless an example does.';
  const spec = { system, fewshot, params: { temperature: 0, num_predict: 512 } };
  const v = validSpec(spec);
  if (!v.ok) return v;
  const b = isStr(base) && base.trim().length > 0 ? base.trim() : 'llama3.2:1b';
  const mf = assembleModelfile(b, spec);
  if (!mf.ok) return mf;
  const h = sha256(mf.modelfile);
  if (!h.ok) return { ok: false, why: h.why };
  return { ok: true, base: b, spec, modelfile: mf.modelfile, fingerprint: h.hash, exampleCount: fewshot.length };
}

// ── prove it on THEIR data: split a holdout, grade base vs minted, score honestly ─────────────────
// The conversion moment: don't ask them to trust our receipt, show the minted model beating the base
// on examples IT NEVER SAW. planProof holds out the last N examples (the model learns from the rest);
// the page runs both models on the holdout inputs; scorecard grades them. It can — and will — return
// LOSES or TIES, and flags a small sample honestly. Pure and total: bad input → { ok:false, why }.

/** planProof(examples, holdoutCount) — split into train (few-shot) and a held-out test set. */
export function planProof(examples, holdoutCount) {
  if (!Array.isArray(examples)) return { ok: false, why: 'examples must be a list' };
  if (!isInt(holdoutCount) || holdoutCount < 1) return { ok: false, why: 'hold out at least one example to test on' };
  if (examples.length < holdoutCount + 1) return { ok: false, why: 'you need at least one example to learn from plus ' + holdoutCount + ' to test on — add more examples' };
  const cut = examples.length - holdoutCount;
  return { ok: true, train: examples.slice(0, cut), holdout: examples.slice(cut) };
}

/** gradeAnswer(correct, got) — a lenient, honest match: whitespace/case-normalised exact, or the
 *  correct answer appearing inside a chattier reply. Not a semantic judge — deterministic and checkable. */
export function gradeAnswer(correct, got) {
  if (!isStr(correct) || !isStr(got)) return { ok: false, why: 'grading needs the correct answer and the model output as text' };
  const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const c = norm(correct), g = norm(got);
  if (c.length === 0) return { ok: false, why: 'the correct answer is empty — nothing to grade against' };
  const exact = g === c;
  const contains = !exact && g.includes(c);
  return { ok: true, hit: exact || contains, exact, contains };
}

/** scorecard(rows) — rows of { correct, baseOut, mintedOut } → the honest tally + verdict. */
export function scorecard(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, why: 'give at least one held-out example to score' };
  let baseHits = 0, mintedHits = 0;
  for (const [i, r] of rows.entries()) {
    if (!isObj(r)) return { ok: false, why: 'row ' + (i + 1) + ' must be an object' };
    const gb = gradeAnswer(r.correct, r.baseOut); if (!gb.ok) return gb;
    const gm = gradeAnswer(r.correct, r.mintedOut); if (!gm.ok) return gm;
    if (gb.hit) baseHits++;
    if (gm.hit) mintedHits++;
  }
  const n = rows.length;
  const delta = mintedHits - baseHits;
  const verdict = delta > 0 ? 'BEATS' : (delta < 0 ? 'LOSES' : 'TIES');
  return { ok: true, n, baseHits, mintedHits, baseRate: baseHits / n, mintedRate: mintedHits / n, delta, verdict, smallSample: n < 5 };
}

// ── frictionless own-it: a safe model name + a one-file installer they run to own the model ───────
// The manual path is two commands; this makes it one download. The installer embeds the Modelfile as
// base64 (bulletproof — no quoting/newline/unicode escaping to get wrong), decodes it, and runs
// `ollama create`/`ollama run`. Honest: Ollama is still required; the script says so and links it.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** b64encode(text) — UTF-8 → RFC 4648 base64. Pure and total. */
export function b64encode(text) {
  if (!isStr(text)) return { ok: false, why: 'b64encode takes a string' };
  const bytes = new TextEncoder().encode(text);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const has1 = i + 1 < bytes.length, has2 = i + 2 < bytes.length;
    const b0 = bytes[i], b1 = has1 ? bytes[i + 1] : 0, b2 = has2 ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += has1 ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += has2 ? B64[b2 & 63] : '=';
  }
  return { ok: true, b64: out };
}

/** safeModelName(raw) — normalise any string into a valid, tidy Ollama model name; total, always a string. */
export function safeModelName(raw) {
  const fallback = 'my-model';
  if (!isStr(raw)) return fallback;
  const s = raw.trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')     // only letters, digits, dot, dash, underscore
    .replace(/^[-._]+/, '')             // no leading punctuation
    .slice(0, 40)                       // keep it short
    .replace(/[-._]+$/, '');            // no trailing punctuation
  return s.length > 0 ? s : fallback;
}

export const INSTALLER_OS = ['mac', 'linux', 'windows'];

/** installerScript(os, name, modelfile) — one file the buyer runs to own the model. */
export function installerScript(os, name, modelfile) {
  if (!isStr(os) || !INSTALLER_OS.includes(os)) return { ok: false, why: 'os must be one of: ' + INSTALLER_OS.join(', ') };
  if (!isStr(modelfile) || modelfile.trim().length === 0) return { ok: false, why: 'installerScript needs the Modelfile text' };
  const n = safeModelName(name);
  const enc = b64encode(modelfile.replace(/\r\n/g, '\n'));
  if (!enc.ok) return enc;
  const wrapped = enc.b64.match(/.{1,120}/g);   // modelfile is non-empty here, so this is always ≥1 chunk

  if (os === 'windows') {
    const echoes = wrapped.map((c) => 'echo ' + c + '>>"%B64%"').join('\r\n');
    const script = [
      '@echo off',
      'REM FallForge Mint - one-file installer for "' + n + '". Double-click to own your model.',
      'REM Needs Ollama (free): https://ollama.com/download',
      'setlocal',
      'set "B64=%TEMP%\\' + n + '.b64"',
      'set "MF=%TEMP%\\' + n + '.Modelfile"',
      'if exist "%B64%" del "%B64%"',
      echoes,
      'certutil -f -decode "%B64%" "%MF%" >nul',
      'del "%B64%"',
      'echo Minting your model "' + n + '"...',
      'ollama create ' + n + ' -f "%MF%"',
      'echo.',
      'echo Your model "' + n + '" is ready. Starting it - type your task and press Enter:',
      'ollama run ' + n,
      'pause',
    ].join('\r\n') + '\r\n';
    return { ok: true, os, name: n, filename: 'install-' + n + '.bat', mime: 'application/octet-stream', script };
  }

  // mac + linux: a POSIX script; openssl decodes the base64 (present on both).
  const DELIM = 'FF_B64_EOF';
  const run = os === 'mac' ? 'Double-click this file to run it in Terminal.' : 'Run it with:  sh install-' + n + '.sh';
  const script = [
    '#!/bin/sh',
    '# FallForge Mint - one-file installer for "' + n + '". ' + run,
    '# Needs Ollama (free): https://ollama.com/download',
    'set -e',
    'DIR="$(cd "$(dirname "$0")" && pwd)"',
    'openssl base64 -d > "$DIR/' + n + '.Modelfile" <<\'' + DELIM + '\'',
    wrapped.join('\n'),
    DELIM,
    'echo "Minting your model \\"' + n + '\\"..."',
    'ollama create ' + n + ' -f "$DIR/' + n + '.Modelfile"',
    'echo ""',
    'echo "Your model \\"' + n + '\\" is ready. Starting it - type your task and press Enter:"',
    'ollama run ' + n,
  ].join('\n') + '\n';
  return { ok: true, os, name: n, filename: 'install-' + n + (os === 'mac' ? '.command' : '.sh'), mime: 'application/octet-stream', script };
}

// ── the refinement loop: try a few honest variants of the spec, keep the one that measures best ────
// The page runs each variant on HELD-OUT examples and grades it; these pure helpers build the variants
// and pick the winner. Deterministic on purpose — a reliable format rule beats a 0.5B model trying to
// rewrite its own prompt. It can, and will, report that nothing improved. Nothing here calls a model.

/** inferFormat(examples) — read the answer shape from the examples and give a crisp instruction. */
export function inferFormat(examples) {
  if (!Array.isArray(examples) || examples.length === 0) return { ok: false, why: 'need examples to read the answer format' };
  const outs = [];
  for (const e of examples) {
    if (!isObj(e) || !isStr(e.output) || e.output.trim().length === 0) return { ok: false, why: 'each example needs a non-empty answer' };
    outs.push(e.output.trim());
  }
  const looksJson = (o) => (o.startsWith('{') && o.endsWith('}')) || (o.startsWith('[') && o.endsWith(']'));
  const looksNumeric = (o) => /^-?\d+(\.\d+)?$/.test(o);
  const looksLabel = (o) => o.length <= 40 && o.split(/\s+/).length <= 4;
  if (outs.every(looksJson)) return { ok: true, format: 'json', instruction: 'Reply with only the JSON and nothing else — no explanation, no code fences, no extra words.' };
  if (outs.every(looksNumeric)) return { ok: true, format: 'number', instruction: 'Reply with only the number and nothing else.' };
  if (outs.every(looksLabel)) return { ok: true, format: 'label', instruction: 'Reply with only the short answer, in the same form as the examples — no sentences, no explanation.' };
  return { ok: true, format: 'freeform', instruction: 'Match the style, length and format of the example answers exactly, and add nothing extra.' };
}

/** hardenSpec(spec, examples) — add a strict-format instruction if the system prompt doesn't already carry it. */
export function hardenSpec(spec, examples) {
  const v = validSpec(spec);
  if (!v.ok) return v;
  const f = inferFormat(examples);
  if (!f.ok) return f;
  if (spec.system.includes(f.instruction)) return { ok: true, spec, changed: false, format: f.format };
  const system = spec.system + '\n' + f.instruction;
  if (system.length > MAX_SYSTEM) return { ok: true, spec, changed: false, format: f.format };  // no room — leave it
  return { ok: true, spec: { ...spec, system }, changed: true, format: f.format };
}

/** pickBest(rounds) — the highest score wins; on a tie the EARLIER (simpler/faster) candidate wins. */
export function pickBest(rounds) {
  if (!Array.isArray(rounds) || rounds.length === 0) return { ok: false, why: 'no rounds to choose from' };
  for (const [i, r] of rounds.entries()) {
    if (!isObj(r) || !isNum(r.score)) return { ok: false, why: 'round ' + (i + 1) + ' has no numeric score' };
  }
  let best = 0;
  for (let i = 1; i < rounds.length; i++) {
    if (rounds[i].score > rounds[best].score) best = i;   // strict > : ties keep the earlier candidate
  }
  return { ok: true, index: best, score: rounds[best].score };
}

// ── the downloadable scorecard receipt: a tamper-evident record of the buyer's OWN measurement ────
// Binds the exact model (fingerprint), the task (hash), the held-out test (evidence hash) and the
// scores into one canonical, self-hashed bundle — like the mint manifest, so the same "re-hash to
// check" proof works. HONEST SCOPE: self-issued, measured in the holder's own browser on their own
// examples. It is tamper-evident, NOT a certification by the estate — the done-for-you tier issues an
// issuer-signed receipt. An optional Ed25519 signature is attached at the edge (WebCrypto).

const VERDICTS = ['BEATS', 'LOSES', 'TIES'];

export function scorecardReceipt(input) {
  if (!isObj(input)) return { ok: false, why: 'scorecardReceipt takes an object' };
  const { base, modelFingerprint, taskHash, evidenceHash, sc, createdAt } = input;
  if (!isStr(base) || base.trim().length === 0) return { ok: false, why: 'the receipt needs the base model name' };
  for (const f of ['modelFingerprint', 'taskHash', 'evidenceHash']) {
    const val = input[f];
    if (!isStr(val) || val.length !== 64 || !HEX.test(val)) return { ok: false, why: f + ' must be a 64-character hex hash' };
  }
  if (!isStr(createdAt) || createdAt.length === 0) return { ok: false, why: 'the receipt needs a createdAt timestamp' };
  if (!isObj(sc)) return { ok: false, why: 'the scorecard result is missing' };
  if (!isInt(sc.n)) return { ok: false, why: 'the held-out count must be a whole number' };
  if (sc.n < 1) return { ok: false, why: 'the scorecard needs at least one held-out result' };
  if (!isInt(sc.baseHits)) return { ok: false, why: 'the base hit count must be a whole number' };
  if (!isInt(sc.mintedHits)) return { ok: false, why: 'the minted hit count must be a whole number' };
  if (sc.baseHits < 0) return { ok: false, why: 'the base hit count cannot be negative' };
  if (sc.mintedHits < 0) return { ok: false, why: 'the minted hit count cannot be negative' };
  if (sc.baseHits > sc.n) return { ok: false, why: 'the base hit count cannot exceed the held-out count' };
  if (sc.mintedHits > sc.n) return { ok: false, why: 'the minted hit count cannot exceed the held-out count' };
  if (!isStr(sc.verdict) || !VERDICTS.includes(sc.verdict)) return { ok: false, why: 'the verdict must be BEATS, LOSES or TIES' };
  const body = {
    v: 1,
    kind: 'fallforgemint-scorecard',
    base: base.trim(),
    modelFingerprint, taskHash, evidenceHash,
    heldOut: sc.n, baseHits: sc.baseHits, mintedHits: sc.mintedHits,
    score: sc.mintedHits / sc.n,
    verdict: sc.verdict,
    smallSample: sc.n < 5,
    createdAt,
    scope: "Self-issued: measured in the holder's own browser on their own held-out examples. Tamper-evident (re-hash to check) but NOT a certification by AI-Native Solutions. The done-for-you tier issues an issuer-signed certified receipt.",
  };
  const h = sha256(canon(body));
  if (!h.ok) return { ok: false, why: h.why };
  return { ok: true, receipt: { ...body, hash: h.hash } };
}

/** verifyScorecardReceipt(r) — the facts match their own hash AND the score matches the hit counts. */
export function verifyScorecardReceipt(r) {
  if (!isObj(r) || r.kind !== 'fallforgemint-scorecard' || !isStr(r.hash)) return { ok: false, why: 'not a fallforgemint scorecard' };
  const body = { ...r };
  delete body.hash;
  delete body.signature;
  const h = sha256(canon(body));
  if (!h.ok) return { ok: false, why: h.why };
  if (h.hash !== r.hash) return { ok: true, valid: false, why: 'the scorecard does not match its own fingerprint — it was changed after it was issued' };
  // a genuine receipt's score is the exact same float division, so an exact check is right (no epsilon):
  // a NaN/Infinity from a missing or zero held-out count also fails this and is caught here.
  if (r.score !== r.mintedHits / r.heldOut) return { ok: true, valid: false, why: 'the score does not match the hit counts' };
  return { ok: true, valid: true, why: 'scorecard intact' };
}

/** scorecardSignable(receipt) — the EXACT canonical bytes an Ed25519 signature covers: the receipt with
 *  its signature removed. Used to sign AND to verify, so both sides canonicalise identically. */
export function scorecardSignable(receipt) {
  if (!isObj(receipt) || receipt.kind !== 'fallforgemint-scorecard' || !isStr(receipt.hash)) return { ok: false, why: 'not a fallforgemint scorecard' };
  const body = { ...receipt };
  delete body.signature;
  return { ok: true, payload: canon(body) };
}

// ── the manifest: the mint's whole story, canonically hashed, ready for a wallet signature ──────
export function makeManifest(m) {
  if (!isObj(m)) return { ok: false, why: 'makeManifest takes an object' };
  for (const f of ['node', 'base', 'limb', 'evalName', 'trainHash', 'modelfile', 'createdAt']) {
    if (!isStr(m[f]) || m[f].length === 0) return { ok: false, why: 'manifest needs a non-empty ' + f };
  }
  if (!isInt(m.rounds) || m.rounds < 1 || m.rounds > MAX_ROUNDS) return { ok: false, why: 'rounds must be an integer within 1..' + MAX_ROUNDS };
  if (m.trainHash.length !== 64 || !HEX.test(m.trainHash)) return { ok: false, why: 'trainHash must be 64 lowercase hex chars' };
  if (!Array.isArray(m.receipts) || m.receipts.length === 0) return { ok: false, why: 'a manifest carries at least one receipt reference' };
  for (const [i, r] of m.receipts.entries()) {
    if (!isObj(r) || !isStr(r.vs) || r.vs.length === 0) return { ok: false, why: 'receipt ' + i + ' needs a vs model name' };
    if (!isStr(r.hash) || r.hash.length !== 64 || !HEX.test(r.hash)) return { ok: false, why: 'receipt ' + i + ' needs a 64-hex hash' };
    if (!isStr(r.verdict) || r.verdict.length === 0) return { ok: false, why: 'receipt ' + i + ' needs a verdict' };
    if (typeof r.certified !== 'boolean') return { ok: false, why: 'receipt ' + i + ' needs a boolean certified flag' };
  }
  const mf = sha256(m.modelfile);
  if (!mf.ok) return { ok: false, why: mf.why };
  const body = {
    v: 1,
    kind: 'fallforge-mint-manifest',
    node: m.node, base: m.base, limb: m.limb,
    tuning: 'prompt-tuned (Modelfile) — weight-level LoRA is v2',
    rounds: m.rounds,
    evalName: m.evalName,
    trainHash: m.trainHash,
    modelfileHash: mf.hash,
    receipts: m.receipts.map((r) => ({ vs: r.vs, hash: r.hash, verdict: r.verdict, certified: r.certified })),
    createdAt: m.createdAt,
    scope: 'receipts are scoped to their probe sets — a mint is a measurement, never a general claim',
  };
  const h = sha256(canon(body));
  if (!h.ok) return { ok: false, why: h.why };
  return { ok: true, manifest: { ...body, hash: h.hash } };
}

/** signable(manifest) — the EXACT bytes a wallet signs: the canonical body, hash included. */
export function signable(manifest) {
  if (!isObj(manifest) || manifest.kind !== 'fallforge-mint-manifest' || !isStr(manifest.hash)) return { ok: false, why: 'signable takes a fallforge-mint manifest' };
  const unsigned = { ...manifest };
  delete unsigned.signature;
  return { ok: true, payload: canon(unsigned) };
}

export function attachSignature(manifest, pubHex, sigHex) {
  const s = signable(manifest);
  if (!s.ok) return s;
  if (!isStr(pubHex) || pubHex.length < 32 || pubHex.length % 2 !== 0 || !HEX.test(pubHex)) return { ok: false, why: 'public key must be even-length hex, at least 32 chars' };
  if (!isStr(sigHex) || sigHex.length !== 128 || !HEX.test(sigHex)) return { ok: false, why: 'an Ed25519 signature is 128 hex chars' };
  return { ok: true, manifest: { ...manifest, signature: { alg: 'Ed25519', pub: pubHex, sig: sigHex } } };
}

/** verifyManifest(m) — internal consistency: the facts match their own hash. Signature bytes are
 *  checked at the edge (WebCrypto / node:crypto) over signable(); the kernel pins WHAT is signed. */
export function verifyManifest(m) {
  if (!isObj(m) || m.kind !== 'fallforge-mint-manifest' || !isStr(m.hash)) return { ok: false, why: 'not a fallforge-mint manifest' };
  const body = { ...m };
  delete body.hash;
  delete body.signature;
  const h = sha256(canon({ ...body, }));
  if (!h.ok) return { ok: false, why: h.why };
  if (h.hash !== m.hash) return { ok: true, valid: false, why: 'hash mismatch — the manifest does not match its own facts' };
  return { ok: true, valid: true, why: 'manifest intact' };
}
