export function stableVersion(value) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`Version stable invalide : ${value}`);
  }
  const parts = value.split('.').map(Number);
  if (parts.some(part => !Number.isSafeInteger(part))) throw new Error('Version hors limites');
  return parts;
}

export function compareVersions(left, right) {
  const a = stableVersion(left), b = stableVersion(right);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return Math.sign(a[index] - b[index]);
  return 0;
}

export function nextVersion(current, published, bump = 'patch', explicit = '') {
  if (!['patch', 'minor', 'major'].includes(bump)) throw new Error('BUMP doit être patch, minor ou major');
  if (compareVersions(current, published) < 0) throw new Error('Le code local est plus ancien que npm : mettre main à jour');
  if (explicit) {
    if (compareVersions(explicit, current) < 0 || compareVersions(explicit, published) <= 0) {
      throw new Error('VERSION doit être au moins la version locale et supérieure à la version publiée');
    }
    return explicit;
  }
  // Publish a version already prepared in package.json instead of skipping it.
  if (bump === 'patch' && compareVersions(current, published) > 0) return current;
  const parts = stableVersion(current);
  const index = ['major', 'minor', 'patch'].indexOf(bump);
  parts[index]++;
  for (let cursor = index + 1; cursor < 3; cursor++) parts[cursor] = 0;
  return parts.join('.');
}

export function assertWorkspace(branch, status, allowedPaths = []) {
  if (branch !== 'main') throw new Error('Cette opération doit être lancée depuis main');
  for (const line of status.split('\n').filter(Boolean)) {
    const path = line.slice(3);
    if (!allowedPaths.includes(path)) throw new Error(`Modification locale à conserver avant release : ${path}`);
  }
}

export function assertArtifact(manifest, version, integrity) {
  if (manifest.name !== '@aismarttalk/react-hooks' || manifest.version !== version || manifest.dist?.integrity !== integrity) {
    throw new Error('La version npm existe avec une archive différente ; publication et mise à jour arrêtées');
  }
}
