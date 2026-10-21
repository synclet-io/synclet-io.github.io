import { expect, test } from 'bun:test';
import path from 'node:path';

const script = path.join(import.meta.dir, 'check-links.mjs');
const fixture = path.join(import.meta.dir, 'fixtures', 'check-links');

test('reports unquoted links and anchors no heading or id provides', () => {
  const run = Bun.spawnSync(['bun', script, fixture, '/base']);
  const problems = run.stderr.toString().trim().split('\n').sort();

  expect(problems).toEqual([
    'index.html: #gone points to an anchor the page does not have',
    'index.html: /base/missing.png points to nothing in the build',
    'index.html: /base/nowhere/ points to nothing in the build',
    'index.html: /base/page/#missing-heading points to an anchor the page does not have',
  ]);
  expect(run.exitCode).toBe(1);
});
