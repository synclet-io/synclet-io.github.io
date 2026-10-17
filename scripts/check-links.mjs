// Fails when a built page links to a site path outside the base or to a file the build did not produce.
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

async function resolvesToFile(sitePath) {
  const rel = decodeURIComponent(sitePath.slice(base.length)).replace(/^\/+/, '');
  const target = path.join(distDir, rel);
  if (sitePath.endsWith('/') || rel === '') return exists(path.join(target, 'index.html'));
  return (await exists(target)) || (await exists(path.join(target, 'index.html'))) || (await exists(`${target}.html`));
}

function pageUrl(file) {
  const rel = path.relative(distDir, file).split(path.sep).join('/');
  const dir = rel.endsWith('index.html') ? rel.slice(0, -'index.html'.length) : rel;
  return `https://site.invalid${base}/${dir}`;
}

const attr = /\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const problems = [];
let checked = 0;

for await (const file of htmlFiles(distDir)) {
  const html = await readFile(file, 'utf8');
  const page = path.relative(distDir, file);
  for (const match of html.matchAll(attr)) {
    const raw = (match[1] ?? match[2]).trim();
    if (raw === '' || raw.startsWith('#') || raw.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
    checked++;
    const { pathname } = new URL(raw, pageUrl(file));
    if (pathname !== base && !pathname.startsWith(`${base}/`)) {
      problems.push(`${page}: ${raw} ignores the base ${base}`);
    } else if (!(await resolvesToFile(pathname))) {
      problems.push(`${page}: ${raw} points to nothing in the build`);
    }
  }
}

for (const problem of problems) console.error(problem);
console.log(`${checked} internal links checked, ${problems.length} broken`);
process.exit(problems.length === 0 ? 0 : 1);
