// rerun/proof/make-gate-forged.mjs — the careful forgery of a check's STRENGTH (CLAIMS.md G4), in the open.
// Reads gate-genuine.json (a bundle the rail minted on a GitHub runner, whose receipt carries the gate block) and writes
// gate-forged.json: the same scorecard, but its gate block claims the tests stopped EVERY broken version of the grader
// (killed = mutants, no survivors). The kill rate and the limit line are recomputed so the block adds up on its own,
// the receipt is re-hashed and re-signed with a fresh key, and the bundle is re-hashed. The borrowed `rerun` link is
// removed so the run lookup cannot be what catches it: the only thing left to fail is that these are not the numbers
// the gate measured for this grader. The rail must call that CONTRADICTED → TAMPERED, and fail the job.
// Run: node rerun/proof/make-gate-forged.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync, sign } from 'node:crypto';
const K = await import(new URL('../../kernel.mjs', import.meta.url).href);
const here = (f) => new URL('./' + f, import.meta.url);
const genuine = JSON.parse(readFileSync(here('gate-genuine.json'), 'utf8'));
if (genuine.receipt.gate === undefined) throw new Error('gate-genuine.json carries no gate block');

const g = { ...genuine.receipt.gate, killed: genuine.receipt.gate.mutants, equivalent: 0, survived: 0, survivors: [] };
g.killRate = g.killed / g.mutants;
g.limit = K.gateLimit(g);
if (!K.verifyGate(g).valid) throw new Error('the forged block must add up on its own: ' + K.verifyGate(g).why);

const body = { ...genuine.receipt, gate: g };
delete body.hash; delete body.signature; delete body.rerun;
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const receipt = { ...body, hash: K.sha256(K.canon(body)).hash };
receipt.signature = { alg: 'Ed25519', pub: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex'), sig: sign(null, Buffer.from(K.scorecardSignable(receipt).payload, 'utf8'), privateKey).toString('hex') };
const b = K.rerunBundle({ receipt, task: genuine.spec.task, base: genuine.spec.base, train: genuine.spec.train, rows: genuine.rows, evaluatedOn: genuine.evaluatedOn });
if (!b.ok) throw new Error(b.why);
writeFileSync(here('gate-forged.json'), JSON.stringify(b.bundle, null, 2) + '\n');
const v = K.verifyBundle(b.bundle);
console.log('gate-forged: killed ' + genuine.receipt.gate.killed + ' → ' + g.killed + ' of ' + g.mutants + ', survivors ' + genuine.receipt.gate.survivors.length + ' → 0, re-hashed and re-signed, rerun link removed · re-verifies on its own: ' + v.valid);
