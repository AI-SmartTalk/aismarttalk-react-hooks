import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertArtifact, assertWorkspace, compareVersions, nextVersion } from './local-release-policy.mjs';
import { packageName, registry } from './release-policy.mjs';

const sdk = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frontend = resolve(sdk, '../chatbot-front');
const output = (command, args, cwd = sdk) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] }).trim();
const run = (command, args, cwd = sdk) => execFileSync(command, args, { cwd, stdio: 'inherit' });
const git = (args, cwd = sdk) => output('git', args, cwd);
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const owned = { sdk: ['package.json', 'package-lock.json', 'CHANGELOG.md'], frontend: ['package.json', 'package-lock.json'] };
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
  for (const [name, cwd] of [['sdk', sdk], ['frontend', frontend]]) {
    state.files[name] = Object.fromEntries(owned[name].map(path => [path,
      existsSync(join(cwd, path)) ? createHash('sha256').update(readFileSync(join(cwd, path))).digest('hex') : null]));
  }
  save();
}
function assertResume() {
  for (const [name, cwd] of [['sdk', sdk], ['frontend', frontend]]) {
    workspace(cwd, owned[name]);
    for (const [path, expected] of Object.entries(state.files[name])) {
      const actual = existsSync(join(cwd, path)) ? createHash('sha256').update(readFileSync(join(cwd, path))).digest('hex') : null;
      if (actual !== expected) throw new Error(`Fichier modifié depuis l'arrêt de la release : ${name}/${path}`);
    }
    const head = git(['rev-parse', 'HEAD'], cwd);
    if (head !== state.heads[name] && (git(['log', '-1', '--format=%s'], cwd) !== state.commitMessages[name]
      || git(['rev-parse', 'HEAD^'], cwd) !== state.heads[name])) {
      throw new Error(`La branche main de ${name} a changé depuis la préparation ; résolution manuelle requise`);
    }
  }
}
function mutation(action) { try { action(); } finally { snapshot(); } }
function validateFrontend() {
  run('npm', ['test', '--', '--runInBand'], frontend);
  run('node', ['--test', 'scripts/update-chat-hooks.test.mjs'], frontend);
  run('npx', ['tsc', '--noEmit'], frontend);
  for (const entry of ['embedIndex', 'index']) run('npx', ['webpack', '--env', 'chatModelId=universal', '--env',
    `entryPoint=./src/client/${entry}.tsx`, '--env', `outputFileName=${entry === 'embedIndex' ? 'chatbot-embed-universal.js' : 'chatbot-universal.js'}`, '--mode', 'production'], frontend);
}
function commit(cwd, files, message) {
  if (!git(['diff', '--name-only', 'HEAD', '--', ...files], cwd)) return;
  run('git', ['add', '--', ...files], cwd);
  run('git', ['commit', '--no-verify', '-m', message], cwd);
}

async function release() {
  if (!existsSync(join(frontend, 'package.json'))) throw new Error('Le dépôt chatbot-front doit être adjacent au SDK');
  const latest = await metadata();
  if (process.env.RELEASE_DRY_RUN === '1') {
    const version = existsSync(statePath) ? readJson(statePath).version
      : nextVersion(readJson(join(sdk, 'package.json')).version, latest.version, process.env.RELEASE_BUMP || 'patch', process.env.RELEASE_VERSION || '');
    console.log(`Plan sans mutation : SDK ${version}, frontend épinglé à ${version}.\nmain propres et à jour → tests/build SDK → test frontend avec l'archive candidate → commit/tag/push SDK → npm publish → dépendance npm frontend → tests/build frontend → commit/push frontend → release GitHub.\nUn push frontend sur main déclenche son déploiement existant. Aucun publish/push exécuté par ce mode.`);
    return;
  }
  if (existsSync(statePath)) {
    state = readJson(statePath); assertResume();
    if (process.env.RELEASE_VERSION && process.env.RELEASE_VERSION !== state.version) throw new Error('Terminer la release en cours avant de changer VERSION');
    console.log(`Reprise de la release ${state.version}, phase ${state.phase}`);
  } else {
    workspace(sdk); workspace(frontend);
  }
  // Verify both authentication paths before modifying release files.
  try { output('npm', ['whoami', `--registry=${registry}/`]); }
  catch { throw new Error('Authentification npm manquante : lancer npm login puis relancer make release'); }
  run('gh', ['auth', 'status']);
  if (!state) {
    for (const cwd of [sdk, frontend]) {
      run('git', ['fetch', 'origin', 'main', '--tags'], cwd);
      run('git', ['pull', '--ff-only', 'origin', 'main'], cwd);
      workspace(cwd);
      if (git(['rev-parse', 'HEAD'], cwd) !== git(['rev-parse', 'origin/main'], cwd)) throw new Error('Les commits locaux doivent être poussés/revus avant la release');
    }
    const current = readJson(join(sdk, 'package.json'));
    if (current.name !== packageName) throw new Error('Dépôt SDK inattendu');
    const published = await metadata();
    const version = nextVersion(current.version, published.version, process.env.RELEASE_BUMP || 'patch', process.env.RELEASE_VERSION || '');
    const frontVersion = readJson(join(frontend, 'package-lock.json')).packages[`node_modules/${packageName}`]?.version;
    if (!frontVersion || compareVersions(frontVersion, version) > 0) throw new Error('Le frontend utilise un SDK plus récent ou non verrouillé');
    if (await metadata(version)) throw new Error(`La version ${version} est déjà publiée`);
    if (git(['tag', '--list', `v${version}`])) throw new Error(`Le tag v${version} existe déjà sans état de reprise local`);
    mkdirSync(stateDir, { recursive: true });
    for (const path of owned.frontend) writeFileSync(join(stateDir, `frontend-${path}`), readFileSync(join(frontend, path)));
    state = { version, phase: 'preparation', prepared: false,
      heads: { sdk: git(['rev-parse', 'HEAD']), frontend: git(['rev-parse', 'HEAD'], frontend) }, files: {},
      commitMessages: { sdk: `chore(release): publier SDK ${version}`, frontend: `chore(deps): mettre à jour le SDK chat vers ${version}` } };
    snapshot();
  }
  if (!state.prepared) {
    // Restore only files still matching the recorded release-owned hashes.
    mutation(() => { for (const path of owned.frontend) writeFileSync(join(frontend, path), readFileSync(join(stateDir, `frontend-${path}`))); });
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
    mutation(() => run('npm', ['install', '--save-exact', '--ignore-scripts', '--no-audit', '--no-fund', state.archive], frontend));
    validateFrontend();
    mutation(() => { for (const path of owned.frontend) writeFileSync(join(frontend, path), readFileSync(join(stateDir, `frontend-${path}`))); });
    state.prepared = true; state.phase = 'sdk'; save();
  }
  if (`sha512-${createHash('sha512').update(readFileSync(state.archive)).digest('base64')}` !== state.integrity) {
    throw new Error('Archive candidate modifiée depuis sa validation ; publication arrêtée');
  }
  // An interrupted commit/tag/push may safely be repeated; never force-push.
  commit(sdk, owned.sdk, state.commitMessages.sdk);
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
  state.phase = 'frontend'; save();
  const dependency = readJson(join(frontend, 'package.json')).dependencies[packageName];
  const lockVersion = readJson(join(frontend, 'package-lock.json')).packages[`node_modules/${packageName}`]?.version;
  if (dependency !== state.version || lockVersion !== state.version) {
    mutation(() => run('npm', ['install', '--save-exact', '--ignore-scripts', '--no-audit', '--no-fund', `${packageName}@${state.version}`], frontend));
  }
  const locked = readJson(join(frontend, 'package-lock.json')).packages[`node_modules/${packageName}`];
  if (locked?.integrity !== state.integrity) throw new Error('Le lockfile frontend référence une archive SDK différente');
  validateFrontend();
  commit(frontend, owned.frontend, state.commitMessages.frontend);
  state.heads.frontend = git(['rev-parse', 'HEAD'], frontend); save();
  run('git', ['push', '--no-verify', 'origin', 'main'], frontend);
  state.phase = 'github'; save();
  let releaseExists = false;
  try { output('gh', ['release', 'view', tag, '--json', 'tagName']); releaseExists = true; }
  catch (error) { if (!/release not found|HTTP 404/i.test(String(error.stderr))) throw error; }
  if (!releaseExists) run('gh', ['release', 'create', tag, '--verify-tag', '--title', `SDK ${state.version}`, '--generate-notes']);
  console.log(`Release ${state.version} publiée ; SDK, tag, release GitHub et frontend poussés sur main.`);
  rmSync(stateDir, { recursive: true });
}

try {
  try { mkdirSync(lockDir); } catch { throw new Error(`Une release est déjà active. Si le processus a été interrompu brutalement, vérifier qu'il est arrêté avant de retirer ${lockDir}`); }
  try { await release(); } finally { rmSync(lockDir, { recursive: true, force: true }); }
} catch (error) {
  console.error(error.message);
  if (existsSync(statePath)) console.error('État de reprise conservé dans .git/aist-local-release. Relancer make release après résolution, sans modifier les fichiers de release.');
  process.exitCode = 1;
}
