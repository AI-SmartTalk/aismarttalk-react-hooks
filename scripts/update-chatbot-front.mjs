import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareVersions, stableVersion } from './local-release-policy.mjs';
import { packageName, registry } from './release-policy.mjs';

const sdk = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frontend = resolve(sdk, '../chatbot-front');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const output = (command, args) => execFileSync(command, args, { cwd: frontend, encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] }).trim();
const run = (command, args) => execFileSync(command, args, { cwd: frontend, stdio: 'inherit' });
const git = args => output('git', args);
const files = ['package.json', 'package-lock.json'];
const hashes = () => Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(join(frontend, file))).digest('hex')]));
let statePath, lockDir, locked = false;

async function update() {
  if (!existsSync(join(frontend, 'package.json'))) throw new Error('Le dépôt chatbot-front doit être adjacent au SDK');
  const version = process.env.RELEASE_VERSION || readJson(join(sdk, 'package.json')).version;
  stableVersion(version);
  const branch = git(['branch', '--show-current']);
  if (!branch) throw new Error('Sélectionner une branche frontend avant la mise à jour');
  const response = await fetch(`${registry}/${encodeURIComponent(packageName)}/${version}`, { signal: AbortSignal.timeout(15000) });
  if (response.status === 404) throw new Error(`SDK ${version} absent de npm : lancer make release dans le SDK avant la mise à jour frontend`);
  if (!response.ok) throw new Error(`Registre npm indisponible : HTTP ${response.status}`);
  const published = await response.json();
  if (published.name !== packageName || published.version !== version || !published.dist?.integrity) throw new Error('Manifeste npm inattendu');
  const installed = readJson(join(frontend, 'package-lock.json')).packages[`node_modules/${packageName}`]?.version;
  if (!installed || compareVersions(installed, version) > 0) throw new Error('Mise à jour refusée : version SDK frontend plus récente ou non verrouillée');
  if (process.env.RELEASE_DRY_RUN === '1') {
    console.log(`Plan sans mutation : SDK npm ${version} → npm install → tests/build frontend → commit/push sur ${branch}.`);
    return;
  }
  const gitDir = git(['rev-parse', '--absolute-git-dir']);
  lockDir = join(gitDir, 'aist-frontend-update.lock');
  try { mkdirSync(lockDir); locked = true; }
  catch { throw new Error('Une mise à jour frontend est déjà active'); }
  const stateDir = join(gitDir, 'aist-frontend-updates');
  mkdirSync(stateDir, { recursive: true });
  statePath = join(stateDir, `${createHash('sha256').update(branch).digest('hex')}-${version}.json`);
  let state = existsSync(statePath) ? readJson(statePath) : null;
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: frontend, encoding: 'utf8' }).trimEnd();
  for (const line of status.split('\n').filter(Boolean)) {
    if (!state || !files.includes(line.slice(3))) throw new Error(`Modification locale à conserver avant mise à jour frontend : ${line.slice(3)}`);
  }
  const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  const assertState = () => {
    if (git(['branch', '--show-current']) !== state.branch) throw new Error('La branche frontend a changé depuis la préparation');
    const actual = hashes();
    for (const file of files) if (actual[file] !== state.files[file]) throw new Error(`Fichier modifié depuis l'arrêt de la mise à jour frontend : ${file}`);
    const head = git(['rev-parse', 'HEAD']);
    if (head !== state.head && (git(['log', '-1', '--format=%s']) !== state.message || git(['rev-parse', 'HEAD^']) !== state.head)) {
      throw new Error('La branche frontend a changé depuis la préparation');
    }
  };
  const assertDependency = () => {
    const manifest = readJson(join(frontend, 'package.json'));
    const dependency = readJson(join(frontend, 'package-lock.json')).packages[`node_modules/${packageName}`];
    if (manifest.dependencies[packageName] !== version || dependency?.version !== version || dependency.integrity !== published.dist.integrity) {
      throw new Error('La dépendance frontend ne correspond pas à la version npm publiée');
    }
  };
  if (state) assertState();
  else {
    state = { branch, version, head: git(['rev-parse', 'HEAD']), files: hashes(), validated: false,
      message: `chore(deps): mettre à jour le SDK chat vers ${version}` };
    save();
  }
  if (!state.validated) {
    try { run('npm', ['install', '--save-exact', '--ignore-scripts', '--no-audit', '--no-fund', `${packageName}@${version}`]); }
    finally { state.files = hashes(); save(); }
    assertDependency();
    run('npm', ['ci']);
    run('npm', ['test', '--', '--runInBand']);
    run('node', ['--test', 'scripts/update-chat-hooks.test.mjs']);
    run('npx', ['tsc', '--noEmit']);
    for (const entry of ['embedIndex', 'index']) run('npx', ['webpack', '--env', 'chatModelId=universal', '--env',
      `entryPoint=./src/client/${entry}.tsx`, '--env', `outputFileName=${entry === 'embedIndex' ? 'chatbot-embed-universal.js' : 'chatbot-universal.js'}`, '--mode', 'production']);
    assertState();
    state.validated = true; save();
  }
  assertDependency();
  if (git(['diff', '--name-only', 'HEAD', '--', ...files])) {
    run('git', ['add', '--', ...files]);
    run('git', ['commit', '--no-verify', '-m', state.message]);
  }
  state.head = git(['rev-parse', 'HEAD']); save();
  run('git', ['push', '--no-verify', '--set-upstream', 'origin', branch]);
  rmSync(statePath);
  console.log(`Frontend mis à jour vers SDK ${version} et poussé sur ${branch}.`);
}

try { await update(); }
catch (error) {
  console.error(error.message);
  if (statePath && existsSync(statePath)) console.error('Relancer make update-chatbot-front sur la même branche pour reprendre, sans modifier les fichiers préparés.');
  process.exitCode = 1;
} finally { if (locked) rmSync(lockDir, { recursive: true, force: true }); }
