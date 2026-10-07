import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertArtifact, assertWorkspace, compareVersions, nextVersion } from './local-release-policy.mjs';
import { packageName, registry } from './release-policy.mjs';

const sdk = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = (command, args, cwd = sdk) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] }).trim();
const run = (command, args, cwd = sdk) => execFileSync(command, args, { cwd, stdio: 'inherit' });
const git = (args, cwd = sdk) => output('git', args, cwd);
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const owned = ['package.json', 'package-lock.json', 'CHANGELOG.md'];
const gitDir = git(['rev-parse', '--absolute-git-dir']);
const stateDir = join(gitDir, 'aist-local-release');
const statePath = join(stateDir, 'state.json');
const lockDir = join(gitDir, 'aist-local-release.lock');
let state;

async function metadata(version = 'latest') {
  const response = await fetch(`${registry}/${encodeURIComponent(packageName)}/${version}`, { signal: AbortSignal.timeout(15000) });
  if (response.status === 404 && version !== 'latest') return null;
  if (!response.ok) throw new Error(`Registre npm indisponible : HTTP ${response.status}`);
  const value = await response.json();
  if (value.name !== packageName || (version !== 'latest' && value.version !== version)) throw new Error('Manifeste npm inattendu');
  return value;
}

function save() { writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 }); }
function workspace(cwd, paths = []) {
  assertWorkspace(git(['branch', '--show-current'], cwd), execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }).trimEnd(), paths);
}
function snapshot() {
  state.files.sdk = Object.fromEntries(owned.map(path => [path,
    existsSync(join(sdk, path)) ? createHash('sha256').update(readFileSync(join(sdk, path))).digest('hex') : null]));
  save();
}
function assertResume() {
  workspace(sdk, owned);
  for (const [path, expected] of Object.entries(state.files.sdk)) {
    const actual = existsSync(join(sdk, path)) ? createHash('sha256').update(readFileSync(join(sdk, path))).digest('hex') : null;
    if (actual !== expected) throw new Error(`Fichier modifié depuis l'arrêt de la release : sdk/${path}`);
  }
  const head = git(['rev-parse', 'HEAD']);
  if (head !== state.heads.sdk && (git(['log', '-1', '--format=%s']) !== state.commitMessages.sdk
    || git(['rev-parse', 'HEAD^']) !== state.heads.sdk)) {
    throw new Error('La branche main du SDK a changé depuis la préparation ; résolution manuelle requise');
  }
}
function superseded(pending) {
  if (compareVersions(readJson(join(sdk, 'package.json')).version, pending.version) <= 0) return false;
  // Only retire an older release when committed work has advanced from it.
  try { git(['merge-base', '--is-ancestor', pending.heads.sdk, 'HEAD']); }
  catch { return false; }
  workspace(sdk);
  return true;
}
function mutation(action) { try { action(); } finally { snapshot(); } }
function commit(cwd, files, message) {
  if (!git(['diff', '--name-only', 'HEAD', '--', ...files], cwd)) return;
  run('git', ['add', '--', ...files], cwd);
  run('git', ['commit', '--no-verify', '-m', message], cwd);
}

async function release() {
  const latest = await metadata();
  const pending = existsSync(statePath) ? readJson(statePath) : null;
  const obsolete = pending && superseded(pending);
  if (process.env.RELEASE_DRY_RUN === '1') {
    const version = pending && !obsolete ? pending.version
      : nextVersion(readJson(join(sdk, 'package.json')).version, latest.version, process.env.RELEASE_BUMP || 'patch', process.env.RELEASE_VERSION || '');
    console.log(`Plan sans mutation : SDK ${version}.\nmain propre et à jour → tests/build SDK → archive candidate → commit/tag/push SDK → npm publish → release GitHub.\nEnsuite : make update-chatbot-front VERSION=${version} pour mettre à jour la branche frontend courante. Aucun publish/push exécuté par ce mode.`);
    return;
  }
  if (obsolete) {
    const archived = `${stateDir}.backup-${pending.version}-${Date.now()}`;
    renameSync(stateDir, archived);
    console.log(`Ancienne release ${pending.version} dépassée par la version locale ; état archivé dans ${archived}. Nouvelle release.`);
  }
  if (existsSync(statePath)) {
    state = readJson(statePath); assertResume();
    if (process.env.RELEASE_VERSION && process.env.RELEASE_VERSION !== state.version) throw new Error('Terminer la release en cours avant de changer VERSION');
    console.log(`Reprise de la release ${state.version}, phase ${state.phase}`);
  } else {
    workspace(sdk);
  }
  // Verify both authentication paths before modifying release files.
  try { output('npm', ['whoami', `--registry=${registry}/`]); }
  catch { throw new Error('Authentification npm manquante : lancer npm login puis relancer make release'); }
  run('gh', ['auth', 'status']);
  if (!state) {
    run('git', ['fetch', 'origin', 'main', '--tags']);
    run('git', ['pull', '--ff-only', 'origin', 'main']);
    workspace(sdk);
    if (git(['rev-parse', 'HEAD']) !== git(['rev-parse', 'origin/main'])) throw new Error('Les commits locaux doivent être poussés/revus avant la release');
    const current = readJson(join(sdk, 'package.json'));
    if (current.name !== packageName) throw new Error('Dépôt SDK inattendu');
    const published = await metadata();
    const version = nextVersion(current.version, published.version, process.env.RELEASE_BUMP || 'patch', process.env.RELEASE_VERSION || '');
    if (await metadata(version)) throw new Error(`La version ${version} est déjà publiée`);
    if (git(['tag', '--list', `v${version}`])) throw new Error(`Le tag v${version} existe déjà sans état de reprise local`);
    mkdirSync(stateDir, { recursive: true });
    state = { workflow: 'sdk-only', version, phase: 'preparation', prepared: false,
      heads: { sdk: git(['rev-parse', 'HEAD']) }, files: {},
      commitMessages: { sdk: `chore(release): publier SDK ${version}` } };
    snapshot();
  }
  if (!state.prepared) {
    mutation(() => run('npm', ['version', state.version, '--allow-same-version', '--no-git-tag-version', '--ignore-scripts']));
    run('npm', ['ci']);
    run('npm', ['test', '--', '--runInBand']);
    run('npm', ['run', 'test:release']);
    run('npm', ['run', 'tsc']);
    run('npm', ['run', 'build']);
    const changelog = join(sdk, 'CHANGELOG.md');
    if (!existsSync(changelog) || !readFileSync(changelog, 'utf8').includes(`## ${state.version} (`)) {
      let previous;
      try { previous = git(['describe', '--tags', '--abbrev=0']); } catch {}
      const notes = git(['log', '--no-merges', '--format=- %s', ...(previous ? [`${previous}..HEAD`] : ['-20'])]);
      const old = existsSync(changelog) ? readFileSync(changelog, 'utf8').replace(/^# Changelog\s*/, '') : '';
      mutation(() => writeFileSync(changelog, `# Changelog\n\n## ${state.version} (${new Date().toISOString().slice(0, 10)})\n\n${notes}\n\n${old}`));
    }
    const packed = JSON.parse(output('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', stateDir]));
    state.archive = join(stateDir, packed[0].filename);
    state.integrity = `sha512-${createHash('sha512').update(readFileSync(state.archive)).digest('base64')}`;
    save();
    state.prepared = true; state.phase = 'sdk'; save();
  }
  if (`sha512-${createHash('sha512').update(readFileSync(state.archive)).digest('base64')}` !== state.integrity) {
    throw new Error('Archive candidate modifiée depuis sa validation ; publication arrêtée');
  }
  // An interrupted commit/tag/push may safely be repeated; never force-push.
  commit(sdk, owned, state.commitMessages.sdk);
  state.heads.sdk = git(['rev-parse', 'HEAD']); save();
  const tag = `v${state.version}`;
  if (git(['tag', '--list', tag])) {
    if (git(['rev-parse', `${tag}^{commit}`]) !== state.heads.sdk) throw new Error('Le tag existant désigne un autre commit');
  } else run('git', ['tag', '-a', tag, '-m', `SDK ${state.version}`]);
  run('git', ['push', '--no-verify', '--atomic', 'origin', 'main', tag]);
  state.phase = 'npm'; save();
  let published = await metadata(state.version);
  if (!published) {
    run('npm', ['publish', state.archive, '--access', 'public', '--ignore-scripts', `--registry=${registry}/`]);
    for (let attempt = 0; attempt < 10; attempt++) {
      published = await metadata(state.version);
      if (published) break;
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    if (!published) throw new Error('Publication envoyée ; attendre sa visibilité npm puis relancer make release');
  }
  assertArtifact(published, state.version, state.integrity);
  state.phase = 'github'; save();
  let releaseExists = false;
  try { output('gh', ['release', 'view', tag, '--json', 'tagName']); releaseExists = true; }
  catch (error) { if (!/release not found|HTTP 404/i.test(String(error.stderr))) throw error; }
  if (!releaseExists) run('gh', ['release', 'create', tag, '--verify-tag', '--title', `SDK ${state.version}`, '--generate-notes']);
  console.log(`Release SDK ${state.version} publiée : npm, tag et release GitHub.\nFrontend : make update-chatbot-front VERSION=${state.version}`);
  // Preserve backups from the former combined workflow without touching the frontend.
  if (state.files.frontend) renameSync(stateDir, `${stateDir}.backup-${state.version}-${Date.now()}`);
  else rmSync(stateDir, { recursive: true });
}

try {
  try { mkdirSync(lockDir); } catch { throw new Error(`Une release est déjà active. Si le processus a été interrompu brutalement, vérifier qu'il est arrêté avant de retirer ${lockDir}`); }
  try { await release(); } finally { rmSync(lockDir, { recursive: true, force: true }); }
} catch (error) {
  console.error(error.message);
  if (existsSync(statePath)) console.error('État de reprise conservé dans .git/aist-local-release. Relancer make release après résolution, sans modifier les fichiers de release.');
  process.exitCode = 1;
}
