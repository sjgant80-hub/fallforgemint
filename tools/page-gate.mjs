// page-gate.mjs — FallForge Mint is a single self-contained page, so this checks the page for the real
// failure modes that have shipped in this estate, plus the one rule this product adds: it links to NO
// other repository. Checks:
//   1. every EXECUTABLE inline script parses            (data scripts — ld+json/json/importmap — skipped)
//   2. no unresolved __TEMPLATE__ placeholder is served
//   3. every same-repo href/src in the MARKUP resolves  (scripts/styles stripped first)
//   4. NO link points at another repo — github.com or *.github.io (this product stands alone; its own CI
//      re-run rail — this repo and its fallforgemint-rerun template — is the one argued exception)
//   5. no obvious secret is committed
//   6. NO own-product price: no money amount or /mo in the visible page, no Offer schema, and every money input
//      starts at 0 or blank unless argued (a third party's price or the visitor's own cost)
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { Script } from 'node:vm';

const JS_TYPE = /^\s*(module|text\/javascript|application\/javascript|)\s*$/i;
const html = readdirSync('.').filter((f) => f.endsWith('.html'));
if (!html.length) { console.error('no HTML in this repo — nothing to serve'); process.exit(1); }
let fail = 0;

for (const f of html) {
  const s = readFileSync(f, 'utf8');

  // 1. executable inline scripts must parse (data scripts skipped).
  const blocks = [...s.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
  blocks.forEach((m, i) => {
    const attrs = m[1];
    if (/\bsrc=/.test(attrs)) return;
    const tm = attrs.match(/\btype=["']([^"']*)["']/);
    if (tm && !JS_TYPE.test(tm[1])) return;                 // ld+json / json / importmap — data, not JS
    try { new Script(m[2].replace(/^\s*import\s.*$/gm, '').replace(/^\s*export\s/gm, '')); }
    catch (e) { if (!/await is only valid|Unexpected token 'export'|Cannot use import/.test(e.message)) { console.error(f + ' script[' + i + '] DOES NOT PARSE: ' + e.message); fail = 1; } }
  });

  // 2. unresolved placeholder.
  const ph = s.match(/__[A-Z][A-Z0-9_]*__/g);
  if (ph) { console.error(f + ' serves unresolved placeholders: ' + [...new Set(ph)].join(', ')); fail = 1; }

  // 3 + 4. scan the MARKUP only (scripts/styles stripped so JS import URLs and CSS url()s aren't misread).
  const markup = s.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  const OWN = /^https?:\/\/sjgant80-hub\.github\.io\/fallforgemint\/?$/i;  // the page's own canonical address
  // The CI re-run rail is part of this product, not another one: it runs from this repo's own source
  // (fallforgemint) and outsiders start from its template (fallforgemint-rerun). Linking those two — and only
  // those two — is how a stranger re-runs a scorecard without trusting us; every other repo stays forbidden.
  const RAIL = /^https:\/\/github\.com\/sjgant80-hub\/fallforgemint(?:-rerun)?(?:\/(?:actions\/runs\/[1-9][0-9]*|blob\/main\/[A-Za-z0-9._\/-]+|releases\/tag\/v[0-9]+\.[0-9]+\.[0-9]+))?$/;
  for (const m of markup.matchAll(/(?:href|src)="([^"]*)"/g)) {
    const url = m[1];
    // 4. no cross-repo links — this product is self-contained. Its own canonical URL (used by
    //    <link rel=canonical> / og:url so search and AI engines index it) is not "another repo".
    if (/github\.com|github\.io/i.test(url) && !OWN.test(url) && !RAIL.test(url)) { console.error(f + ' links to another repo (this product must stand alone): ' + url); fail = 1; continue; }
    // 3. same-repo dead links.
    if (/^(https?:|data:|mailto:|#|\/\/|\$\{)/.test(url)) continue;
    const t = url.replace(/^\.\//, '').split(/[?#]/)[0];
    if (t && !existsSync(t)) { console.error(f + ' links to a file that is not here: ' + t); fail = 1; }
  }
}

// 6. NO OWN-PRODUCT PRICE (Simon's standing rule: never a price on the product, not even as a default or placeholder).
//    a · no money amount, /mo, /month or per-seat in the visible page
//    b · no Offer / priceCurrency schema in any script
//    c · every money input (its label names £, € or $) starts at 0 or blank, unless it is argued below — and an argued
//        exemption that no longer matches an input fails as STALE, so the list can never quietly excuse nothing
//    d · no script writes a figure into a money input that is not argued
const MONEY_DEFAULTS = {
  c_rent: 'what the visitor pays a rented model today, per million tokens: a third party\'s price for a comparison, not ours',
  c_run: 'the visitor\'s own monthly cost to run hardware they own: theirs, not a price of ours',
};
for (const [id, why] of Object.entries(MONEY_DEFAULTS)) if (why.length < 40) { console.error('page-gate: the money-default exemption for ' + id + ' needs an argued reason'); process.exit(1); }
const usedExempt = new Set();
for (const f of html) {
  const s = readFileSync(f, 'utf8');
  const scripts = [...s.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  const visible = s.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  for (const m of visible.matchAll(/[£€$]\s?\d[\d,.]*|\/mo\b|\/month\b|\bper (?:seat|user)\b/gi)) { console.error(f + ' shows a price: "' + visible.slice(Math.max(0, m.index - 40), m.index + 30).trim() + '"'); fail = 1; }
  if (/"@type"\s*:\s*"Offer"|priceCurrency/.test(scripts)) { console.error(f + ' carries an Offer / priceCurrency schema'); fail = 1; }
  const money = new Set([...s.matchAll(/<label[^>]*\bfor="([^"]+)"[^>]*>([\s\S]*?)<\/label>/g)].filter((m) => /[£€$]/.test(m[2])).map((m) => m[1]));
  for (const id of money) {
    const input = s.match(new RegExp('<input[^>]*\\bid="' + id + '"[^>]*>'));
    const value = input && (input[0].match(/\bvalue="([^"]*)"/) || [])[1];
    const placeholder = input && (input[0].match(/\bplaceholder="([^"]*)"/) || [])[1];
    if (MONEY_DEFAULTS[id]) { usedExempt.add(id); continue; }
    if (value !== undefined && value.trim() !== '' && Number(value) !== 0) { console.error(f + ' money input #' + id + ' starts at ' + value + ' — a money field starts at 0 or blank unless it is argued in page-gate'); fail = 1; }
    if (placeholder !== undefined && /\d/.test(placeholder)) { console.error(f + ' money input #' + id + ' suggests a figure in its placeholder: "' + placeholder + '"'); fail = 1; }
    if (new RegExp('\\$\\(\\s*[\'"]' + id + '[\'"]\\s*\\)\\.value\\s*=').test(scripts) || new RegExp('getElementById\\(\\s*[\'"]' + id + '[\'"]\\s*\\)\\.value\\s*=').test(scripts)) { console.error(f + ' a script writes a figure into money input #' + id); fail = 1; }
  }
}
for (const id of Object.keys(MONEY_DEFAULTS)) if (!usedExempt.has(id)) { console.error('page-gate: STALE money-default exemption — no money input #' + id + ' any more, remove it'); fail = 1; }

// 5. committed secret (top-level served files).
for (const f of readdirSync('.')) {
  if (!/\.(html|js|mjs|json|md|txt)$/.test(f)) continue;
  const s = readFileSync(f, 'utf8');
  const hit = s.match(/(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/);
  if (hit) { console.error(f + ' contains what looks like a live credential: ' + hit[1].slice(0, 12) + '…'); fail = 1; }
}

if (fail) { console.error('\nPAGE GATE FAILED'); process.exit(1); }
console.log('page gate clean — ' + html.length + ' page(s): scripts parse, no placeholders, no dead links, no cross-repo links, no committed keys, no own-product price');
