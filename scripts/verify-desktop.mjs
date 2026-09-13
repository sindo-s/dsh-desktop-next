import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import assert from 'node:assert/strict';
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const exe=path.resolve(process.argv[2]??'src-tauri/target/release/dsh-desktop-next.exe');
const child=spawn(exe,[],{windowsHide:true,stdio:'ignore',env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`}});
let browser;
try {
  for(let i=0;i<60;i++){
    try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);break;}catch{await new Promise(r=>setTimeout(r,500));}
  }
  if(!browser)throw Error('WebView2 diagnostic connection failed');
  const context=browser.contexts()[0];
  let page;
  for(let i=0;i<30;i++) {page=context.pages().find(p=>p.url().includes('tauri.localhost'));if(page)break;await new Promise(r=>setTimeout(r,200));}
  if(!page)throw Error('Management page missing');
  await page.locator('.brand-icon').waitFor();
  assert.equal(await page.locator('.brand-icon').evaluate(img=>img.complete&&img.naturalWidth===128),true,'production icon is loaded');
  if(process.argv.includes('--offline')) {
    await page.waitForFunction(()=>document.querySelector('#job')?.dataset.status!=='running');
    const info=await page.evaluate(()=>window.__TAURI__.core.invoke('run_action',{action:'inspect',value:null}));
    assert.equal(info.offline,true,'installed binary uses the offline payload contract');
    console.log('INSTALLED_OFFLINE_MODE_OK');
  }
  await page.getByRole('button',{name:'安装与环境',exact:true}).click();
  await page.getByRole('button',{name:'安装 / 继续准备环境',exact:true}).click();
  await page.getByRole('status').filter({hasText:'setup 完成'}).waitFor({timeout:180000});
  await page.getByRole('button',{name:'工作空间',exact:true}).click();
  await page.getByRole('button',{name:'刷新状态',exact:true}).click();
  await page.getByRole('heading',{name:'0.1.2-rc.1',exact:true}).waitFor();
  await page.getByRole('button',{name:'进入聊天',exact:true}).click();
  let core;
  for(let i=0;i<40;i++){core=context.pages().find(p=>p.url().startsWith('http://127.0.0.1:'));if(core)break;await new Promise(r=>setTimeout(r,250));}
  assert.ok(core,'official workbench opens');
  await core.waitForLoadState('domcontentloaded');
  // No bundled native API should be available to the external core webview.
  const denied=await core.evaluate(async()=>{
    if(!window.__TAURI__?.core?.invoke)return true;
    try {await window.__TAURI__.core.invoke('get_job');return false;}catch{return true;}
  });
  assert.equal(denied,true,'official workbench cannot call the native host API');
  const windows=await page.evaluate(async()=> (await window.__TAURI__.window.getAllWindows()).map(w=>w.label));
  assert.deepEqual(windows,['main'],'chat does not create another native window');
  await core.evaluate(()=>window.__dshViewRetention='retained');
  await page.getByRole('button',{name:'桌面管理',exact:true}).click();
  await page.getByRole('button',{name:'刷新状态',exact:true}).click();
  await page.getByRole('button',{name:'聊天',exact:true}).click();
  assert.equal(await core.evaluate(()=>window.__dshViewRetention),'retained','switching does not reload the workbench');
  // Tauri 2.11.5's JS wrapper expects camelCase but native returns window_label.
  const views=await page.evaluate(async()=> (await window.__TAURI__.core.invoke('plugin:webview|get_all_webviews')).map(v=>({label:v.label,window:v.window_label})));
  console.log('WEBVIEW_TOPOLOGY',JSON.stringify(views));
  assert.equal(views.find(v=>v.label==='core')?.window,'main','core is attached to the main window');
  for(const [width,height] of [[980,740],[1120,820]]) {
    await new Promise((resolve,reject)=>{
      const resize=spawn('powershell.exe',['-NoProfile','-File',path.resolve('scripts/resize-test-window.ps1'),'-TestProcessId',String(child.pid),'-Width',String(width),'-Height',String(height)],{windowsHide:true,stdio:'ignore'});
      resize.on('error',reject);resize.on('exit',code=>code===0?resolve():reject(Error('Resize helper failed')));
    });
    await new Promise(r=>setTimeout(r,400));
    const managerSize=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
    const coreSize=await core.evaluate(()=>({width:innerWidth,height:innerHeight}));
    assert.ok(Math.abs(managerSize.width-coreSize.width)<=2,'chat fills window width');
    assert.ok(Math.abs(managerSize.height-coreSize.height-56)<=2,'top navigation remains visible after resize');
  }
  console.log('EMBEDDED_CHAT_RESIZE_OK');
  console.log('SINGLE_WINDOW_RETAINED_CHAT_AND_MANAGEMENT_COMMANDS_OK');
  await page.getByRole('button',{name:'桌面管理',exact:true}).click();
  await page.screenshot({path:'ui-native.png',fullPage:true});
  console.log('NATIVE_STATUS_OPEN_CORE_AND_ISOLATION_OK');
  // Closing the CDP target can close its shared native window; close via app teardown below.
} finally { if(browser)await browser.close(); child.kill(); }
