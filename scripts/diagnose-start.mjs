import { Manager, startupUrl } from '../runtime/manager.mjs';
import fs from 'node:fs/promises';
const m = new Manager();
const pending = m.launch({id:process.argv[2]}, `${m.root}/diagnostic-home`,true).catch(e=>({error:e.message}));
await new Promise(r=>setTimeout(r,5000));
const run=JSON.parse(await fs.readFile(m.file('smoke-run.json'),'utf8'));
const log=await fs.readFile(`${m.root}/slots/${process.argv[2]}/smoke.log`,'utf8');
const url=startupUrl(log,new URL(run.url).port);
console.log(JSON.stringify({owned:await m.owned(run),announced:!!url}));
if(url){const r=await fetch(url,{redirect:'manual'});console.log(JSON.stringify({status:r.status,headers:[...r.headers.keys()],body:(await r.text()).slice(0,500)}));}
await m.stopRun(run);
console.log(await pending);
