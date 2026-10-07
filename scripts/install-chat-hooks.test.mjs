import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertLocalVersion, installChatHooks } from './install-chat-hooks.mjs';
test('rejects an older local SDK, including minor and major versions', () => {
 for (const [source, installed] of [['1.6.3','1.6.4'],['1.5.10','1.6.0'],['1.99.0','2.0.0']]) assert.throws(()=>assertLocalVersion(source,installed),/installation annulée/);
});
test('allows same-version rebuilds and newer local SDKs', () => {
 for (const [source, installed] of [['1.6.4','1.6.4'],['1.6.10','1.6.9'],['2.0.0','1.99.0']]) assert.doesNotThrow(()=>assertLocalVersion(source,installed));
});
test('blocks downgrade before invoking any command or writing vendor files', () => {
 const root=mkdtempSync(join(tmpdir(),'hooks-install-test-'));const sdk=join(root,'sdk'),frontend=join(root,'frontend');mkdirSync(sdk);mkdirSync(frontend);
 try {
  writeFileSync(join(sdk,'package.json'),JSON.stringify({name:'@aismarttalk/react-hooks',version:'1.6.3'}));
  writeFileSync(join(frontend,'package-lock.json'),JSON.stringify({packages:{'node_modules/@aismarttalk/react-hooks':{version:'1.6.4'}}}));
  let calls=0;assert.throws(()=>installChatHooks({sdk,frontend,run:()=>{calls++}}),/Changer le checkout/);
  assert.equal(calls,0);assert.equal(existsSync(join(frontend,'vendor')),false);
 } finally {rmSync(root,{recursive:true,force:true})}
});
