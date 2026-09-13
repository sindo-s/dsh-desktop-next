import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { Manager, validateVersion, validatePlugin, slotPath, atomicJson, command, startupUrl, healthCheck } from '../runtime/manager.mjs';
import { createRegistry } from '../src/extensions.js';
const roots = [];
test.after(async () => { for (const root of roots) await fs.rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-next-test-')); roots.push(root);
  const manager = new Manager(root), active = { id: randomUUID(), version: '1.0.0' };
  await atomicJson(manager.file('state.json'), { active, previous: null });
  await fs.mkdir(path.join(slotPath(root, active.id), 'home'), { recursive: true });
  await fs.writeFile(path.join(slotPath(root, active.id), 'home', 'session.txt'), 'original');
  return { manager, active, root };
}
test('only exact npm versions accepted', () => {
  for (const version of ['1.2.3','0.1.2-rc.1']) assert.equal(validateVersion(version), version);
  for (const version of ['latest','^1.2.3','1.2.3; rm x','../../foo','https://a','--help',null]) assert.throws(() => validateVersion(version));
});
test('plugins accept registry package identities, not shell or file sources',()=>{
  for(const name of ['@scope/plugin','test-plugin@1.2.3']) assert.equal(validatePlugin(name),name);
  for(const name of ['file:/secret','https://host/code','--global','abc; touch /tmp/a','abc@latest']) assert.throws(()=>validatePlugin(name));
});
test('official bootstrap token is preserved and non-owned origins rejected', () => {
  assert.equal(startupUrl('dsh web: http://127.0.0.1:4321/?token=test',4321),'http://127.0.0.1:4321/?token=test');
  assert.throws(()=>startupUrl('dsh web: http://evil.test:4321/',4321));
  assert.throws(()=>startupUrl('dsh web: http://127.0.0.1:1234/',4321));
});
test('health probe follows official 303 cookie bootstrap without disabling auth', async()=>{
  const server=http.createServer((req,res)=>{
    if(req.url==='/?token=test'){res.writeHead(303,{'set-cookie':'session=test; HttpOnly','location':'/'});res.end();}
    else {res.writeHead(req.headers.cookie==='session=test'?200:401);res.end('app');}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try {
    const url=`http://127.0.0.1:${server.address().port}/`;
    assert.equal(await healthCheck(url),false);
    assert.equal(await healthCheck(`${url}?token=test`),true);
  } finally {await new Promise(r=>server.close(r));}
});
test('slot ids cannot escape managed directory', () => {
  assert.throws(() => slotPath('/tmp/test', '../../etc'));
  assert.equal(path.dirname(slotPath('/tmp/test', randomUUID())), path.join('/tmp/test', 'slots'));
});
test('atomic state writes preserve valid JSON', async () => {
  const { manager } = await fixture();
  await atomicJson(manager.file('test.json'), { value: '中文' });
  assert.deepEqual(JSON.parse(await fs.readFile(manager.file('test.json'))), { value: '中文' });
});
test('corrupt state fails closed', async () => {
  const { manager } = await fixture(); await fs.writeFile(manager.file('state.json'), '{bad');
  await assert.rejects(manager.state());
});
test('already installed version does not prepare or stop', async () => {
  const { manager } = await fixture();
  manager.prepareCandidate = () => assert.fail('unnecessary download');
  manager.stop = () => assert.fail('unnecessary stop');
  await manager.install('1.0.0');
});
test('prepare failure leaves active state and process untouched', async () => {
  const { manager, active } = await fixture();
  manager.prepareCandidate = async () => { throw Error('download failed'); };
  manager.stop = () => assert.fail('old process must stay running');
  await assert.rejects(manager.execute('install', '1.1.0'), /download failed/);
  assert.deepEqual((await manager.state()).active, active);
  assert.equal(JSON.parse(await fs.readFile(manager.file('job.json'))).status, 'failed');
});
test('failed candidate migration cannot modify original data', async () => {
  const { manager, active, root } = await fixture();
  const candidate = { id: randomUUID(), version: '1.1.0' };
  manager.prepareCandidate = async () => candidate;
  manager.stop = async () => {};
  manager.launch = async (_, home) => { await fs.writeFile(path.join(home, 'session.txt'), 'migrated'); throw Error('bad schema'); };
  await assert.rejects(manager.install('1.1.0'), /bad schema/);
  assert.deepEqual((await manager.state()).active, active);
  assert.equal(await fs.readFile(path.join(slotPath(root, active.id), 'home', 'session.txt'), 'utf8'), 'original');
});
test('successful update switches core and data together', async () => {
  const { manager, active } = await fixture(); const candidate = { id: randomUUID(), version: '1.1.0' };
  manager.prepareCandidate = async () => candidate; manager.stop = async () => {};
  manager.launch = async (_, home) => { assert.equal(await fs.readFile(path.join(home,'session.txt'),'utf8'),'original'); return { url: 'http://127.0.0.1:5000' }; };
  await manager.install('1.1.0'); assert.deepEqual(await manager.state(), { active: candidate, previous: active });
});
test('rollback failure leaves active pointer intact and restarts current', async () => {
  const { manager, active } = await fixture(); const previous = { id: randomUUID(), version: '0.9.0' };
  await atomicJson(manager.file('state.json'), { active, previous });
  let restarted = false; manager.stop = async () => {}; manager.start = async () => { restarted = true; };
  manager.launch = async () => { throw Error('old incompatible'); };
  await assert.rejects(manager.rollback(), /old incompatible/);
  assert.equal(restarted,true); assert.deepEqual((await manager.state()).active,active);
});
test('unowned process cannot be stopped', async () => {
  const { manager } = await fixture(); assert.equal(await manager.owned({ pid: process.pid, token: 'not-our-token' }), false);
  await manager.stopRun({ pid: process.pid, token: 'not-our-token' });
});
test('command output is bounded and failures propagate', async () => {
  assert.ok((await command(process.execPath, ['-e','process.stdout.write("x".repeat(100000))'])).length <= 16000);
  await assert.rejects(command(process.execPath,['-e','process.exit(7)']), /COMMAND_FAILED/);
});
test('command timeout terminates process', async () => {
  await assert.rejects(command(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:100}), /TIMEOUT/);
});
test('extension registry rejects duplicate and invalid pages', () => {
  const r=createRegistry(); r.register({ id:'home',render:()=>'' });
  assert.equal(r.list().length,1); assert.throws(()=>r.register({id:'home',render:()=>''}));
  assert.throws(()=>r.register({id:'../evil',render:()=>''}));
});
test('cleanup protects both data snapshots and referenced code slots',async()=>{
  const {manager,active,root}=await fixture();const code=randomUUID(),previous={id:randomUUID(),version:'0.9.0'},garbage=randomUUID();
  await atomicJson(manager.file('state.json'),{active:{...active,codeId:code},previous});
  for(const id of [code,previous.id,garbage]){await fs.mkdir(slotPath(root,id),{recursive:true});await fs.writeFile(path.join(slotPath(root,id),'test'),'test');}
  const result=await manager.storage(true);assert.equal(result.removedSlots,1);
  await assert.rejects(fs.stat(slotPath(root,garbage)),{code:'ENOENT'});
  for(const id of [active.id,code,previous.id])assert.ok((await fs.stat(slotPath(root,id))).isDirectory());
});
test('migration rejects traversal without touching active state',async()=>{
  const {manager,active,root}=await fixture();const source=path.join(root,'import');
  await atomicJson(path.join(source,'manifest.json'),{format:'dsh-session-copy/v1',files:[{path:'../../session.jsonl',sha256:'x'}]});
  await assert.rejects(manager.migrate(source),/Unsafe session path/);assert.deepEqual((await manager.state()).active,active);
});
