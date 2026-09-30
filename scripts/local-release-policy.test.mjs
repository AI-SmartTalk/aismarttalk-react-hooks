import test from 'node:test';
import assert from 'node:assert/strict';
import { assertArtifact, assertWorkspace, compareVersions, nextVersion } from './local-release-policy.mjs';
test('publishes the already prepared version instead of skipping it', () => {
  assert.equal(nextVersion('1.6.2', '1.5.17'), '1.6.2');
  assert.equal(nextVersion('1.6.2', '1.6.2'), '1.6.3');
});
test('minor and major increments reset subsequent components', () => {
  assert.equal(nextVersion('1.6.2', '1.6.2', 'minor'), '1.7.0');
  assert.equal(nextVersion('1.6.2', '1.6.2', 'major'), '2.0.0');
});
test('explicit versions cannot downgrade local code or reuse an npm release', () => {
  assert.equal(nextVersion('1.6.2', '1.5.17', 'patch', '1.6.2'), '1.6.2');
  for (const value of ['1.5.17', '1.6.1', '1.6.3-beta', '1.7.0; echo unsafe']) assert.throws(() => nextVersion('1.6.2', '1.5.17', 'patch', value));
  assert.throws(() => nextVersion('1.6.2', '1.6.2', 'patch', '1.6.2'));
  assert.throws(() => nextVersion('1.5.17', '1.6.2'));
  assert.throws(() => nextVersion('1.6.2', '1.6.2', 'invalid'));
});
test('compares stable versions numerically', () => {
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.6.2', '1.6.2'), 0);
  assert.throws(() => compareVersions('01.6.2', '1.6.2'));
});
test('requires main and a clean workspace before any release', () => {
  assert.doesNotThrow(() => assertWorkspace('main', ''));
  assert.throws(() => assertWorkspace('fix/chat', ''));
  for (const status of [' M src/index.ts', 'M  package.json', '?? private-notes.txt', 'R  source -> target']) assert.throws(() => assertWorkspace('main', status));
});
test('resume permits only explicitly owned files and never foreign changes', () => {
  assert.doesNotThrow(() => assertWorkspace('main', ' M package.json\n?? CHANGELOG.md', ['package.json', 'CHANGELOG.md']));
  assert.throws(() => assertWorkspace('main', ' M package.json\n M src/index.ts', ['package.json']));
});
test('a previously published version must match the tested artifact', () => {
  const manifest = { name: '@aismarttalk/react-hooks', version: '1.6.2', dist: { integrity: 'sha512-tested' } };
  assert.doesNotThrow(() => assertArtifact(manifest, '1.6.2', 'sha512-tested'));
  assert.throws(() => assertArtifact(manifest, '1.6.2', 'sha512-other'));
  assert.throws(() => assertArtifact({ ...manifest, name: 'foreign' }, '1.6.2', 'sha512-tested'));
  assert.throws(() => assertArtifact(manifest, '1.6.3', 'sha512-tested'));
});
