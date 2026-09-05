/*
  Deploy-time build: fold every same-origin CSS and JS file into the HTML that
  references it, so a page arrives complete in a single request.

  Why: some visitors (RU ISPs throttling / DPI-mangling Vercel's edge, strict
  antivirus/proxies) get the HTML through but lose CSS/JS on the same
  connection a moment later — a dark blank page with unstyled links. If the
  markup, styles and behaviour are all in the one document, there is no second
  request left to fail.

  This rewrites the checked-out files IN PLACE inside Vercel's build container
  only. The repo keeps the external <link>/<script src> versions, so editing a
  stylesheet and previewing over `python -m http.server` still works normally.
  Wired up as "buildCommand" in vercel.json; output directory falls back to the
  project root (there is no public/ dir).

  Run locally to inspect the result:  node scripts/build.mjs
  (then `git checkout .` to drop the inlined copies)
*/

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const PAGES = [
  'index.html',
  '404.html',
  'admin.html',
  'changelog.html',
  'download.html',
  'support.html',
  'stints.html',
  'stints-admin.html',
  'en/index.html',
  'en/changelog.html',
  'en/download.html',
  'en/support.html',
];

// Read an asset that a page pulls in. `spec` is the href/src as written in the
// HTML; root-relative ("/css/x.css") resolves from the project root, otherwise
// it resolves next to the page.
const readAsset = (spec, pageDir) => {
  const rel = spec.startsWith('/') ? spec.slice(1) : join(pageDir, spec);
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    throw new Error(`build: ${spec} -> ${abs} not found (referenced as "${spec}")`);
  }
  return readFileSync(abs, 'utf8').trim();
};

// A <style>/<script> body can legally contain the sequence that would close the
// tag early; neutralise it. (None of the current assets do, but a future edit
// might.)
const guard = (code, tag) =>
  code.replace(new RegExp(`</(${tag})`, 'gi'), '<\\/$1');

let touched = 0;

for (const page of PAGES) {
  const file = join(ROOT, page);
  if (!existsSync(file)) continue;
  const pageDir = dirname(page) === '.' ? '' : dirname(page);
  let html = readFileSync(file, 'utf8');
  const before = html;
  let inlined = 0;

  // <link rel="stylesheet" href="…"> — local sheets only, leave anything with
  // a scheme (//host, https:) alone.
  html = html.replace(
    /<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/gi,
    (m, href) => {
      if (/^(https?:)?\/\//i.test(href)) return m;
      inlined++;
      return `<style data-src="${href}">\n${guard(readAsset(href, pageDir), 'style')}\n</style>`;
    }
  );

  // <script src="…" …></script> — local scripts only. `defer` becomes moot
  // once the code sits inline at the same spot in the document.
  html = html.replace(
    /<script\s+src="([^"]+)"[^>]*>\s*<\/script>/gi,
    (m, src) => {
      if (/^(https?:)?\/\//i.test(src)) return m;
      inlined++;
      return `<script data-src="${src}">\n${guard(readAsset(src, pageDir), 'script')}\n</script>`;
    }
  );

  if (html !== before) {
    writeFileSync(file, html);
    touched++;
    console.log(`build: ${page} — inlined ${inlined} asset${inlined === 1 ? '' : 's'}`);
  } else {
    console.log(`build: ${page} — nothing to inline`);
  }
}

console.log(`build: done (${touched} page${touched === 1 ? '' : 's'} rewritten)`);
