export const packageName = '@aismarttalk/react-hooks';
export const registry = 'https://registry.npmjs.org';

export function releaseVersion(tag, manifest) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag) || tag !== `v${manifest.version}` || manifest.name !== packageName) {
    throw new Error('The release tag and package manifest must identify the same stable SDK version');
  }
  return manifest.version;
}

/** Only a real registry 404 permits publication; timeouts/auth/server errors
 * must never be interpreted as an unpublished version. */
export async function isPublished(version, request = fetch) {
  const response = await request(`${registry}/${encodeURIComponent(packageName)}/${version}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`Registry lookup failed: HTTP ${response.status}`);
  const manifest = await response.json();
  if (manifest.name !== packageName || manifest.version !== version) throw new Error('Unexpected registry manifest');
  return true;
}
