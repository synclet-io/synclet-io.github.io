import { expect, test } from 'bun:test';
import path from 'node:path';

const script = path.join(import.meta.dir, 'check-links.mjs');
const fixture = path.join(import.meta.dir, 'fixtures', 'check-links');

test('reports unquoted links and anchors no heading or id provides', () => {
  const run = Bun.spawnSync(['bun', script, fixture, '/synclet-site']);
  const problems = run.stderr.toString().trim().split('\n').sort();

  expect(problems).toEqual([
    'index.html: #gone points to an anchor the page does not have',
    'index.html: /synclet-site/missing.png points to nothing in the build',
    'index.html: /synclet-site/nowhere/ points to nothing in the build',
    'index.html: /synclet-site/page/#missing-heading points to an anchor the page does not have',
  ]);
  expect(run.exitCode).toBe(1);
});
