import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, existsSync, realpathSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scripts = fileURLToPath(new URL('.', import.meta.url));
const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();

// Real isolated Git repositories, simulated npm/CLI/registry: no external write.
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'aist-release-')));
  const sdk = join(root, 'aismarttalk-react-hooks'), front = join(root, 'chatbot-front');
  const bin = join(root, 'bin'); mkdirSync(bin);
  const git = (cwd, ...args) => execFileSync(realGit, args, { cwd, stdio: 'pipe' });
  for (const [name, cwd] of [['sdk', sdk], ['front', front]]) {
    mkdirSync(join(cwd, 'scripts'), { recursive: true });
    writeFileSync(join(cwd, 'package.json'), JSON.stringify(name === 'sdk'
      ? { name: '@aismarttalk/react-hooks', version: '1.6.2' }
      : { dependencies: { '@aismarttalk/react-hooks': '1.5.17' } }));
    writeFileSync(join(cwd, 'package-lock.json'), JSON.stringify({ version: '1.6.2', packages: {
      'node_modules/@aismarttalk/react-hooks': { version: '1.5.17' } } }));
    if (name === 'sdk') for (const file of ['local-release.mjs', 'local-release-policy.mjs', 'release-policy.mjs', 'update-chatbot-front.mjs']) {
      copyFileSync(join(scripts, file), join(cwd, 'scripts', file));
    }
    writeFileSync(join(cwd, '.gitignore'), 'node_modules/\n');
    git(cwd, 'init', '-b', 'main'); git(cwd, 'config', 'user.email', 'test@example.com');
    git(cwd, 'config', 'user.name', 'Release test');
    git(cwd, 'add', '.'); git(cwd, 'commit', '-m', 'initial');
    const origin = join(root, `${name}.git`);
    execFileSync(realGit, ['init', '--bare', origin], { stdio: 'pipe' });
    git(cwd, 'remote', 'add', 'origin', origin); git(cwd, 'push', '-u', 'origin', 'main');
  }
  const registryFile = join(root, 'registry.json'), log = join(root, 'commands.jsonl');
  writeFileSync(registryFile, '{}');
  const loader = join(root, 'registry.mjs');
  writeFileSync(loader, `import {readFileSync} from 'node:fs';
globalThis.fetch = async url => {
 const version = String(url).split('/').at(-1);
 const data = JSON.parse(readFileSync(process.env.TEST_REGISTRY, 'utf8'));
 const value = version === 'latest' ? {name:'@aismarttalk/react-hooks',version:'1.5.17'} : data[version];
 return {ok:!!value,status:value?200:404,json:async()=>value};
};`);
  const fake = `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const command=path.basename(process.argv[1]),args=process.argv.slice(2),cwd=process.cwd();
fs.appendFileSync(process.env.TEST_LOG,JSON.stringify({command,args,cwd})+'\\n');
if(command==='git') {
 if(args[0]==='push' && cwd.endsWith('chatbot-front') && process.env.TEST_FAIL_STAGE==='frontend' && fs.existsSync(process.env.TEST_FAIL)) {
  fs.unlinkSync(process.env.TEST_FAIL); process.exit(1);
 }
 const result=cp.spawnSync(process.env.TEST_GIT,args,{stdio:'inherit'});process.exit(result.status??1);
}
if(command==='npm') {
 const manifest=path.join(cwd,'package.json'),lock=path.join(cwd,'package-lock.json');
 const pkg=JSON.parse(fs.readFileSync(manifest)),locked=JSON.parse(fs.readFileSync(lock));
 if(args[0]==='version') {pkg.version=args[1];locked.version=args[1];fs.writeFileSync(manifest,JSON.stringify(pkg));fs.writeFileSync(lock,JSON.stringify(locked));}
 if(args[0]==='pack') {const filename='candidate.tgz';fs.writeFileSync(path.join(args.at(-1),filename),'validated SDK archive '+pkg.version);console.log(JSON.stringify([{filename}]));}
 if(args[0]==='publish') {const version=pkg.version,data=JSON.parse(fs.readFileSync(process.env.TEST_REGISTRY));data[version]={name:pkg.name,version,dist:{integrity:'sha512-'+crypto.createHash('sha512').update(fs.readFileSync(args[1])).digest('base64')}};fs.writeFileSync(process.env.TEST_REGISTRY,JSON.stringify(data));}
 if(args[0]==='install') {
  const target=args.at(-1),fromArchive=target.endsWith('.tgz'),version=fromArchive?fs.readFileSync(target,'utf8').split(' ').at(-1):target.split('@').at(-1);
  const integrity=fromArchive?'sha512-'+crypto.createHash('sha512').update(fs.readFileSync(target)).digest('base64'):JSON.parse(fs.readFileSync(process.env.TEST_REGISTRY))[version].dist.integrity;
  pkg.dependencies['@aismarttalk/react-hooks']=fromArchive?'file:'+target:version;
  locked.packages['node_modules/@aismarttalk/react-hooks']={version,integrity};
  fs.writeFileSync(manifest,JSON.stringify(pkg));fs.writeFileSync(lock,JSON.stringify(locked));
 }
}
if(command==='gh' && args[0]==='release' && args[1]==='create' && process.env.TEST_FAIL_STAGE==='github' && fs.existsSync(process.env.TEST_FAIL)) {fs.unlinkSync(process.env.TEST_FAIL);process.exit(1);}
if(command==='npx' && args[0]==='tsc' && process.env.TEST_FAIL_STAGE==='validation' && fs.existsSync(process.env.TEST_FAIL)) {fs.unlinkSync(process.env.TEST_FAIL);process.exit(1);}
if(command==='gh' && args[0]==='release' && args[1]==='view') {console.error('release not found');process.exit(1);}
`;
  for (const command of ['git', 'npm', 'npx', 'gh']) writeFileSync(join(bin, command), fake, { mode: 0o755 });
  const nodeScript = join(front, 'scripts/update-chat-hooks.test.mjs'); writeFileSync(nodeScript, '');
  // The orchestration also invokes node --test against the frontend helper.
  git(front, 'add', '.'); git(front, 'commit', '-m', 'test helper'); git(front, 'push');
  const fail = join(root, 'fail-once');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, NODE_OPTIONS: `--import=${loader}`,
    TEST_GIT: realGit, TEST_LOG: log, TEST_FAIL: fail, TEST_REGISTRY: registryFile,
    TEST_FAIL_STAGE: 'github', RELEASE_VERSION: '', RELEASE_BUMP: 'patch', RELEASE_DRY_RUN: '0' };
  return { root, sdk, front, git, fail, registryFile, runUpdate: overrides => spawnSync(process.execPath,
    [join(sdk, 'scripts/update-chatbot-front.mjs')], { cwd: sdk, env: { ...env, ...overrides }, encoding: 'utf8' }), run: overrides => spawnSync(process.execPath,
    [join(sdk, 'scripts/local-release.mjs')], { cwd: sdk, env: { ...env, ...overrides }, encoding: 'utf8' }),
    commands: () => readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse),
    cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const manifest = f => JSON.parse(readFileSync(join(f.front, 'package.json')));
const publications = f => f.commands().filter(c => c.command === 'npm' && c.args[0] === 'publish').length;
const statePath = f => join(f.sdk, '.git/aist-local-release/state.json');
const success = result => assert.equal(result.status, 0, result.stderr + result.stdout);

function advanceSdk(f) {
  for (const file of ['package.json', 'package-lock.json']) {
    const path = join(f.sdk, file), value = JSON.parse(readFileSync(path));
    value.version = '1.6.3'; writeFileSync(path, JSON.stringify(value));
  }
  f.git(f.sdk, 'add', '.'); f.git(f.sdk, 'commit', '-m', 'advance SDK'); f.git(f.sdk, 'push');
}

test('SDK release publishes the tested archive without inspecting or updating frontend', () => {
  const f = fixture();
  try {
    f.git(f.front, 'switch', '-c', 'fix/widget');
    writeFileSync(join(f.front, 'local-work.txt'), 'preserve');
    success(f.run());
    assert.equal(manifest(f).dependencies['@aismarttalk/react-hooks'], '1.5.17');
    assert.equal(publications(f), 1);
    assert.ok(f.commands().every(c => c.cwd !== f.front));
    const commands = f.commands(), publish = commands.findIndex(c => c.command === 'npm' && c.args[0] === 'publish');
    assert.ok(commands.slice(0, publish).some(c => c.command === 'npm' && c.args[0] === 'run' && c.args[1] === 'build'));
    assert.ok(commands.some(c => c.command === 'git' && c.args.includes('--atomic')));
    assert.equal(existsSync(statePath(f)), false);
    assert.equal(readFileSync(join(f.front, 'local-work.txt'), 'utf8'), 'preserve');
  } finally { f.cleanup(); }
});

test('SDK release works without an adjacent frontend repository', () => {
  const f = fixture();
  try { rmSync(f.front, { recursive: true }); success(f.run()); }
  finally { f.cleanup(); }
});

test('GitHub release failure resumes without publishing npm twice', () => {
  const f = fixture();
  try {
    writeFileSync(f.fail, ''); assert.equal(f.run().status, 1);
    assert.ok(existsSync(statePath(f))); success(f.run()); assert.equal(publications(f), 1);
  } finally { f.cleanup(); }
});

test('resume rejects manual SDK changes without publishing again', () => {
  const f = fixture();
  try {
    writeFileSync(f.fail, ''); assert.equal(f.run().status, 1);
    writeFileSync(join(f.sdk, 'package.json'), readFileSync(join(f.sdk, 'package.json'), 'utf8') + '\n');
    const result = f.run(); assert.equal(result.status, 1); assert.match(result.stderr, /Fichier modifié/);
    assert.equal(publications(f), 1);
  } finally { f.cleanup(); }
});

test('SDK dry-run performs no npm, authentication, commit or push operation', () => {
  const f = fixture();
  try {
    const result = f.run({ RELEASE_DRY_RUN: '1' }); success(result); assert.match(result.stdout, /SDK 1.6.2/);
    assert.deepEqual(f.commands().map(c => [c.command, ...c.args]), [['git', 'rev-parse', '--absolute-git-dir']]);
  } finally { f.cleanup(); }
});

test('SDK release refuses a feature branch before authentication or publication', () => {
  const f = fixture();
  try {
    f.git(f.sdk, 'checkout', '-b', 'feature');
    const result = f.run(); assert.equal(result.status, 1); assert.match(result.stderr, /depuis main/);
    assert.ok(f.commands().every(c => c.command === 'git'));
  } finally { f.cleanup(); }
});

test('resume rejects an archive modified after validation', () => {
  const f = fixture();
  try {
    writeFileSync(f.fail, ''); assert.equal(f.run().status, 1);
    writeFileSync(JSON.parse(readFileSync(statePath(f))).archive, 'different SDK');
    const result = f.run(); assert.equal(result.status, 1); assert.match(result.stderr, /Archive candidate modifiée/);
    assert.equal(publications(f), 1);
  } finally { f.cleanup(); }
});

test('a newer committed SDK archives stale state despite frontend branch or local edits', () => {
  const f = fixture();
  try {
    writeFileSync(f.fail, ''); assert.equal(f.run().status, 1);
    const oldState = readFileSync(statePath(f), 'utf8'); advanceSdk(f);
    f.git(f.front, 'switch', '-c', 'fix/widget'); writeFileSync(join(f.front, 'local.txt'), 'preserve');
    const result = f.run(); success(result); assert.match(result.stdout, /Ancienne release 1.6.2/);
    const backups = readdirSync(join(f.sdk, '.git')).filter(name => name.startsWith('aist-local-release.backup-'));
    assert.equal(backups.length, 1);
    assert.equal(readFileSync(join(f.sdk, '.git', backups[0], 'state.json'), 'utf8'), oldState);
    assert.ok(existsSync(join(f.sdk, '.git', backups[0], 'candidate.tgz')));
    assert.equal(publications(f), 2); assert.equal(existsSync(statePath(f)), false);
    assert.equal(manifest(f).dependencies['@aismarttalk/react-hooks'], '1.5.17');
  } finally { f.cleanup(); }
});

test('stale SDK dry-run plans the current version without archiving state', () => {
  const f = fixture();
  try {
    writeFileSync(f.fail, ''); assert.equal(f.run().status, 1); advanceSdk(f);
    const count = f.commands().length, result = f.run({ RELEASE_DRY_RUN: '1' }); success(result);
    assert.match(result.stdout, /SDK 1.6.3/); assert.ok(existsSync(statePath(f)));
    assert.equal(readdirSync(join(f.sdk, '.git')).filter(name => name.startsWith('aist-local-release.backup-')).length, 0);
    assert.ok(f.commands().slice(count).every(c => c.command === 'git' && !['push', 'commit'].includes(c.args[0])));
  } finally { f.cleanup(); }
});

test('a newer SDK cannot retire stale state with local SDK edits', () => {
  const f = fixture();
  try {
    writeFileSync(f.fail, ''); assert.equal(f.run().status, 1); advanceSdk(f);
    const path = join(f.sdk, 'package.json'); writeFileSync(path, readFileSync(path, 'utf8') + '\n');
    const result = f.run(); assert.equal(result.status, 1); assert.match(result.stderr, /Modification locale/);
    assert.ok(existsSync(statePath(f))); assert.equal(publications(f), 1);
  } finally { f.cleanup(); }
});

test('legacy combined state resumes only SDK and preserves frontend backups', () => {
  const f = fixture();
  try {
    writeFileSync(f.fail, ''); assert.equal(f.run().status, 1);
    const state = JSON.parse(readFileSync(statePath(f))); delete state.workflow;
    state.phase = 'frontend'; state.heads.frontend = 'old-head'; state.files.frontend = { 'package.json': 'old-hash' };
    writeFileSync(statePath(f), JSON.stringify(state));
    writeFileSync(join(f.sdk, '.git/aist-local-release/frontend-package.json'), 'original frontend backup');
    f.git(f.front, 'switch', '-c', 'fix/widget'); writeFileSync(join(f.front, 'local.txt'), 'preserve');
    const count = f.commands().length; success(f.run()); assert.equal(publications(f), 1);
    assert.ok(f.commands().slice(count).every(c => c.cwd !== f.front));
    const backup = readdirSync(join(f.sdk, '.git')).find(name => name.startsWith('aist-local-release.backup-'));
    assert.equal(readFileSync(join(f.sdk, '.git', backup, 'frontend-package.json'), 'utf8'), 'original frontend backup');
  } finally { f.cleanup(); }
});

test('frontend update installs the published version and pushes its current feature branch', () => {
  const f = fixture();
  try {
    success(f.run()); f.git(f.front, 'switch', '-c', 'fix/widget');
    const count = f.commands().length; success(f.runUpdate());
    assert.equal(manifest(f).dependencies['@aismarttalk/react-hooks'], '1.6.2');
    assert.equal(f.git(f.front, 'branch', '--show-current').toString().trim(), 'fix/widget');
    assert.equal(f.git(f.front, 'rev-parse', 'HEAD').toString(), f.git(f.front, 'rev-parse', 'origin/fix/widget').toString());
    const commands = f.commands().slice(count);
    assert.ok(commands.every(c => c.cwd === f.front));
    assert.ok(commands.some(c => c.command === 'npm' && c.args.at(-1) === '@aismarttalk/react-hooks@1.6.2'));
    assert.equal(commands.filter(c => c.command === 'npx' && c.args[0] === 'webpack').length, 2);
    assert.ok(!commands.some(c => c.command === 'git' && c.args[0] === 'push' && c.args.includes('main')));
    assert.equal(publications(f), 1);
  } finally { f.cleanup(); }
});

test('frontend update refuses a version not yet published without installing or pushing', () => {
  const f = fixture();
  try {
    const result = f.runUpdate(); assert.equal(result.status, 1); assert.match(result.stderr, /absent de npm/);
    assert.ok(f.commands().every(c => c.command === 'git'));
  } finally { f.cleanup(); }
});

test('frontend update preserves local edits before installation', () => {
  const f = fixture();
  try {
    success(f.run()); writeFileSync(join(f.front, 'package.json'), JSON.stringify({ ...manifest(f), custom: 'keep' }));
    const count = f.commands().length, result = f.runUpdate();
    assert.equal(result.status, 1); assert.match(result.stderr, /Modification locale/);
    assert.equal(manifest(f).custom, 'keep'); assert.ok(f.commands().slice(count).every(c => c.command === 'git'));
  } finally { f.cleanup(); }
});

test('frontend push failure resumes without reinstalling or creating another commit', () => {
  const f = fixture();
  try {
    success(f.run()); f.git(f.front, 'switch', '-c', 'fix/widget'); writeFileSync(f.fail, '');
    assert.equal(f.runUpdate({ TEST_FAIL_STAGE: 'frontend' }).status, 1);
    const head = f.git(f.front, 'rev-parse', 'HEAD').toString(), count = f.commands().length;
    success(f.runUpdate()); assert.equal(f.git(f.front, 'rev-parse', 'HEAD').toString(), head);
    assert.ok(f.commands().slice(count).every(c => c.command === 'git'));
    assert.equal(f.git(f.front, 'status', '--porcelain').toString(), '');
  } finally { f.cleanup(); }
});

test('frontend validation failure stops before commit/push and can resume', () => {
  const f = fixture();
  try {
    success(f.run()); f.git(f.front, 'switch', '-c', 'fix/widget'); writeFileSync(f.fail, '');
    const count = f.commands().length;
    assert.equal(f.runUpdate({ TEST_FAIL_STAGE: 'validation' }).status, 1);
    assert.ok(!f.commands().slice(count).some(c => c.command === 'git' && ['commit', 'push'].includes(c.args[0])));
    success(f.runUpdate());
  } finally { f.cleanup(); }
});

test('frontend dry-run never installs, commits or pushes', () => {
  const f = fixture();
  try {
    success(f.run()); f.git(f.front, 'switch', '-c', 'fix/widget');
    const count = f.commands().length, result = f.runUpdate({ RELEASE_DRY_RUN: '1' }); success(result);
    assert.match(result.stdout, /fix\/widget/); assert.ok(f.commands().slice(count).every(c => c.command === 'git'));
    assert.equal(manifest(f).dependencies['@aismarttalk/react-hooks'], '1.5.17');
  } finally { f.cleanup(); }
});

test('frontend update refuses a downgrade before installation', () => {
  const f = fixture();
  try {
    success(f.run());
    const path = join(f.front, 'package-lock.json'), lock = JSON.parse(readFileSync(path));
    lock.packages['node_modules/@aismarttalk/react-hooks'].version = '1.7.0';
    writeFileSync(path, JSON.stringify(lock));
    const count = f.commands().length, result = f.runUpdate();
    assert.equal(result.status, 1); assert.match(result.stderr, /plus récente/);
    assert.ok(f.commands().slice(count).every(c => c.command === 'git'));
  } finally { f.cleanup(); }
});

test('frontend resume rejects manual changes to prepared files', () => {
  const f = fixture();
  try {
    success(f.run()); writeFileSync(f.fail, '');
    assert.equal(f.runUpdate({ TEST_FAIL_STAGE: 'frontend' }).status, 1);
    const path = join(f.front, 'package.json'); writeFileSync(path, readFileSync(path, 'utf8') + '\n');
    const count = f.commands().length, result = f.runUpdate();
    assert.equal(result.status, 1); assert.match(result.stderr, /Fichier modifié/);
    assert.ok(f.commands().slice(count).every(c => c.command === 'git'));
  } finally { f.cleanup(); }
});

test('frontend resume checks npm integrity again before retrying a push', () => {
  const f = fixture();
  try {
    success(f.run()); writeFileSync(f.fail, '');
    assert.equal(f.runUpdate({ TEST_FAIL_STAGE: 'frontend' }).status, 1);
    const registry = JSON.parse(readFileSync(f.registryFile)); registry['1.6.2'].dist.integrity = 'sha512-different';
    writeFileSync(f.registryFile, JSON.stringify(registry));
    const count = f.commands().length, result = f.runUpdate();
    assert.equal(result.status, 1); assert.match(result.stderr, /ne correspond pas/);
    assert.ok(!f.commands().slice(count).some(c => c.command === 'git' && c.args[0] === 'push'));
  } finally { f.cleanup(); }
});
