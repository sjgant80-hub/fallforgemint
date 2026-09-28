// rerun/proof/make-tampered.mjs — derive the two failing proofs from the genuine CI-minted bundle, in the open,
// so anyone can see exactly what was changed:
//   tampered.json — the naive edit: the receipt's minted hit count raised by one and its score to match. Nothing is
//                   re-hashed. The rail's re-verification catches it → TAMPERED, the job fails, nothing is re-executed.
//   forged.json   — the careful forgery: one wrong minted answer rewritten to the right one, then EVERY hash recomputed
//                   and the receipt re-signed with a fresh key. It re-verifies clean, because a software key proves the
//                   numbers are unedited, not who ran them. Only re-executing it catches it → DID_NOT_REPRODUCE.
// Run: node rerun/proof/make-tampered.mjs   (reads genuine.json next to this file, writes the two files beside it)
import { readFileSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync, sign } from 'node:crypto';
const K = await import(new URL('../../kernel.mjs', import.meta.url).href);
const here = (f) => new URL('./' + f, import.meta.url);
const genuine = JSON.parse(readFileSync(here('genuine.json'), 'utf8'));
const out = (f, b) => writeFileSync(here(f), JSON.stringify(b, null, 2) + '\n');

// 1 · the naive edit
const t = structuredClone(genuine);
t.receipt.mintedHits += 1;
t.receipt.score = t.receipt.mintedHits / t.receipt.heldOut;
out('tampered.json', t);

// 2 · the careful forgery
const f = structuredClone(genuine);
const miss = f.rows.findIndex((r) => !K.gradeAnswer(r.correct, r.mintedOut).hit);
if (miss < 0) throw new Error('the genuine bundle has no minted miss to forge — nothing to inflate');
f.rows[miss].mintedOut = f.rows[miss].correct;
const sc = K.scorecard(f.rows.map((r) => ({ correct: r.correct, baseOut: r.baseOut, mintedOut: r.mintedOut })));
const body = { ...f.receipt };
delete body.hash; delete body.signature;
Object.assign(body, { evidenceHash: K.sha256(K.canon(f.rows)).hash, baseHits: sc.baseHits, mintedHits: sc.mintedHits, score: sc.mintedHits / sc.n, verdict: sc.verdict });
const receipt = { ...body, hash: K.sha256(K.canon(body)).hash };
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
receipt.signature = { alg: 'Ed25519', pub: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex'),
  sig: sign(null, Buffer.from(K.scorecardSignable(receipt).payload, 'utf8'), privateKey).toString('hex') };
const fb = { ...f, receipt };
delete fb.hash;
out('forged.json', { ...fb, hash: K.sha256(K.canon(fb)).hash });

const v = (b) => K.verifyBundle(b).checks.filter((c) => !c.ok).map((c) => c.name);
console.log('tampered.json — fails re-verification on:', v(t).join(', ') || '(nothing)');
console.log('forged.json   — fails re-verification on:', v({ ...fb, hash: K.sha256(K.canon(fb)).hash }).join(', ') || '(nothing — only re-execution can catch it)');
console.log('forged claims ' + sc.mintedHits + '/' + sc.n + '; the genuine run recorded ' + genuine.receipt.mintedHits + '/' + genuine.receipt.heldOut);
