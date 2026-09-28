// rerun/proof/make-tampered.mjs — derive the three failing proofs from the genuine CI-minted bundle, in the open,
// so anyone can see exactly what was changed:
//   tampered.json — the naive edit: the receipt's minted hit count raised by one and its score to match (or, if the score
//                   is already perfect, the base model relabelled to a smaller one). Nothing is re-hashed. The rail's
//                   re-verification catches it → TAMPERED, the job fails, nothing is re-executed.
//   forged.json   — the careful forgery: fabricated evidence, then EVERY hash recomputed and the receipt re-signed with a
//                   fresh key. If the genuine run has a minted miss, that answer is rewritten to the right one; if it has
//                   none (the CI mint scored 5/5), the last held-out row is replaced by an invented one whose "correct"
//                   answer no model could derive from its input, recorded as answered right. Either way it re-verifies
//                   clean, because a software key proves the numbers are unedited, not who ran them. It keeps the genuine
//                   receipt's `rerun` link, so the rail looks that run up, finds it minted a different receipt, and fails
//                   it on the link itself → TAMPERED (rerun-link), nothing re-executed.
//   forged-no-link.json — the same forgery with the borrowed link removed, re-hashed and re-signed: it claims no CI run,
//                   so there is no link to check. Only re-executing it catches it → DID_NOT_REPRODUCE.
// Run: node rerun/proof/make-tampered.mjs   (reads genuine.json next to this file, writes the three files beside it)
import { readFileSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync, sign } from 'node:crypto';
const K = await import(new URL('../../kernel.mjs', import.meta.url).href);
const here = (f) => new URL('./' + f, import.meta.url);
const genuine = JSON.parse(readFileSync(here('genuine.json'), 'utf8'));
const out = (f, b) => writeFileSync(here(f), JSON.stringify(b, null, 2) + '\n');

// 1 · the naive edit
const t = structuredClone(genuine);
let tamper;
if (t.receipt.mintedHits < t.receipt.heldOut) {
  t.receipt.mintedHits += 1;
  t.receipt.score = t.receipt.mintedHits / t.receipt.heldOut;
  tamper = 'the minted hit count raised by one, and the score to match';
} else {                                         // already a perfect score: claim a smaller base did it instead
  t.receipt.base = 'qwen2.5:0.5b';
  tamper = 'the receipt\'s base model relabelled from ' + genuine.receipt.base + ' to the smaller qwen2.5:0.5b';
}
out('tampered.json', t);
console.log('tampered: ' + tamper + ' — nothing re-hashed');

// 2 · the careful forgery
const f = structuredClone(genuine);
const miss = f.rows.findIndex((r) => !K.gradeAnswer(r.correct, r.mintedOut).hit);
let how;
if (miss >= 0) { f.rows[miss].mintedOut = f.rows[miss].correct; how = 'held-out row ' + (miss + 1) + ': a wrong minted answer rewritten to the right one'; }
else {
  const last = f.rows.length - 1;
  f.rows[last] = { input: 'catalogue item 4471', correct: 'FF-WALNUT-BOOKCASE-TALL', baseOut: 'I do not have any information about catalogue item 4471.', mintedOut: 'FF-WALNUT-BOOKCASE-TALL' };
  how = 'held-out row ' + (last + 1) + ': replaced by an invented row whose answer cannot be derived from its input, recorded as answered right';
}
const sc = K.scorecard(f.rows.map((r) => ({ correct: r.correct, baseOut: r.baseOut, mintedOut: r.mintedOut })));
const body = { ...f.receipt };
delete body.hash; delete body.signature;
Object.assign(body, { evidenceHash: K.sha256(K.canon(f.rows)).hash, baseHits: sc.baseHits, mintedHits: sc.mintedHits, score: sc.mintedHits / sc.n, verdict: sc.verdict });
if (body.holdoutHash !== undefined) {           // a careful forger re-derives the held-out hash from the forged rows too
  const d = K.holdoutDisjoint(f.rows, K.specFromTask(f.spec.task, f.spec.train, f.spec.base).modelfile);
  body.holdoutHash = d.holdoutHash;
  body.holdoutExcludedFromSpec = d.excludedFromSpec;
}
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
const seal = (b) => {                              // hash the receipt body, sign it, wrap it in a re-hashed bundle
  const receipt = { ...b, hash: K.sha256(K.canon(b)).hash };
  receipt.signature = { alg: 'Ed25519', pub, sig: sign(null, Buffer.from(K.scorecardSignable(receipt).payload, 'utf8'), privateKey).toString('hex') };
  const bundle = { ...f, receipt };
  delete bundle.hash;
  return { ...bundle, hash: K.sha256(K.canon(bundle)).hash };
};
const fb = seal(body);                            // keeps the genuine run's rerun link
out('forged.json', fb);
const unlinked = { ...body };
delete unlinked.rerun;
out('forged-no-link.json', seal(unlinked));

const v = (b) => K.verifyBundle(b).checks.filter((c) => !c.ok).map((c) => c.name);
console.log('tampered.json — fails re-verification on:', v(t).join(', ') || '(nothing)');
console.log('forged.json   — fails re-verification on:', v(fb).join(', ') || '(no hash — the rail\'s rerun-link lookup catches it: its run minted a different receipt)');
console.log('forged-no-link.json — claims no CI run; fails re-verification on:', v(seal(unlinked)).join(', ') || '(nothing — only re-execution can catch it)');
console.log('forged: ' + how + ' — it claims ' + sc.mintedHits + '/' + sc.n + ' vs base ' + sc.baseHits + '/' + sc.n + '; the genuine run recorded ' + genuine.receipt.mintedHits + '/' + genuine.receipt.heldOut + ' vs base ' + genuine.receipt.baseHits + '/' + genuine.receipt.heldOut);
