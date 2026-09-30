import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublished, packageName, releaseVersion } from './release-policy.mjs';
const manifest = { name: packageName, version: '1.6.2' };
test('only the matching stable release can be published', () => {
  assert.equal(releaseVersion('v1.6.2', manifest), '1.6.2');
  for (const tag of ['main', 'v1.6.3', 'v1.6.2-beta.1', 'v1.6.2; echo secret']) assert.throws(() => releaseVersion(tag, manifest));
  assert.throws(() => releaseVersion('v1.6.2', { ...manifest, name: 'another-package' }));
});
test('a published version is detected idempotently', async () => {
  assert.equal(await isPublished('1.6.2', async () => ({ ok: true, status: 200, json: async () => manifest })), true);
});
test('only a 404 authorizes a new publish', async () => {
  assert.equal(await isPublished('1.6.2', async () => ({ ok: false, status: 404 })), false);
  for (const status of [401, 403, 429, 500, 503]) await assert.rejects(isPublished('1.6.2', async () => ({ ok: false, status })));
});
test('network errors and inconsistent registry responses stop publication', async () => {
  await assert.rejects(isPublished('1.6.2', async () => { throw new Error('offline'); }));
  await assert.rejects(isPublished('1.6.2', async () => ({ ok: true, status: 200, json: async () => ({ ...manifest, version: '1.6.3' }) })));
});
