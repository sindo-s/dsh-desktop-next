import fs from 'node:fs/promises';
import path from 'node:path';
import {Manager,slotPath,atomicJson} from './manager.mjs';
if(process.env.WSL_DISTRO_NAME!=='DSH-Offline-Builder'||process.getuid()!==0)throw Error('Only the dedicated fresh image builder may be sealed');
const root='/home/dsh/.local/share/dsh-next',manager=new Manager(root);
await manager.stop();await manager.stopRun(JSON.parse(await fs.readFile(path.join(root,'smoke-run.json'),'utf8')));
const state=await manager.state();if(!state.active||state.previous)throw Error('Image must have exactly one fresh core');
const slot=slotPath(root,state.active.id);
const owner=await fs.stat('/home/dsh');
const slots=await fs.readdir(path.join(root,'slots'));if(slots.length!==1||slots[0]!==state.active.id)throw Error('Unexpected build slots');
for(const name of ['home','smoke-home']){
  const target=path.join(slot,name);if((await fs.lstat(target)).isSymbolicLink())throw Error('Refusing linked data directory');
  await fs.rm(target,{recursive:true});await fs.mkdir(target,{mode:0o700});await fs.chown(target,owner.uid,owner.gid);
}
for(const target of [path.join(slot,'smoke.log'),path.join(slot,'runtime.log'),...['run.json','smoke-run.json','job.json'].map(n=>path.join(root,n))])await fs.rm(target,{force:true});
for(const target of ['/root/.npm','/home/dsh/.npm']){try{const st=await fs.lstat(target);if(st.isSymbolicLink())throw Error('Linked cache');await fs.rm(target,{recursive:true});}catch(e){if(e.code!=='ENOENT')throw e;}}
for(const target of ['/root/.bash_history','/home/dsh/.bash_history'])await fs.rm(target,{force:true});
await atomicJson('/etc/dsh-offline-image.json',{format:'dsh-offline/v1',coreVersion:state.active.version,sealed:true});
console.log('CLEAN_IMAGE_SEALED');
