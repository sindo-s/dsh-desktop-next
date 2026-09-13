import fs from 'node:fs/promises';
import path from 'node:path';
const [repo,installer,version]=process.argv.slice(2);
if(!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(repo??''))throw Error('Expected GitHub owner/repo');
if(!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version??''))throw Error('Expected exact release version');
const signature=(await fs.readFile(`${installer}.sig`,'utf8')).trim();
const manifest={version,notes:'DSH Desktop Next signed update',pub_date:new Date().toISOString(),platforms:{'windows-x86_64':{signature,url:`https://github.com/${repo}/releases/download/v${version}/${encodeURIComponent(path.basename(installer))}`}}};
await fs.writeFile(path.join(path.dirname(installer),'latest.json'),JSON.stringify(manifest,null,2));
console.log('Release manifest generated locally; nothing uploaded.');
