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
    if (name === 'sdk') for (const file of ['local-release.mjs', 'local-release-policy.mjs', 'release-policy.mjs']) {
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
 if(args[0]==='push' && cwd.endsWith('chatbot-front') && fs.existsSync(process.env.TEST_FAIL)) {
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
if(command==='gh' && args[0]==='release' && args[1]==='view') {console.error('release not found');process.exit(1);}
`;
  for (const command of ['git', 'npm', 'npx', 'gh']) writeFileSync(join(bin, command), fake, { mode: 0o755 });
  const nodeScript = join(front, 'scripts/update-chat-hooks.test.mjs'); writeFileSync(nodeScript, '');
  // The orchestration also invokes node --test against the frontend helper.
  git(front, 'add', '.'); git(front, 'commit', '-m', 'test helper'); git(front, 'push');
  const fail = join(root, 'fail-once');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, NODE_OPTIONS: `--import=${loader}`,
    TEST_GIT: realGit, TEST_LOG: log, TEST_FAIL: fail, TEST_REGISTRY: registryFile,
    RELEASE_VERSION: '', RELEASE_BUMP: 'patch', RELEASE_DRY_RUN: '0' };
  return { root, sdk, front, git, fail, run: overrides => spawnSync(process.execPath,
    [join(sdk, 'scripts/local-release.mjs')], { cwd: sdk, env: { ...env, ...overrides }, encoding: 'utf8' }),
    commands: () => readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse),
    cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('release publishes the tested archive, pins frontend and pushes both main branches', () => {
  const f = fixture();
  try {
    const result = f.run(); assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(JSON.parse(readFileSync(join(f.front, 'package.json'))).dependencies['@aismarttalk/react-hooks'], '1.6.2');
    assert.equal(f.commands().filter(c => c.command === 'npm' && c.args[0] === 'publish').length, 1);
    const commands = f.commands();
    const publish = commands.findIndex(c => c.command === 'npm' && c.args[0] === 'publish');
    assert.ok(commands.slice(0, publish).some(c => c.command === 'npx' && c.cwd === f.front && c.args[0] === 'webpack'));
    assert.ok(commands.some(c => c.command === 'git' && c.args.includes('--atomic')));
    assert.equal(existsSync(join(f.sdk, '.git/aist-local-release')), false);
    assert.equal(f.git(f.front, 'status', '--porcelain').toString(), '');
  } finally { f.cleanup(); }
});

test('frontend push failure resumes the same release without publishing npm twice', () => {
  const f = fixture();
  try {
    writeFileSync(f.fail, ''); const first = f.run(); assert.equal(first.status, 1);
    assert.ok(existsSync(join(f.sdk, '.git/aist-local-release/state.json')));
    const second = f.run(); assert.equal(second.status, 0, second.stderr + second.stdout);
    assert.equal(f.commands().filter(c => c.command === 'npm' && c.args[0] === 'publish').length, 1);
  } finally { f.cleanup(); }
});

test('resume rejects manual changes and leaves publication count unchanged', () => {
  const f = fixture();
  try {
    writeFileSync(f.fail, ''); assert.equal(f.run().status, 1);
    writeFileSync(join(f.front, 'package.json'), '{}');
    const second = f.run(); assert.equal(second.status, 1); assert.match(second.stderr, /Fichier modifié/);
    assert.equal(f.commands().filter(c => c.command === 'npm' && c.args[0] === 'publish').length, 1);
  } finally { f.cleanup(); }
});

test('dry-run performs no npm, authentication, commit or push operation', () => {
  const f = fixture();
  try {
    const result = f.run({ RELEASE_DRY_RUN: '1' }); assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /SDK 1.6.2/);
    assert.deepEqual(f.commands().map(c => [c.command, ...c.args]), [['git', 'rev-parse', '--absolute-git-dir']]);
  } finally { f.cleanup(); }
});

test('release refuses a feature branch before authentication or publication', () => {
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
    const state = JSON.parse(readFileSync(join(f.sdk, '.git/aist-local-release/state.json')));
    writeFileSync(state.archive, 'different SDK');
    const second = f.run(); assert.equal(second.status, 1); assert.match(second.stderr, /Archive candidate modifiée/);
    assert.equal(f.commands().filter(c => c.command === 'npm' && c.args[0] === 'publish').length, 1);
  } finally { f.cleanup(); }
});

function advanceSdk(f) {
  for (const file of ['package.json', 'package-lock.json']) {
    const path = join(f.sdk, file), value = JSON.parse(readFileSync(path));
    value.version = '1.6.3'; writeFileSync(path, JSON.stringify(value));
  }
  f.git(f.sdk, 'add', '.'); f.git(f.sdk, 'commit', '-m', 'advance SDK'); f.git(f.sdk, 'push');
  f.git(f.front, 'push');
}

test('a newer committed SDK archives stale state and completes a fresh release', () => {
  const f = fixture();
  try {
    writeFileSync(f.fail, ''); assert.equal(f.run().status, 1);
    const oldState = readFileSync(join(f.sdk, '.git/aist-local-release/state.json'), 'utf8');
    advanceSdk(f);
    const result = f.run(); assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /Ancienne release 1.6.2/);
    const backups = readdirSync(join(f.sdk, '.git')).filter(name => name.startsWith('aist-local-release.backup-'));
    assert.equal(backups.length, 1);
    assert.equal(readFileSync(join(f.sdk, '.git', backups[0], 'state.json'), 'utf8'), oldState);
    assert.ok(existsSync(join(f.sdk, '.git', backups[0], 'candidate.tgz')));
    assert.equal(JSON.parse(readFileSync(join(f.front, 'package.json'))).dependencies['@aismarttalk/react-hooks'], '1.6.3');
    assert.equal(f.commands().filter(c => c.command === 'npm' && c.args[0] === 'publish').length, 2);
    assert.equal(existsSync(join(f.sdk, '.git/aist-local-release')), false);
  } finally { f.cleanup(); }
});

test('stale release dry-run plans the current version without archiving state', () => {
  const f = fixture();
  try {
    writeFileSync(f.fail, ''); assert.equal(f.run().status, 1); advanceSdk(f);
    const count = f.commands().length;
    const result = f.run({ RELEASE_DRY_RUN: '1' }); assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /SDK 1.6.3/);
    assert.ok(existsSync(join(f.sdk, '.git/aist-local-release/state.json')));
    assert.equal(readdirSync(join(f.sdk, '.git')).filter(name => name.startsWith('aist-local-release.backup-')).length, 0);
    assert.ok(f.commands().slice(count).every(c => c.command === 'git' && !['push', 'commit'].includes(c.args[0])));
  } finally { f.cleanup(); }
});

test('a newer SDK cannot retire stale state while either workspace has local edits', () => {
  for (const repo of ['sdk', 'front']) {
    const f = fixture();
    try {
      writeFileSync(f.fail, ''); assert.equal(f.run().status, 1); advanceSdk(f);
      const path = join(f[repo], 'package.json'); writeFileSync(path, readFileSync(path, 'utf8') + '\n');
      const result = f.run(); assert.equal(result.status, 1); assert.match(result.stderr, /Modification locale/);
      assert.ok(existsSync(join(f.sdk, '.git/aist-local-release/state.json')));
      assert.equal(f.commands().filter(c => c.command === 'npm' && c.args[0] === 'publish').length, 1);
    } finally { f.cleanup(); }
  }
});
