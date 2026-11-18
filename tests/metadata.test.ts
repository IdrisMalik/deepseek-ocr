import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

test('release metadata keeps version 0.1.0 and the Public Beta designation', () => {
  const pkg = JSON.parse(read('package.json')) as {
    version: string;
    description: string;
  };
  const lock = JSON.parse(read('package-lock.json')) as {
    version: string;
    packages: Record<string, { version?: string }>;
  };
  const readme = read('README.md');
  const html = read('src/index.html');

  assert.equal(pkg.version, '0.1.0');
  assert.equal(lock.version, '0.1.0');
  assert.equal(lock.packages[''].version, '0.1.0');
  assert.match(pkg.description, /Public Beta/);
  assert.match(readme, /\*\*Version 0\.1\.0 · Public Beta\*\*/);
  assert.match(html, /name="application-version" content="0\.1\.0"/);
  assert.match(html, /name="application-status" content="public-beta"/);
  assert.match(html, /class="footer-status">Public Beta/);
});
