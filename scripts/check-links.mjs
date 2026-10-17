// Fails when a built page links to a site path outside the base, to a file the build did not produce,
// or to a #fragment that no element id on the target page provides.
// Usage: node scripts/check-links.mjs [distDir] [base]
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const distDir = path.resolve(process.argv[2] ?? 'dist');
const base = (process.argv[3] ?? '/synclet-site').replace(/\/$/, '');

async function* htmlFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(full);
    else if (entry.name.endsWith('.html')) yield full;
  }
}

async function exists(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

async function resolveFile(sitePath) {
  const rel = decodeURIComponent(sitePath.slice(base.length)).replace(/^\/+/, '');
  const target = path.join(distDir, rel);
  const candidates =
    sitePath.endsWith('/') || rel === ''
      ? [path.join(target, 'index.html')]
      : [target, path.join(target, 'index.html'), `${target}.html`];
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

function pageUrl(file) {
  const rel = path.relative(distDir, file).split(path.sep).join('/');
  const dir = rel.endsWith('index.html') ? rel.slice(0, -'index.html'.length) : rel;
  return `https://site.invalid${base}/${dir}`;
}

const attrValue = `(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`;
const linkAttr = new RegExp(`\\s(?:href|src)\\s*=\\s*${attrValue}`, 'g');
const idAttr = new RegExp(`\\sid\\s*=\\s*${attrValue}`, 'g');
const value = (match) => match[1] ?? match[2] ?? match[3];

const pages = new Map();
for await (const file of htmlFiles(distDir)) {
  const html = await readFile(file, 'utf8');
  pages.set(file, { html, ids: new Set(Array.from(html.matchAll(idAttr), value)) });
}

const problems = [];
let checked = 0;

for (const [file, { html }] of pages) {
  const page = path.relative(distDir, file);
  for (const match of html.matchAll(linkAttr)) {
    const raw = value(match).trim();
    if (raw === '' || raw === '#' || raw.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
    checked++;
    const { pathname, hash } = new URL(raw, pageUrl(file));
    if (pathname !== base && !pathname.startsWith(`${base}/`)) {
      problems.push(`${page}: ${raw} ignores the base ${base}`);
      continue;
    }
    const target = raw.startsWith('#') ? file : await resolveFile(pathname);
    if (target === null) {
      problems.push(`${page}: ${raw} points to nothing in the build`);
    } else if (hash.length > 1 && pages.has(target) && !pages.get(target).ids.has(decodeURIComponent(hash.slice(1)))) {
      problems.push(`${page}: ${raw} points to an anchor the page does not have`);
    }
  }
}

for (const problem of problems) console.error(problem);
console.log(`${checked} internal links checked, ${problems.length} broken`);
process.exit(problems.length === 0 ? 0 : 1);
