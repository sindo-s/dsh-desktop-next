import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import net from 'node:net';

export const PACKAGE = '@deepseek-ai/dsh';
export async function copyHome(source, target, codeRoot) {
  const modules=path.join(source,'profiles','node_modules');
  const installed=path.join(codeRoot,'node_modules');
  await fs.cp(source,target,{recursive:true,dereference:true,errorOnExist:true,force:false,filter:async file=>{
    // Official fallback links must be recreated by the new core. Dereferencing
    // them produces real directories that the official boot loader rejects.
    const relative=path.relative(modules,file);
    if(relative && relative!=='..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) && (await fs.lstat(file)).isSymbolicLink()) {
      const destination=path.resolve(path.dirname(file),await fs.readlink(file));
      const inner=path.relative(installed,destination);
      if(inner && inner!=='..' && !inner.startsWith(`..${path.sep}`) && !path.isAbsolute(inner)) return false;
    }
    return true;
  }});
}
export function validateVersion(value) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)) throw Error('Invalid exact package version');
  return value;
}
export function validatePlugin(value) {
  if (typeof value !== 'string' || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)?$/.test(value)) throw Error('Use an npm package name, optionally followed by an exact version');
  return value;
}
export function slotPath(root, id) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw Error('Invalid slot id');
  return path.join(root, 'slots', id);
}
export function startupUrl(log, port) {
  const matches = [...log.matchAll(/dsh web:\s+(http:\/\/[^\s]+)/g)];
  if (!matches.length) return null;
  const url = new URL(matches.at(-1)[1]);
  if (url.hostname !== '127.0.0.1' || url.port !== String(port) || url.username || url.password) throw Error('Unexpected core startup address');
  return url.href;
}
export async function healthCheck(url) {
  const options = { redirect: 'manual', signal: AbortSignal.timeout(1500) };
  const response = await fetch(url, options);
  if (response.ok) return true;
  if (![302,303].includes(response.status) || !response.headers.has('set-cookie')) return false;
  const location = new URL(response.headers.get('location') ?? '/', url);
  if (location.origin !== new URL(url).origin) return false;
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const authenticated = await fetch(location, { ...options, headers: { cookie }, signal: AbortSignal.timeout(1500) });
  return authenticated.ok;
}
export async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await fs.rename(temp, file);
}
async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
export async function command(bin, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: options.cwd, env: { ...process.env, ...options.env }, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '', timedOut = false;
    const append = b => { tail = (tail + b.toString()).slice(-16000); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    const kill = signal => { try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal); } catch {} };
    const timer = setTimeout(() => { timedOut = true; kill('SIGTERM'); }, options.timeout ?? 120000);
    const force = setTimeout(() => kill('SIGKILL'), (options.timeout ?? 120000) + 5000);
    child.on('error', e => { clearTimeout(timer); clearTimeout(force); reject(e); });
    child.on('close', code => {
      clearTimeout(timer); clearTimeout(force);
      if (code === 0 && !timedOut) resolve(tail.trim());
      else reject(Error(`${timedOut ? 'TIMEOUT' : 'COMMAND_FAILED'}: ${bin} (${code})\n${tail}`));
    });
  });
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
export class Manager {
  constructor(root = path.join(os.homedir(), '.local/share/dsh-next'), emit = () => {}) { this.root = root; this.emit = emit; }
  file(name) { return path.join(this.root, name); }
  async state() { return readJson(this.file('state.json'), { active: null, previous: null }); }
  async owned(run) {
    if (!run || !Number.isInteger(run.pid) || run.pid < 2 || !run.token) return false;
    try { return (await fs.readFile(`/proc/${run.pid}/environ`, 'utf8')).split('\0').includes(`DSH_NEXT_OWNER=${run.token}`); } catch { return false; }
  }
  async stopRun(run) {
    if (!await this.owned(run)) return;
    process.kill(-run.pid, 'SIGTERM');
    for (let i = 0; i < 50 && await this.owned(run); i++) await delay(100);
    if (await this.owned(run)) process.kill(-run.pid, 'SIGKILL');
  }
  async stop() {
    const run = await readJson(this.file('run.json'), null);
    await this.stopRun(run); await atomicJson(this.file('run.json'), null);
  }
  async launch(slot, home, smoke = false) {
    const base = slotPath(this.root, slot.id);
    const cli = path.join(slotPath(this.root,slot.codeId ?? slot.id), 'node_modules/@deepseek-ai/dsh/lib/bin.js');
    const port = await freePort(), token = randomUUID();
    const log = path.join(base, smoke ? 'smoke.log' : 'runtime.log');
    const out = await fs.open(log, 'w', 0o600);
    await fs.mkdir(home, { recursive: true, mode: 0o700 });
    const child = spawn(process.execPath, [cli, 'web', '--host', '127.0.0.1', '--port', String(port), '--no-open'], {
      cwd: '/home/dsh/projects', detached: true,
      env: { ...process.env, DSH_HOME: home, DSH_NEXT_OWNER: token, NO_COLOR: '1' }, stdio: ['ignore', out.fd, out.fd]
    });
    let spawnError; child.once('error', e => { spawnError = e; }); child.unref(); await out.close();
    const run = { pid: child.pid, token, url: `http://127.0.0.1:${port}`, slot: slot.id };
    // Persist before probing, so an interrupted launch is recoverable.
    await atomicJson(this.file(smoke ? 'smoke-run.json' : 'run.json'), run);
    try {
      for (let i = 0; i < 90; i++) {
        if (spawnError) throw spawnError;
        if (i > 1 && !await this.owned(run)) throw Error(`Core exited. See ${log}`);
        const announced = startupUrl(await fs.readFile(log, 'utf8'), port);
        if (announced) {
          run.url = announced;
          try {
            if (await healthCheck(run.url) && await this.owned(run)) {
              await atomicJson(this.file(smoke ? 'smoke-run.json' : 'run.json'), run);
              return run;
            }
          } catch {}
        }
        await delay(500);
      }
      throw Error(`Core health check timed out. See ${log}`);
    } catch (e) { await this.stopRun(run); throw e; }
  }
  async start() {
    const state = await this.state(); if (!state.active) throw Error('Install an official core first');
    const previous = await readJson(this.file('run.json'), null);
    if (await this.owned(previous)) {
      if (previous.slot === state.active.id) return previous;
      // An interrupted activation may have started a candidate without committing
      // the slot pointer. Never advertise that candidate as the active core.
      await this.stop();
    }
    return this.launch(state.active, path.join(slotPath(this.root, state.active.id), 'home'));
  }
  async status() {
    const run = await readJson(this.file('run.json'), null);
    const state = await this.state();
    const running = await this.owned(run) && run.slot === state.active?.id;
    return { ...state, running, url: running ? run.url : null, job: await readJson(this.file('job.json'), null) };
  }
  async check() {
    const raw = await command('npm', ['view', `${PACKAGE}@latest`, 'version', 'dist.integrity', '--json', '--registry=https://registry.npmjs.org']);
    const info = JSON.parse(raw);
    validateVersion(info.version);
    if (!/^sha512-[A-Za-z0-9+/]+=*$/.test(info['dist.integrity'])) throw Error('Missing package integrity');
    return { version: info.version, integrity: info['dist.integrity'] };
  }
  async phase(phase) { this.emit({ phase }); await atomicJson(this.file('job.json'), { status: 'running', phase, updatedAt: new Date().toISOString() }); }
  async prepareCandidate(version) {
    const raw = await command('npm', ['view', `${PACKAGE}@${version}`, 'dist.integrity', '--json', '--registry=https://registry.npmjs.org']);
    const expected = JSON.parse(raw);
    if (typeof expected !== 'string' || !expected.startsWith('sha512-')) throw Error('Missing registry integrity');
    const id = randomUUID(), base = slotPath(this.root, id), candidate = { id, version };
    await fs.mkdir(base, { recursive: true, mode: 0o700 });
    await this.phase('下载官方内核（固定版本）');
    await command('npm', ['install', '--prefix', base, '--save-exact', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org', `${PACKAGE}@${version}`], { timeout: 1200000 });
    const pkg = await readJson(path.join(base, 'node_modules/@deepseek-ai/dsh/package.json'));
    if (pkg.name !== PACKAGE || pkg.version !== version) throw Error('Installed package identity mismatch');
    const lock = await readJson(path.join(base, 'package-lock.json'));
    candidate.integrity = lock.packages['node_modules/@deepseek-ai/dsh'].integrity;
    if (candidate.integrity !== expected) throw Error('Installed integrity differs from checked registry artifact');
    await this.phase('验证沙箱与原版启动接口');
    await command('bwrap', ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--die-with-parent', '--', 'true']);
    await command(process.execPath, [path.join(base, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '--version']);
    const smoke = await this.launch(candidate, path.join(base, 'smoke-home'), true);
    await this.stopRun(smoke);
    return candidate;
  }
  async install(version) {
    validateVersion(version);
    const old = await this.state();
    if (old.active?.version === version) return this.status();
    const candidate = await this.prepareCandidate(version), base = slotPath(this.root, candidate.id);
    await this.phase('停止旧内核并复制数据快照');
    const wasRunning = await this.owned(await readJson(this.file('run.json'), null));
    await this.stop();
    try {
      if (old.active) await copyHome(path.join(slotPath(this.root,old.active.id),'home'),path.join(base,'home'),slotPath(this.root,old.active.codeId??old.active.id));
      await this.phase('验证数据兼容性并切换');
      const running = await this.launch(candidate, path.join(base, 'home'));
      await atomicJson(this.file('state.json'), { active: candidate, previous: old.active });
      return { ...await this.state(), running: true, url: running.url };
    } catch (e) {
      await this.stop();
      if (wasRunning && old.active) await this.start().catch(restart => { e.message += `\nOld core restart failed: ${restart.message}`; });
      throw e;
    }
  }
  async rollback() {
    const old = await this.state(); if (!old.previous) throw Error('No previous core snapshot');
    await this.stop();
    try {
      const run = await this.launch(old.previous, path.join(slotPath(this.root, old.previous.id), 'home'));
      await atomicJson(this.file('state.json'), { active: old.previous, previous: old.active });
      return { ...await this.state(), running: true, url: run.url };
    } catch (e) { await this.stop(); await this.start(); throw e; }
  }
  async plugin(action, value) {
    const state = await this.state(); if (!state.active) throw Error('Install a core first');
    const base = slotPath(this.root, state.active.id), home = path.join(base,'home');
    const cli = path.join(slotPath(this.root,state.active.codeId ?? state.active.id),'node_modules/@deepseek-ai/dsh/lib/bin.js');
    const args = ['plugin','--profile','web'];
    if (action === 'plugin-list') {
      return { listing: await command(process.execPath,[cli,...args,'list','--depth','0'],{env:{DSH_HOME:home}}) };
    }
    validatePlugin(value);
    if (!['plugin-add','plugin-remove'].includes(action)) throw Error('Unsupported plugin mutation');
    if(action==='plugin-remove' && value.includes('@',1)) throw Error('Remove requires a package name without version');
    const running = await this.owned(await readJson(this.file('run.json'),null));
    await this.stop();
    const snapshot = path.join(base,`plugin-backup-${randomUUID()}`);
    try {
      await this.phase('备份插件配置与数据');
      await copyHome(home,snapshot,slotPath(this.root,state.active.codeId??state.active.id));
    } catch(e) { if(running) await this.start(); throw e; }
    try {
      await this.phase('通过官方插件管理器安装');
      const listing = await command(process.execPath,[cli,...args,action==='plugin-add'?'add':'remove',value],{env:{DSH_HOME:home},timeout:600000});
      // Always validate installation, even if the core was stopped before.
      await this.start(); if(!running) await this.stop();
      return { listing, ...await this.status() };
    } catch(e) {
      await this.stop();
      await fs.rename(home,path.join(base,`plugin-failed-${randomUUID()}`));
      await fs.rename(snapshot,home);
      if(running) await this.start();
      throw e;
    }
  }
  async migrate(source) {
    if(!path.isAbsolute(source)) throw Error('Migration source must be absolute');
    const old=await this.state(); if(!old.active) throw Error('Install a core first');
    const manifest=await readJson(path.join(source,'manifest.json'));
    if(manifest?.format!=='dsh-session-copy/v1' || !Array.isArray(manifest.files) || manifest.files.length>50000) throw Error('Invalid migration manifest');
    // A staging copy is verified with the official persistence reader before any activation.
    for(const entry of manifest.files) {
      if(typeof entry.path!=='string' || !/^[A-Za-z0-9_.~/-]+$/.test(entry.path) || entry.path.split('/').some(p=>!p||p==='.'||p==='..') || !/^session\.jsonl(?:\.zstd)?$/.test(path.basename(entry.path))) throw Error('Unsafe session path');
      const file=path.join(source,'sessions',entry.path);
      if((await fs.lstat(file)).isSymbolicLink()) throw Error('Session links are not supported');
      if(createHash('sha256').update(await fs.readFile(file)).digest('hex')!==entry.sha256) throw Error('Session checksum changed');
    }
    await this.phase('使用官方读取器验证旧会话格式');
    const modules=path.join(slotPath(this.root,old.active.codeId??old.active.id),'node_modules');
    const validation=await command(process.execPath,['--input-type=module','-e',String.raw`
      import {pathToFileURL} from 'node:url';
      const base=process.argv[1];
      const {Context}=await import(pathToFileURL(base+'/@deepseek-ai/cordis/lib/index.js'));
      const {JsonlSessionPersistence}=await import(pathToFileURL(base+'/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js'));
      const {SessionStore}=await import(pathToFileURL(base+'/@deepseek-ai/dsh-session/lib/index.js'));
      const ctx=new Context();
      new SessionStore(ctx);
      const store=new JsonlSessionPersistence(ctx,{root:process.argv[2]});
      const rows=await store.list();
      for(const row of rows) { const loaded=await store.loadStored(row.id); if(!loaded) throw Error('Unreadable session'); }
      console.log(JSON.stringify({count:rows.length}));process.exit(0);
    `,modules,path.join(source,'sessions')],{timeout:120000});
    const count=JSON.parse(validation).count;
    if(count!==manifest.files.length) throw Error('Some sessions were not recognized by the official reader');
    const candidate={...old.active,id:randomUUID(),codeId:old.active.codeId??old.active.id};
    const base=slotPath(this.root,candidate.id),home=path.join(base,'home');
    const running=await this.owned(await readJson(this.file('run.json'),null));
    await this.stop();
    try {
      await copyHome(path.join(slotPath(this.root,old.active.id),'home'),home,slotPath(this.root,old.active.codeId??old.active.id));
      for(const entry of manifest.files) {
        const target=path.join(home,'sessions',entry.path),from=path.join(source,'sessions',entry.path);
        try {
          const existing=await fs.readFile(target);
          if(createHash('sha256').update(existing).digest('hex')!==entry.sha256) throw Error('A different session already exists at the import target');
        } catch(e) {
          if(e.code!=='ENOENT') throw e;
          await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});await fs.copyFile(from,target);
        }
      }
      await this.launch(candidate,home);
      await atomicJson(this.file('state.json'),{active:candidate,previous:old.active});
      await atomicJson(path.join(base,'migration.json'),{count,createdAt:new Date().toISOString(),source:'legacy-desktop'});
      return {...await this.status(),imported:count};
    } catch(e) {await this.stop();if(running)await this.start();throw e;}
  }
  async storage(clean=false) {
    const state=await this.state(),protectedIds=new Set();
    for(const slot of [state.active,state.previous])if(slot){protectedIds.add(slot.id);protectedIds.add(slot.codeId??slot.id);}
    for(const file of ['run.json','smoke-run.json']){const run=await readJson(this.file(file),null);if(await this.owned(run))protectedIds.add(run.slot);}
    async function bytes(dir){let total=0;for(const entry of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);const s=await fs.lstat(p);if(s.isSymbolicLink())continue;total+=s.isDirectory()?await bytes(p):s.size;}return total;}
    const slots=this.file('slots');await fs.mkdir(slots,{recursive:true});let reclaimable=0,total=0,removed=0;
    for(const id of await fs.readdir(slots)){
      if(!/^[0-9a-f-]{36}$/.test(id))continue;
      const dir=slotPath(this.root,id);if((await fs.lstat(dir)).isSymbolicLink())throw Error('Refusing linked slot');
      const size=await bytes(dir);total+=size;
      if(!protectedIds.has(id)){reclaimable+=size;if(clean){await fs.rm(dir,{recursive:true});removed++;}}
    }
    return {totalBytes:total,reclaimableBytes:reclaimable,removedSlots:removed,protectedSlots:protectedIds.size};
  }
  async execute(action, version) {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    if (action === 'status') return this.status();
    // flock lives in the WSL caller; the file descriptor is released on crash.
    await this.stopRun(await readJson(this.file('smoke-run.json'), null));
    try {
      let result;
      if (action === 'check') result = await this.check();
      else if (action === 'install') result = await this.install(version);
      else if (action === 'start') result = await this.start();
      else if (action === 'stop') { await this.stop(); result = await this.status(); }
      else if (action === 'rollback') result = await this.rollback();
      else if (['plugin-list','plugin-add','plugin-remove'].includes(action)) result = await this.plugin(action,version);
      else if (action === 'migrate') result = await this.migrate(version);
      else if (action === 'storage' || action === 'cleanup') result = await this.storage(action==='cleanup');
      else throw Error('Unsupported action');
      await atomicJson(this.file('job.json'), { status: 'succeeded', phase: action, updatedAt: new Date().toISOString() });
      return result;
    } catch (e) { await atomicJson(this.file('job.json'), { status: 'failed', phase: action, message: e.message, updatedAt: new Date().toISOString() }); throw e; }
  }
}

if (process.argv[1] === '-') {
  const emit = value => console.log(JSON.stringify(value));
  new Manager(undefined, emit).execute(process.argv[2], process.argv[3])
    .then(data => emit({ result: data }))
    .catch(e => { emit({ error: e.message }); process.exitCode = 1; });
}
