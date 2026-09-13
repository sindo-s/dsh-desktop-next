import {Manager} from '../runtime/manager.mjs';
import assert from 'node:assert/strict';
const m=new Manager();
const before=await m.state();assert.equal(before.previous,null);
const run=await m.start();assert.ok(run.url.startsWith('http://127.0.0.1:'));
await m.stop();console.log('NETWORK_ISOLATED_OFFLINE_START_STOP_OK');
