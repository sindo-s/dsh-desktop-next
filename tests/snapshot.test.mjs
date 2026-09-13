import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {copyHome} from '../runtime/manager.mjs';
test('snapshot regenerates official fallback links and preserves independent data',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-copy-test-'));
  try {
    const code=path.join(root,'code'),home=path.join(root,'home'),target=path.join(root,'copy');
    await fs.mkdir(path.join(code,'node_modules','official'),{recursive:true});
    await fs.mkdir(path.join(home,'profiles','node_modules'),{recursive:true});
    await fs.mkdir(path.join(home,'sessions'),{recursive:true});
    await fs.writeFile(path.join(home,'sessions','test.jsonl'),'original');
    await fs.symlink(path.join(code,'node_modules','official'),path.join(home,'profiles','node_modules','official'),'junction');
    await copyHome(home,target,code);
    await assert.rejects(fs.lstat(path.join(target,'profiles','node_modules','official')),{code:'ENOENT'});
    await fs.writeFile(path.join(target,'sessions','test.jsonl'),'new');
    assert.equal(await fs.readFile(path.join(home,'sessions','test.jsonl'),'utf8'),'original');
  } finally {await fs.rm(root,{recursive:true,force:true});}
});
