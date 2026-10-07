import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compareVersions } from './local-release-policy.mjs';
const name = '@aismarttalk/react-hooks';
const read = path => JSON.parse(readFileSync(path, 'utf8'));
export function assertLocalVersion(source, installed) {
  if (compareVersions(source, installed) < 0) {
    throw new Error(`SDK local ${source} plus ancien que celui du widget (${installed}). Changer le checkout SDK avant make install-chat-hooks ; installation annulée.`);
  }
}
export function installChatHooks({ sdk = resolve(dirname(fileURLToPath(import.meta.url)), '..'), frontend = resolve(sdk, '../chatbot-front'), run = execFileSync } = {}) {
  const manifest = read(join(sdk, 'package.json'));
  const current = read(join(frontend, 'package-lock.json')).packages?.[`node_modules/${name}`]?.version;
  if (manifest.name !== name || !current) throw new Error('SDK et version verrouillée du widget requis');
  // Fail before building, writing an archive or modifying the widget.
  assertLocalVersion(manifest.version, current);
  run('npm', ['run', 'build'], { cwd: sdk, stdio: 'inherit' });
  mkdirSync(join(frontend, 'vendor'), { recursive: true });
  const [artifact] = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', join(frontend, 'vendor')], { cwd: sdk, encoding: 'utf8' }));
  if (artifact.name !== name || artifact.version !== manifest.version || basename(artifact.filename) !== artifact.filename) throw new Error('Archive SDK inattendue');
  const spec = `file:vendor/${artifact.filename}`;
  // Named dependency + force resolves a rebuilt archive even at equal version.
  run('npm', ['install', '--save-exact', '--ignore-scripts', '--no-audit', '--no-fund', '--force', `${name}@${spec}`], { cwd: frontend, stdio: 'inherit' });
  const locked = read(join(frontend, 'package-lock.json')).packages[`node_modules/${name}`]?.version;
  const installed = read(join(frontend, 'node_modules', name, 'package.json')).version;
  if (locked !== manifest.version || installed !== manifest.version || read(join(frontend, 'package.json')).dependencies[name] !== spec) throw new Error('SDK installé, manifest et lockfile incohérents');
  console.log(`SDK ${installed} installé et vérifié dans le widget.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { installChatHooks(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
