import { test, expect } from '@playwright/test';
test('single-window view switch preserves management form and failed open stays in management',async({page})=>{
  await page.addInitScript(()=>{
    window.calls=[];window.failOpen=false;
    window.__TAURI__={event:{listen:async()=>{}},core:{invoke:async(name,args)=>{
      window.calls.push(name);
      if(name==='get_job')return {status:'idle'};
      if(name==='run_action'&&args.action==='inspect')return {registered:false};
      if(name==='open_core'&&window.failOpen)throw Error('Core unavailable');
    }}};
  });
  await page.goto('http://127.0.0.1:1420');
  await page.locator('#root').fill('D:\\KeepMyInput');
  await page.getByRole('button',{name:'聊天',exact:true}).click();
  await expect(page.locator('#show-chat')).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'桌面管理',exact:true}).click();
  await expect(page.locator('#root')).toHaveValue('D:\\KeepMyInput');
  await expect(page.locator('#show-management')).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(()=>window.calls.includes('hide_core'))).toBe(true);
  await page.evaluate(()=>window.failOpen=true);
  await page.locator('#show-chat').click();
  await expect(page.getByRole('status')).toContainText('Core unavailable');
  await expect(page.locator('#show-management')).toHaveAttribute('aria-pressed','true');
});
test('management UI is truthful in browser preview and theme is independent', async ({ page }) => {
  await page.goto('http://127.0.0.1:1420');
  await expect(page.getByAltText('鲸核图标')).toHaveCount(2);
  expect(await page.locator('.brand-icon').evaluate(img=>img.complete&&img.naturalWidth===128)).toBe(true);
  await expect(page.getByRole('heading', {name:'尚未读取',exact:true}).first()).toBeVisible();
  await page.getByRole('button', {name:'启动内核',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('界面预览');
  await page.getByRole('button',{name:'内核更新',exact:true}).click();
  await expect(page.getByRole('button',{name:'安装此版本'})).toBeDisabled();
  await page.getByRole('button',{name:'切换外观',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.screenshot({path:'ui-updates-dark.png',fullPage:true});
  await page.getByRole('button',{name:'工作空间',exact:true}).click();
  await page.getByRole('button',{name:'切换外观',exact:true}).click();
  await page.screenshot({path:'ui-overview-light.png',fullPage:true});
});
test('native check result enables install, failed job remains visible', async ({page}) => {
  await page.addInitScript(() => {
    window.__TAURI__={event:{listen:async()=>{}},core:{invoke:async(name,args)=>{
      if(name==='get_job') return {status:'idle',message:'Ready'};
      if(args.action==='inspect') return {registered:false};
      if(args.action==='check') return {version:'1.2.3'};
      if(args.action==='install') throw Error('Simulation: candidate failed');
    }}};
  });
  await page.goto('http://127.0.0.1:1420');
  await page.getByRole('button',{name:'内核更新',exact:true}).click();
  await page.getByRole('button',{name:'检查官方发布'}).click();
  await expect(page.getByRole('button',{name:'安装此版本'})).toBeEnabled();
  await page.getByRole('button',{name:'安装此版本'}).click();
  await expect(page.getByRole('status')).toContainText('candidate failed');
  await page.getByRole('button',{name:'外观与扩展',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('candidate failed');
});
