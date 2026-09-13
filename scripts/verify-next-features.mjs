import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
const child=spawn(path.resolve('src-tauri/target/release/dsh-desktop-next.exe'),[],{windowsHide:true,stdio:'ignore',env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9247 --remote-debugging-address=127.0.0.1'}});
let browser;
try {
  for(let i=0;i<60;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:9247');break;}catch{await new Promise(r=>setTimeout(r,500));}}
  const context=browser.contexts()[0];const page=context.pages().find(p=>p.url().includes('tauri.localhost'));
  await page.getByRole('button',{name:'旧数据迁移',exact:true}).click();
  await page.getByRole('button',{name:'扫描旧会话',exact:true}).click();
  await page.getByText(/发现 \d+ 个会话/).waitFor();
  if(process.argv.includes('--import')){
    page.once('dialog',dialog=>dialog.accept());
    await page.getByRole('button',{name:'复制并验证会话',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#job').dataset.status==='failed'||document.querySelector('#job').textContent.includes('legacy-import 完成'),null,{timeout:180000});
    const job=await page.locator('#job').textContent();assert.match(job,/legacy-import 完成/);
    console.log('LEGACY_COPY_AND_OFFICIAL_READER_OK');
  }
  await page.screenshot({path:'ui-migration.png',fullPage:true});
  await page.getByRole('button',{name:'桌面升级',exact:true}).click();
  await page.locator('#repo').fill('../unsafe');await page.locator('#desktop-check').click();
  await page.getByRole('status').filter({hasText:'请输入 GitHub'}).waitFor();
  assert.equal(await page.locator('#desktop-install').isDisabled(),true);
  console.log('DESKTOP_UPDATE_FAIL_CLOSED_OK');
}finally{if(browser)await browser.close();child.kill();}
