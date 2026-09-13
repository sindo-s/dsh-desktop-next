import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const payload=path.resolve(process.argv[2]??'D:/deepseek/dsh-image-build/payload');
async function hash(file){const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}
const rootfs=path.join(payload,'rootfs.tar.gz'),msi=path.join(payload,'wsl.x64.msi');
// Tauri's resource mapper cannot reliably consume Windows drive-qualified keys.
// A local junction avoids duplicating the large payload onto the system disk.
const local=path.resolve('src-tauri/offline-payload');
try {await fs.symlink(payload,local,process.platform==='win32'?'junction':'dir');}
catch(e){if(e.code!=='EEXIST'||await fs.realpath(local)!==await fs.realpath(payload))throw e;}
const manifest={format:'dsh-offline/v1',rootfsSha256:await hash(rootfs),wslSha256:await hash(msi)};
await fs.writeFile(path.join(payload,'manifest.json'),JSON.stringify(manifest,null,2));
const config={bundle:{resources:{'offline-payload/rootfs.tar.gz':'offline/rootfs.tar.gz','offline-payload/wsl.x64.msi':'offline/wsl.x64.msi'},windows:{nsis:{compression:'zlib'},webviewInstallMode:{type:'offlineInstaller',silent:true}}}};
await fs.writeFile(path.join(payload,'tauri.offline.json'),JSON.stringify(config,null,2));
console.log(JSON.stringify({manifest:path.join(payload,'manifest.json'),config:path.join(payload,'tauri.offline.json')}));
