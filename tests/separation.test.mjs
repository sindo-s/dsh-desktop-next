import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = p => fs.readFileSync(new URL('../'+p, import.meta.url), 'utf8');
test('development command selects distinct application identity and disables bundles', () => {
  const prod=JSON.parse(read('src-tauri/tauri.conf.json'));
  const dev=JSON.parse(read('src-tauri/tauri.dev.json'));
  assert.notEqual(dev.identifier,prod.identifier);
  assert.equal(dev.bundle.active,false);
  assert.match(JSON.parse(read('package.json')).scripts.desktop,/--config src-tauri\/tauri.dev.json/);
});
test('release preparation exports committed tree and refuses links and personal artifacts', () => {
  const script=read('scripts/prepare-release.ps1');
  assert.match(script,/git archive --format=zip/);
  assert.match(script,/git status --porcelain/);
  assert.match(script,/120000\|160000/);
  assert.match(script,/offline-payload/);
  assert.match(script,/ReparsePoint/);
});
