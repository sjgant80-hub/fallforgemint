#!/usr/bin/env node
// tools/rerun.mjs — the CI re-run rail's runner. Every judgement lives in kernel.mjs (witness-gated): this file
// is only the edge — it reads a bundle, talks to Ollama, signs, and writes the verdict where people can see it.
//
//   node tools/rerun.mjs verify <bundle.json | https URL>  [--out rerun-result.json] [--summary FILE] [--no-exec]
//   node tools/rerun.mjs mint   <spec.json>                [--out bundle.json]       [--summary FILE]
//
// verify: re-verify every recorded number (TAMPERED if any fails), then re-execute the held-out set through base
//         and minted on this machine and compare (REPRODUCED / AGREES / DID_NOT_REPRODUCE).
// mint:   make a CI-origin scorecard from a spec { task, examples, holdout, base }: mint on the runner, run the
//         held-out set, sign with a fresh software key, and write the re-run bundle.
// Exit: 0 the rail passes · 1 the rail FAILS (TAMPERED / DID_NOT_REPRODUCE) · 2 usage or infrastructure error.
// Env:  OLLAMA_HOST (default http://127.0.0.1:11434) · RUN_URL (set by the workflow to this run's real Actions URL;
//       absent locally, and then no receipt or attestation ever carries a run link — never a placeholder).
import { readFileSync, writeFileSync, appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign, verify, createPublicKey } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const K = await import(pathToFileURL(join(here, '..', 'kernel.mjs')).href);
const HOST = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');
const OPTIONS = { temperature: 0, seed: 42, num_predict: 512 };        // greedy, seeded, the Modelfile's own limits
// the CPU that ran it: greedy decoding repeats on one machine with the same settings, but a borderline answer can flip between CPU types (and, locally, under a different thread count or batch size)
const MACHINE = (() => { const c = cpus(); return c.length ? c[0].model.trim().replace(/\s+/g, ' ') + ' · ' + c.length + ' threads' : 'unknown CPU'; })();
const argv = process.argv.slice(2), mode = argv[0], src = argv[1];
const flag = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = flag('--out'), SUMMARY = flag('--summary'), NOEXEC = argv.includes('--no-exec');
const RUN_URL = process.env.RUN_URL && K.RERUN_URL.test(process.env.RUN_URL) ? process.env.RUN_URL : null;
const log = (s) => process.stderr.write(s + '\n');
const die = (why, code = 2) => { log('rerun: ' + why); process.exit(code); };
if (!['verify', 'mint'].includes(mode) || !src) die('usage: rerun.mjs verify <bundle.json|https URL> [--out F] [--summary F] [--no-exec]\n       rerun.mjs mint <spec.json> [--out F] [--summary F]');
if (process.env.RUN_URL && !RUN_URL) die('RUN_URL is set but is not a real GitHub Actions run URL: ' + process.env.RUN_URL);

// ── Ollama, over its local HTTP API ────────────────────────────────────────────────────────────────
async function api(path, body) {
  const r = await fetch(HOST + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  if (!r.ok) throw new Error(path + ' → HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}
async function ensureModel(tag) {
  const find = async () => (await api('/api/tags')).models.find((m) => m.name === tag || m.model === tag);
  let m = await find();
  if (!m) { log('pulling ' + tag + ' …'); execFileSync('ollama', ['pull', tag], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, OLLAMA_HOST: HOST } }); m = await find(); }
  if (!m) throw new Error('could not pull ' + tag);
  return String(m.digest).replace(/^sha256:/, '');
}
function createModel(name, modelfile) {            // the ollama CLI parses the Modelfile itself — version-robust
  const dir = mkdtempSync(join(tmpdir(), 'rerun-')), f = join(dir, 'Modelfile');
  writeFileSync(f, modelfile);
  try { execFileSync('ollama', ['create', name, '-f', f], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, OLLAMA_HOST: HOST } }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}
const chat = async (model, content) => (await api('/api/chat', { model, messages: [{ role: 'user', content }], stream: false, options: OPTIONS })).message.content;

// ── signatures (the page's format: raw 32-byte Ed25519 public key, hex) ─────────────────────────────
const SPKI = Buffer.from('302a300506032b6570032100', 'hex');
function signReceipt(receipt) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const sig = sign(null, Buffer.from(K.scorecardSignable(receipt).payload, 'utf8'), privateKey);
  return { ...receipt, signature: { alg: 'Ed25519', pub: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex'), sig: sig.toString('hex') } };
}
function signatureState(receipt) {
  const s = receipt.signature;
  if (s === undefined) return 'unsigned';
  if (!s || s.alg !== 'Ed25519' || !/^[0-9a-f]{64}$/.test(s.pub || '') || !/^[0-9a-f]{128}$/.test(s.sig || '')) return 'invalid';
  try {
    const key = createPublicKey({ key: Buffer.concat([SPKI, Buffer.from(s.pub, 'hex')]), format: 'der', type: 'spki' });
    return verify(null, Buffer.from(K.scorecardSignable(receipt).payload, 'utf8'), key, Buffer.from(s.sig, 'hex')) ? 'valid' : 'invalid';
  } catch { return 'invalid'; }
}

async function loadJson(where) {
  try {
    if (/^https:\/\//.test(where)) { const r = await fetch(where); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
    return JSON.parse(readFileSync(where, 'utf8'));
  } catch (e) { die('could not read ' + where + ': ' + e.message); }
}
function railCommit() { try { return execFileSync('git', ['-C', join(here, '..'), 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } }
const summary = (md) => { if (SUMMARY) appendFileSync(SUMMARY, md + '\n'); process.stdout.write(md + '\n'); };
const annotate = (level, title, msg) => { if (process.env.GITHUB_ACTIONS) process.stdout.write(`::${level} title=${title}::${msg.replace(/\n/g, '%0A')}\n`); };
const row = (s) => `${s.mintedHits}/${s.n} vs base ${s.baseHits}/${s.n} — **${s.verdict}**`;

// ── mint: a CI-origin scorecard, measured on this runner ──────────────────────────────────────────
async function mint() {
  const s = await loadJson(src);
  const plan = K.planProof(s.examples, s.holdout);
  if (!plan.ok) die(plan.why);
  const minted = K.specFromTask(s.task, plan.train, s.base);
  if (!minted.ok) die(minted.why);
  const digest = await ensureModel(minted.base);
  const evaluatedOn = 'ollama:' + minted.base + '@' + digest.slice(0, 12);
  const name = 'rerun-mint-' + minted.fingerprint.slice(0, 12);
  createModel(name, minted.modelfile);
  const rows = [];
  for (const h of plan.holdout) rows.push({ input: h.input, correct: h.output, baseOut: await chat(minted.base, h.input), mintedOut: await chat(name, h.input) });
  const sc = K.scorecard(rows.map((r) => ({ correct: r.correct, baseOut: r.baseOut, mintedOut: r.mintedOut })));
  const d = K.holdoutDisjoint(rows, minted.modelfile);
  const built = K.scorecardReceipt({
    base: minted.base, modelFingerprint: minted.fingerprint, taskHash: K.sha256(s.task).hash, evidenceHash: K.sha256(K.canon(rows)).hash,
    sc: { n: sc.n, baseHits: sc.baseHits, mintedHits: sc.mintedHits, verdict: sc.verdict }, createdAt: new Date().toISOString(),
    keyClass: 'software-ed25519', holdoutHash: d.holdoutHash, holdoutExcludedFromSpec: d.excludedFromSpec, evaluatedOn,
    ...(RUN_URL ? { rerun: RUN_URL } : {}),
  });
  if (!built.ok) die(built.why);
  const receipt = signReceipt(built.receipt);
  const b = K.rerunBundle({ receipt, task: s.task, base: minted.base, train: plan.train, rows, evaluatedOn });
  if (!b.ok) die(b.why);
  if (OUT) writeFileSync(OUT, JSON.stringify(b.bundle, null, 2) + '\n');
  summary(`## FallForge Mint — a scorecard minted on this runner\n\n${row(sc)} on ${sc.n} held-out examples · measured on \`${evaluatedOn}\`\n\n`
    + `- Held-out answers ${d.excludedFromSpec ? '**hash-disjoint** from the recipe (the narrow-true claim ships)' : 'appear in the recipe, so the held-out claim is **not** made'}\n`
    + `- Signed with a fresh software Ed25519 key (it proves the numbers are unedited, not who ran it)\n`
    + `- Machine: ${MACHINE}\n`
    + (RUN_URL ? `- This run is the receipt's \`rerun\` link: ${RUN_URL}\n` : '- Run locally: no run link is recorded (never a placeholder)\n')
    + `- Receipt \`${receipt.hash}\` · bundle \`${b.bundle.hash}\`${OUT ? ' → `' + OUT + '`' : ''}\n`);
}

// ── verify: the rail ──────────────────────────────────────────────────────────────────────────────
async function verifyMode() {
  const bundle = await loadJson(src);
  const v = K.verifyBundle(bundle);
  if (!v.ok) die('not a re-run bundle: ' + v.why);
  const sig = signatureState(bundle.receipt);
  const checks = [...v.checks, { name: 'signature', ok: sig !== 'invalid', detail: sig === 'unsigned' ? 'unsigned — tamper-evidence rests on the hashes' : 'Ed25519 signature ' + sig }];
  const tampered = checks.some((c) => !c.ok);
  const rec = K.scorecard(bundle.rows.map((x) => ({ correct: x.correct, baseOut: x.baseOut, mintedOut: x.mintedOut })));
  const recorded = { n: rec.n, baseHits: rec.baseHits, mintedHits: rec.mintedHits, verdict: rec.verdict };
  let outcome = tampered ? 'TAMPERED' : null, cmp = null, runtime = null, freshRows = null;
  if (!tampered && !NOEXEC) {
    const em = K.evaluatorModel(bundle.evaluatedOn);
    if (!em.ok) die('cannot re-execute: ' + em.why);
    const digest = await ensureModel(em.model);
    runtime = 'ollama:' + em.model + '@' + digest.slice(0, 12);
    // re-run the measurement the receipt records: the same recipe, on the model that produced the scores
    const rspec = K.specFromTask(bundle.spec.task, bundle.spec.train, bundle.spec.base);
    const mf = K.assembleModelfile(em.model, rspec.spec);
    if (!mf.ok) die(mf.why);
    const name = 'rerun-check-' + K.sha256(mf.modelfile).hash.slice(0, 12);
    createModel(name, mf.modelfile);
    freshRows = [];
    for (const r of bundle.rows) freshRows.push({ baseOut: await chat(em.model, r.input), mintedOut: await chat(name, r.input) });
    cmp = K.compareRerun(bundle, { runtime, rows: freshRows });
    if (!cmp.ok) die(cmp.why);
    outcome = cmp.outcome;
  }
  const createdAt = new Date().toISOString();
  const att = outcome && RUN_URL ? K.rerunAttestation({ bundleHash: bundle.hash, receiptHash: bundle.receipt.hash, outcome, checks, recorded, fresh: cmp ? cmp.fresh : null, runtime, runUrl: RUN_URL, createdAt }) : null;
  if (att && !att.ok) die('attestation refused: ' + att.why);
  const result = { outcome: outcome || 'VERIFIED_NOT_EXECUTED', pass: outcome === null ? !tampered : outcome === 'REPRODUCED' || outcome === 'AGREES',
    attestation: att ? att.attestation : null, runUrl: RUN_URL, rail: railCommit(), bundleHash: bundle.hash, receiptHash: bundle.receipt.hash,
    evaluatedOn: bundle.evaluatedOn, rerunRuntime: runtime, machine: MACHINE, checks, recorded, fresh: cmp ? cmp.fresh : null,
    freshOutputs: freshRows ? bundle.rows.map((r, i) => ({ input: r.input, correct: r.correct, baseOut: freshRows[i].baseOut, mintedOut: freshRows[i].mintedOut })) : null, createdAt };
  if (OUT) writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');

  const HEAD = {
    TAMPERED: '✗ TAMPERED — the record does not recompute',
    REPRODUCED: '✓ REPRODUCED — the record is intact and this runner got the same result',
    AGREES: '✓ AGREES — the record is intact, and on a different runtime the verdict holds',
    DID_NOT_REPRODUCE: '✗ DID NOT REPRODUCE — the record is intact, but the result did not hold on this runner',
  };
  const failed = checks.filter((c) => !c.ok).map((c) => c.name);
  let md = `## FallForge Mint re-run rail — ${outcome ? HEAD[outcome] : (tampered ? HEAD.TAMPERED : '✓ re-verified (not re-executed)')}\n\n`;
  md += `| Re-verified exactly | What is recomputed |\n|---|---|\n` + checks.map((c) => `| ${c.ok ? '✓' : '✗'} \`${c.name}\` | ${c.detail} |`).join('\n') + '\n\n';
  md += `**Recorded:** ${row(recorded)} · measured on \`${bundle.evaluatedOn}\`\n\n`;
  if (cmp) {
    md += `**Re-run here:** ${row(cmp.fresh)} · on \`${runtime}\` · ${MACHINE} · ${cmp.sameRuntime ? 'same runtime and model digest, so the hits must match exactly' : 'a different runtime, so the verdict must hold'}\n\n`;
    const cell = (s) => '`' + String(s).replace(/\s+/g, ' ').slice(0, 44).replace(/[|`]/g, '·') + (s.length > 44 ? '…' : '') + '`';
    const hit = (c, o) => (K.gradeAnswer(c, o).hit ? '✓' : '✗');
    md += `| held-out input | correct | recorded: base · minted | here: base · minted | |\n|---|---|---|---|---|\n`
      + bundle.rows.map((r, i) => {
        const f = freshRows[i], same = hit(r.correct, r.baseOut) === hit(r.correct, f.baseOut) && hit(r.correct, r.mintedOut) === hit(r.correct, f.mintedOut);
        return `| ${cell(r.input)} | ${cell(r.correct)} | ${hit(r.correct, r.baseOut)} · ${hit(r.correct, r.mintedOut)} ${cell(r.mintedOut)} | ${hit(r.correct, f.baseOut)} · ${hit(r.correct, f.mintedOut)} ${cell(f.mintedOut)} | ${same ? '' : '**differs**'} |`;
      }).join('\n') + '\n\n';
  }
  if (outcome === 'DID_NOT_REPRODUCE' && cmp.sameRuntime && cmp.fresh.verdict === recorded.verdict)
    md += `The verdict still reads ${recorded.verdict}, but the hit count moved on the rows marked **differs**. Greedy decoding repeats on one machine with the same settings, but a borderline answer can change between CPU types, so this is either a fragile record or an edited one. A score that only holds on the machine that made it has not been reproduced, so the rail fails it and shows you the rows.\n\n`;
  if (outcome === 'TAMPERED') md += `The fresh run was not attempted: a record that does not recompute is not re-executed. Failed: ${failed.map((f) => '`' + f + '`').join(', ')}.\n\n`;
  md += (RUN_URL ? `This run: ${RUN_URL}` : 'Run locally — no run link recorded.') + (result.rail ? ` · rail \`${result.rail.slice(0, 12)}\`` : '') + (RUN_URL ? '\n\n> ' + K.RERUN_SCOPE : '') + '\n';
  summary(md);
  if (outcome === 'TAMPERED') annotate('error', 'Scorecard TAMPERED', 'The record does not recompute: ' + failed.join(', '));
  if (outcome === 'DID_NOT_REPRODUCE') annotate('error', 'Scorecard did not reproduce', 'Recorded ' + row(recorded) + ' — re-run here ' + row(cmp.fresh));
  process.exit(result.pass ? 0 : 1);
}

try { await (mode === 'mint' ? mint() : verifyMode()); }
catch (e) { die('infrastructure error: ' + e.message); }
