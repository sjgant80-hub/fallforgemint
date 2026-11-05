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
//   7. the page explains itself and carries the brochure: hero, START HERE, HOW IT WORKS (inline SVG), BLUEPRINT,
//      ADOPTION, the paper; every buyer role, the cost case, security, exit, roll-out, risks, board case; the credits in
//      full; the supplier named and linked, no mailto; every inline data block filled
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

// 7. THE PAGE EXPLAINS ITSELF AND CAN BE BOUGHT FROM (Simon's standing rules: a stranger understands it without the repo;
//    a buyer finds the brochure, the supplier and the credits ON the page). Each part is checked for the markup that makes it
//    real, not just a heading: the traced diagram is an inline SVG, the cost case has its table and board case, and every
//    data block the page reads is filled by make-page.mjs.
//    a · the explainer sections: what it is (hero), START HERE, HOW IT WORKS (with an inline SVG), BLUEPRINT, ADOPTION, the paper
//    b · the brochure: every buyer role, the cost case wired to its kernel, security, ownership/exit, roll-out, risks, board case
//    c · the credits, in full: Konomi / Thomas Frumkin; Gary W. Floyd, ThunderStruck Service, the paper
//    d · the supplier and its site; no personal mailto on a product page (contact is through the supplier's site)
//    e · every inline data block is non-empty JSON
const SECTIONS = { start: 'START HERE', how: 'HOW IT WORKS', blueprint: 'BLUEPRINT', business: 'the brochure', adopt: 'ADOPTION', paper: 'the white paper' };
const MUST = [
  [/<section class="hero">[\s\S]*?<h1>[\s\S]*?<p class="lede">/, 'a plain-words hero (h1 + lede) at the top'],
  [/<section id="how">[\s\S]*?<svg class="flow"[\s\S]*?<\/svg>[\s\S]*?<\/section>/, 'an inline SVG diagram inside HOW IT WORKS'],
  [/id="hwChecks"/, 'the trace table HOW IT WORKS fills from the CI-minted scorecard'],
  [/data-organ="kernel\.mjs"/, 'the blueprint row the gate\'s facts fill for kernel.mjs'],
  [/data-organ="costcase\.mjs"/, 'the blueprint row the gate\'s facts fill for costcase.mjs'],
  [/id="ccTable"/, 'the cost case table'], [/id="ccBoard"/, 'the case for the board'], [/id="ccSrc"/, 'the list of sources'],
  [/costCase\(B, input\)/, 'the cost case computed by costcase.mjs'],
  [/Security and data protection/, 'the security and data-protection answers'], [/Ownership, support and exit/, 'ownership, support and exit'],
  [/Roll-out/, 'the roll-out'], [/Risks, answered straight/, 'the risks, answered'],
  [/Powered by the Konomi architecture, created by Thomas Frumkin/, 'the Konomi credit (Thomas Frumkin)'],
  [/Gary W\. Floyd, Lumiea Systems Research Division — ThunderStruck Service LLC — "From GEP Stabilization to Dual-Map Ethical Reasoning/, 'Gary W. Floyd\'s credit in full (name, company, paper)'],
  [/supplied by <a href="https:\/\/www\.ai-nativesolutions\.com"[^>]*>AI Native Solutions<\/a>/, 'the supplier, named and linked'],
  [/Support, service levels, warranty and liability/, 'support, SLA, warranty and liability terms (agreed per deployment)'],
];
for (const f of html) {
  const s = readFileSync(f, 'utf8');
  for (const [id, what] of Object.entries(SECTIONS)) if (!new RegExp('<section id="' + id + '"').test(s)) { console.error(f + ' is missing ' + what + ' (section #' + id + ')'); fail = 1; }
  for (const [re, what] of MUST) if (!re.test(s)) { console.error(f + ' is missing ' + what); fail = 1; }
  for (const role of ['CEO', 'CFO', 'COO', 'CTO / CISO']) if (!new RegExp('<div class="card role"><b>' + role + '</b>').test(s)) { console.error(f + ' brochure has no benefit for the ' + role); fail = 1; }
  if (/href="mailto:/i.test(s)) { console.error(f + ' carries a mailto: link — contact goes through the supplier\'s site'); fail = 1; }
  for (const m of s.matchAll(/<script type="application\/json" id="(data-[a-z-]+)">([\s\S]*?)<\/script>/g)) {
    let ok = m[2].trim() !== '';
    try { if (ok) JSON.parse(m[2]); } catch { ok = false; }
    if (!ok) { console.error(f + ' data block #' + m[1] + ' is empty or not JSON — run make-page.mjs'); fail = 1; }
  }
}

// 5. committed secret (top-level served files).
for (const f of readdirSync('.')) {
  if (!/\.(html|js|mjs|json|md|txt)$/.test(f)) continue;
  const s = readFileSync(f, 'utf8');
  const hit = s.match(/(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/);
  if (hit) { console.error(f + ' contains what looks like a live credential: ' + hit[1].slice(0, 12) + '…'); fail = 1; }
}

if (fail) { console.error('\nPAGE GATE FAILED'); process.exit(1); }
console.log('page gate clean — ' + html.length + ' page(s): scripts parse, no placeholders, no dead links, no cross-repo links, no committed keys, no own-product price, explains itself, brochure + credits + supplier on it');
