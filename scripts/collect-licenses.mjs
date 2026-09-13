import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const cargo=process.env.CARGO_HOME ? path.join(process.env.CARGO_HOME,'bin',process.platform==='win32'?'cargo.exe':'cargo') : 'cargo';
const metadata=JSON.parse(execFileSync(cargo,['metadata','--manifest-path','src-tauri/Cargo.toml','--locked','--offline','--filter-platform','x86_64-pc-windows-msvc','--format-version','1'],{encoding:'utf8',maxBuffer:32*1024*1024}));
const resolved=new Set(metadata.resolve.nodes.map(n=>n.id));
const sections=['# Third-party notices','Generated from Cargo.lock and crate license files. This inventory includes build/test dependencies. Each component retains its own license.'];
const missing=[];
const upstreamCache=new Map();
for(const p of metadata.packages.filter(p=>resolved.has(p.id)&&p.source).sort((a,b)=>a.name.localeCompare(b.name))){
  const dir=path.dirname(p.manifest_path);
  const files=fs.readdirSync(dir).filter(n=>/^(LICENSE|LICENCE|COPYING|NOTICE)(\.|-|_|$)/i.test(n)&&fs.statSync(path.join(dir,n)).isFile());
  if(p.license_file&&!files.includes(p.license_file))files.push(p.license_file);
  sections.push('## '+p.name+' '+p.version, 'License: '+(p.license??'See license file'), 'Source: https://crates.io/crates/'+p.name+'/'+p.version);
  if(!files.length){
    const vcs=JSON.parse(fs.readFileSync(path.join(dir,'.cargo_vcs_info.json'),'utf8'));
    const repo=p.repository?.replace(/\/$/,'').match(/^https:\/\/github.com\/([^/]+\/[^/]+)$/)?.[1];
    const key=repo+'@'+vcs.git.sha1;
    if(!upstreamCache.has(key)){
      if(!repo)throw Error('Unsupported upstream: '+p.name);
      const entries=JSON.parse(execFileSync('gh',['api','repos/'+repo+'/contents?ref='+vcs.git.sha1],{encoding:'utf8'})).filter(e=>e.type==='file'&&/^(LICENSE|LICENCE|COPYING|NOTICE)(\.|-|_|$)/i.test(e.name));
      const texts=[];
      for(const entry of entries){const response=await fetch(entry.download_url);if(!response.ok)throw Error('License download failed');texts.push('### '+entry.name+' (upstream '+key+')\n'+await response.text());}
      upstreamCache.set(key,texts);
    }
    const texts=upstreamCache.get(key);
    if(!texts.length&&p.license==='MPL-2.0'){
      const mpl=metadata.packages.find(x=>x.name==='cssparser'&&x.license==='MPL-2.0');
      sections.push('### Mozilla Public License 2.0',fs.readFileSync(path.join(path.dirname(mpl.manifest_path),'LICENSE'),'utf8'));
    }else if(!texts.length)missing.push(p.name+' '+p.version);else sections.push(...texts);
  }
  for(const f of files)sections.push('### '+f,fs.readFileSync(path.join(dir,f),'utf8'));
}
fs.mkdirSync('docs/generated',{recursive:true});
const mplPackages=metadata.packages.filter(p=>resolved.has(p.id)&&p.license==='MPL-2.0');
fs.writeFileSync('docs/generated/MPL-SOURCES.json',JSON.stringify(mplPackages.map(p=>({name:p.name,version:p.version,source:'https://crates.io/api/v1/crates/'+p.name+'/'+p.version+'/download'})),null,2));
sections.push('## Corresponding MPL source','The release includes MPL-SOURCES.zip containing the unmodified source of MPL-2.0 components listed in MPL-SOURCES.json. These files remain under MPL-2.0, not the application MIT license.');
fs.writeFileSync('docs/generated/THIRD-PARTY-NOTICES.txt',sections.join('\n\n'));
console.log(JSON.stringify({packages:metadata.packages.filter(p=>resolved.has(p.id)&&p.source).length,missingLicenseFiles:missing}));
if(missing.length)process.exitCode=2;
