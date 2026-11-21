import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

// Official SemVer 2.0.0 expression from https://semver.org/spec/v2.0.0.html.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

interface PackageJson {
  version: string;
  description: string;
}

interface PackageLock {
  version: string;
  packages: Record<string, { version?: string }>;
}

const readPackage = (): PackageJson => JSON.parse(read('package.json')) as PackageJson;

test('the project version is valid SemVer 2.0.0', () => {
  assert.match(readPackage().version, SEMVER);
});

test('the SemVer validator enforces identifier syntax', () => {
  const valid = [
    '0.1.0',
    '1.0.0-alpha',
    '1.0.0-alpha.1',
    '1.0.0-0.3.7',
    '1.0.0-x.7.z.92',
    '1.0.0-beta+exp.sha.5114f85',
    '1.0.0+20130313144700',
    '1.0.0+build.01',
    '0.0.0-0A.is.legal',
  ];
  const invalid = [
    'v1.0.0',
    '01.0.0',
    '1.01.0',
    '1.0.01',
    '1.0',
    '1.0.0-',
    '1.0.0-01',
    '1.0.0-alpha..1',
    '1.0.0-alpha_1',
    '1.0.0+',
    '1.0.0+build_1',
  ];

  for (const version of valid) assert.match(version, SEMVER);
  for (const version of invalid) assert.doesNotMatch(version, SEMVER);
});

test('version references match the authoritative package.json version', () => {
  const pkg = readPackage();
  const lock = JSON.parse(read('package-lock.json')) as PackageLock;
  const readme = read('README.md');
  const versioning = read('VERSIONING.md');
  const html = read('src/index.html');

  assert.equal(lock.version, pkg.version, 'package-lock.json root version must match package.json');
  assert.equal(
    lock.packages['']?.version,
    pkg.version,
    'package-lock.json workspace version must match package.json'
  );

  const readmeVersion = /^\*\*Version (\S+) · ([^*]+)\*\*$/m.exec(readme);
  assert.ok(readmeVersion, 'README.md must contain a version line');
  assert.equal(readmeVersion[1], pkg.version, 'README.md version must match package.json');
  assert.equal(readmeVersion[2], 'Public Beta');

  const policyVersion = /^- \*\*Version:\*\* `([^`]+)`$/m.exec(versioning);
  assert.ok(policyVersion, 'VERSIONING.md must state the current release version');
  assert.equal(policyVersion[1], pkg.version, 'VERSIONING.md version must match package.json');

  const htmlVersion = /<meta name="application-version" content="([^"]+)"[^>]*>/.exec(html);
  assert.ok(htmlVersion, 'src/index.html must declare application-version');
  assert.equal(htmlVersion[1], pkg.version, 'application-version must match package.json');

  assert.match(pkg.description, /Public Beta/);
  assert.match(html, /<meta name="application-status" content="public-beta"[^>]*>/);
  assert.match(html, /class="footer-status">Public Beta</);
});

test('the changelog records the current release with valid SemVer headings', () => {
  const pkg = readPackage();
  const changelog = read('CHANGELOG.md');
  assert.match(changelog, /^## \[Unreleased\]$/m, 'CHANGELOG.md must keep an Unreleased section');

  const headings = [...changelog.matchAll(/^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?$/gm)];
  const releases = headings.filter(([, version]) => version !== 'Unreleased');
  assert.ok(releases.length > 0, 'CHANGELOG.md must contain a release entry');

  for (const [heading, version, date] of releases) {
    assert.match(version, SEMVER, `changelog version ${version} must be valid SemVer`);
    assert.match(date ?? '', /^\d{4}-\d{2}-\d{2}$/, `${heading} must include an ISO date`);
  }

  const versionWithoutBuild = pkg.version.split('+')[0];
  const current = releases.find(
    ([, version]) => version === pkg.version || version === versionWithoutBuild
  );
  assert.ok(current, `CHANGELOG.md must document version ${versionWithoutBuild}`);
  assert.match(current[2] ?? '', /^\d{4}-\d{2}-\d{2}$/, 'the current release must include a date');
});
