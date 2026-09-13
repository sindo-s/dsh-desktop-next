import './style.css';
import appIcon from '../src-tauri/icons/128x128.png';
import { createRegistry } from './extensions.js';
const api = window.__TAURI__;
const registry = createRegistry();
let state = {}, latest = null, busy = false;
let loaded = false;
let installRoot='D:\\DSH-Next',updateRepo=localStorage.getItem('updateRepo')??'',desktopCandidate=null,legacyReport=null;
const $ = id => document.getElementById(id);
document.getElementById('app').innerHTML = `
  <div class="shell-tabs" role="navigation" aria-label="应用视图"><img class="shell-icon" src="${appIcon}" alt="鲸核图标"><strong>DSH</strong><button id="show-chat" aria-pressed="false">聊天</button><button id="show-management" aria-pressed="true">桌面管理</button><span id="view-hint">桌面管理</span></div>
  <aside><div class="brand"><img class="brand-icon" src="${appIcon}" alt="鲸核图标"><div>DSH Desktop<small>YOUR LOCAL WORKSPACE</small></div></div><nav id="navigation"></nav><div class="aside-bottom"><span class="dot"></span>WSL 独立运行环境<br><small>Next · 0.4.0 alpha</small></div></aside>
  <main><header><span>桌面管理中心</span><button id="theme">切换外观</button></header><div id="page"></div><section class="activity"><span class="eyebrow">ACTIVITY</span><p id="job" role="status" aria-live="polite">尚未连接宿主</p></section></main>`;
registry.register({ id: 'overview', label: '工作空间', render() {
  return `<div class="hero"><span class="eyebrow">READY WHEN YOU ARE</span><h1>你的工具，<br>一个安静的工作空间。</h1><p>原版官方内核 · 独立 Linux 环境 · 自由选择模型</p><button class="primary" data-action="start">启动内核</button> <button id="open-core">打开官方工作台 ↗</button></div><div class="cards"><article><span>官方内核</span><h2 id="version">未读取</h2><p>不依赖 CLI Bus 分支</p></article><article><span>运行状态</span><h2 id="running">未读取</h2><p id="url">独立于旧版桌面端</p></article></div><div class="actions"><button data-action="status">刷新状态</button><button data-action="stop">停止内核</button></div>`;
}});
registry.register({ id: 'environment', label: '安装与环境', render() {
  return `<span class="eyebrow">ALL IN ONE PLACE</span><h1>安装一次，准备就绪。</h1><p>离线版使用内置环境镜像，在线版按需下载运行依赖；不会改动 DSH-Ubuntu。</p><article class="wide"><label for="root">环境存储目录</label><input id="root" value="D:\\DSH-Next"><p>专用发行版：DSH-Desktop-Next。WSL 系统组件仍由 Windows 管理。</p><button class="primary" data-action="setup">安装 / 继续准备环境</button><button data-action="inspect">检测 WSL</button><button data-action="enable-wsl">首次启用 WSL（管理员）</button></article><p class="note">首次启用 WSL 可能需要管理员授权与重启。准备环境会同时配置官方内核；后续在“内核更新”升级。导入历史请使用“旧数据迁移”。</p>`;
}});
registry.register({ id: 'updates', label: '内核更新', render() {
  return `<span class="eyebrow">UPSTREAM, UNMODIFIED</span><h1>保持更新，留有退路。</h1><p>直接使用官方 npm 发布版。master 的未发布提交不作为默认更新源。</p><article class="wide"><span>可安装版本</span><h2 id="latest">尚未检查</h2><p>下载 → 沙箱检查 → 临时启动 → 数据快照 → 切换</p><button data-action="check">检查官方发布</button><button class="primary" data-action="install" id="install" disabled>安装此版本</button></article><article class="wide"><h3>回到上一快照</h3><p>回滚同时恢复上一内核与当时的数据快照；更新之后的新会话保留在新快照内，不会合并到旧快照。</p><button data-action="rollback">回滚内核与数据快照</button></article>`;
}});
registry.register({ id: 'appearance', label: '外观与扩展', render() {
  return `<span class="eyebrow">MAKE IT YOURS</span><h1>外观不绑在内核上。</h1><div class="cards"><article><h3>独立主题</h3><p>颜色、圆角、间距由设计变量控制。浅色 / 深色偏好仅保存在桌面管理页。</p><button id="theme-page">切换浅色 / 深色</button></article><article><h3>模块化页面</h3><p>管理功能通过受控页面注册接口扩展。官方工作台保留自己的主题和插件设置。</p></article></div><p class="note">首版提供内置模块扩展接口，尚未开放第三方桌面脚本加载。CLI Bus 不再是必选组件。</p>`;
}});
registry.register({ id:'plugins',label:'插件管理',render(){
  return `<span class="eyebrow">OFFICIAL PLUGIN SYSTEM</span><h1>按需添加能力。</h1><p>沿用官方插件管理器。不限制模型，也不强制使用 CLI Bus。</p><article class="wide"><label for="plugin">npm 插件包名（可附精确版本）</label><input id="plugin" placeholder="@scope/plugin-name@1.0.0"><p>插件可以执行代码，请只安装你信任的包。安装前会暂停内核并备份数据。</p><button class="primary" data-action="plugin-add">安装插件</button><button data-action="plugin-list">查看已安装插件</button><pre id="plugin-output"></pre></article>`;
}});
registry.register({id:'migration',label:'旧数据迁移',render(){return `<span class="eyebrow">KEEP YOUR HISTORY</span><h1>带上会话，保留原件。</h1><p>读取旧桌面配置中的 WSL 会话目录。只复制会话；不迁移密钥、CLI Bus 配置或项目文件。</p><article class="wide"><button data-action="legacy-inspect">扫描旧会话</button><pre id="legacy-report"></pre><button class="primary" data-action="legacy-import" id="legacy-import" disabled>复制并验证会话</button><p>先停止旧版中正在运行的任务。原工作目录路径会保留；继续处理项目之前，需要把对应项目放到新版可访问的位置。</p></article>`;}});
registry.register({id:'desktop',label:'桌面升级',render(){return `<span class="eyebrow">SIGNED UPDATES</span><h1>更新应用，不打断内核。</h1><article class="wide"><label for="repo">你的 GitHub 发布仓库（owner/repo）</label><input id="repo" placeholder="owner/repo"><p>只接受本应用签名密钥签署的更新。检查失败不代表已是最新版。</p><button id="desktop-check">检查桌面更新</button><button class="primary" id="desktop-install" disabled>验证签名并安装</button><p id="desktop-version"></p></article>`;}});
registry.register({id:'storage',label:'存储维护',render(){return `<span class="eyebrow">ROOM TO WORK</span><h1>保留退路，清理旧构建。</h1><article class="wide"><button data-action="storage">计算内核占用</button><button data-action="cleanup">清理未引用的旧内核</button><pre id="storage-report"></pre><p>始终保留当前、上一快照及其依赖的代码目录。不删除会话迁移备份或用户项目。删除的旧构建只能重新下载，不能撤销。</p></article>`;}});
function render(id) {
  const page = registry.get(id); $('page').innerHTML = page.render();
  if($('root')){$('root').value=installRoot;const pick=document.createElement('button');pick.id='pick-root';pick.textContent='选择目录';$('root').after(pick);}
  if($('repo'))$('repo').value=updateRepo;
  if($('plugin-output')){const remove=document.createElement('button');remove.dataset.action='plugin-remove';remove.textContent='卸载插件';$('plugin-output').before(remove);}
  for (const button of document.querySelectorAll('nav button')) button.classList.toggle('selected', button.dataset.page === id);
  hydrate();
}
function hydrate() {
  if($('open-core'))$('open-core').textContent='进入聊天';
  for(const id of ['show-chat','show-management'])$(id).disabled=busy;
  if ($('version')) $('version').textContent = loaded ? state.active?.version ?? '尚未安装' : '尚未读取';
  if ($('running')) $('running').textContent = loaded ? state.running ? '运行中' : '未运行' : '尚未读取';
  if ($('url')) $('url').textContent = state.url ? new URL(state.url).origin : '尚未启动服务';
  if ($('latest')) $('latest').textContent = latest?.version ?? '尚未检查';
  for (const button of document.querySelectorAll('[data-action],#open-core')) button.disabled = busy || (button.dataset.action === 'install' && !latest);
  if($('legacy-report'))$('legacy-report').textContent=legacyReport?`发现 ${legacyReport.sessions} 个会话，约 ${(legacyReport.bytes/1048576).toFixed(1)} MiB。\n不会读取或导入密钥。`:'';
  if($('legacy-import'))$('legacy-import').disabled=busy||!legacyReport?.sessions;
  if($('desktop-install'))$('desktop-install').disabled=busy||!desktopCandidate?.available;
  if($('desktop-check'))$('desktop-check').disabled=busy;
  if($('desktop-version'))$('desktop-version').textContent=desktopCandidate?(desktopCandidate.available?`可更新至 ${desktopCandidate.version}`:'当前发布源没有更新'):'';
}
function job(value) { $('job').textContent = value.message ?? value.phase ?? ''; $('job').dataset.status = value.status; busy = value.status === 'running'; hydrate(); }
async function action(name) {
  if (!api) { job({ status: 'failed', message: '这是界面预览。请通过编译后的桌面应用执行实际操作。' }); return; }
  if (name === 'rollback' && !confirm('恢复上一版内核及其数据快照？更新后产生的新会话不会出现在旧快照中。')) return;
  if (name === 'plugin-add' && !confirm('插件可以执行本机代码。确认信任此包并暂停内核安装？')) return;
  if(name==='plugin-remove'&&!confirm('卸载此插件？会暂停内核并保留数据备份。'))return;
  if(name==='legacy-import'&&!confirm('将旧会话复制到新快照并验证，原件不变。请确认旧版任务已停止。'))return;
  if(name==='cleanup'&&!confirm('永久删除未被当前/上一快照引用的旧内核构建？保留活动数据、迁移备份和项目文件。'))return;
  busy = true; hydrate();
  try {
    if(name==='setup')installRoot=$('root').value;
    const value = name === 'setup' ? installRoot : name === 'install' ? latest.version : ['plugin-add','plugin-remove'].includes(name) ? $('plugin').value.trim() : null;
    const result = await api.core.invoke('run_action', { action: name, value });
    if (name === 'check') latest = result;
    else if(name==='legacy-inspect')legacyReport=result;
    else if(name==='storage'||name==='cleanup'){if($('storage-report'))$('storage-report').textContent=`总占用 ${(result.totalBytes/1048576).toFixed(1)} MiB；可清理 ${(result.reclaimableBytes/1048576).toFixed(1)} MiB；已清理 ${result.removedSlots} 个旧构建。`;}
    else if (name === 'inspect') job({ message: result.registered ? '专用发行版已存在。可以继续准备依赖或刷新内核状态。' : '尚未安装专用发行版。' });
    else if (name.startsWith('plugin-')) { if($('plugin-output')) $('plugin-output').textContent=result.listing; if(result.active) state=result; }
    else if (name === 'start') { state = { ...state, running: true, url: result.url }; loaded = true; }
    else { state = result; loaded = true; }
  } catch (e) { job({ status: 'failed', message: String(e) }); }
  finally { busy = false; hydrate(); }
}
function toggleTheme() { const dark = document.documentElement.dataset.theme !== 'dark'; document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('theme', dark ? 'dark' : 'light'); }
document.documentElement.dataset.theme = localStorage.getItem('theme') ?? 'light';
$('navigation').innerHTML = registry.list().map(p => `<button data-page="${p.id}">${p.label}</button>`).join('');
document.addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.page) render(button.dataset.page);
  else if (button.dataset.action) await action(button.dataset.action);
  else if (button.id.startsWith('theme')) toggleTheme();
  else if(button.id==='pick-root') {try{const selected=await api.core.invoke('choose_directory');if(selected){installRoot=selected;$('root').value=selected;}}catch(e){job({status:'failed',message:String(e)});}}
  else if(button.id.startsWith('desktop-')){
    if(!api){job({status:'failed',message:'请在桌面应用中执行更新'});return;}
    const install=button.id==='desktop-install';if(install&&!confirm('验证签名后安装更新，桌面将退出。WSL 任务不会因此停止。'))return;
    updateRepo=$('repo').value.trim();localStorage.setItem('updateRepo',updateRepo);busy=true;hydrate();
    try{const result=await api.core.invoke('desktop_update',{action:install?'install':'check',repo:updateRepo});if(!install)desktopCandidate=result;}
    catch(e){desktopCandidate=null;job({status:'failed',message:String(e)});}finally{busy=false;hydrate();}
  }
  else if (button.id === 'open-core'||button.id==='show-chat'||button.id==='show-management') {
    if(busy)return;
    busy=true;hydrate();
    try {
      if (!api) throw Error('请在桌面应用中打开工作台');
      const chat=button.id!=='show-management';
      await api.core.invoke(chat?'open_core':'hide_core');
      $('show-chat').setAttribute('aria-pressed',String(chat));
      $('show-management').setAttribute('aria-pressed',String(!chat));
      $('view-hint').textContent=chat?'官方工作台':'桌面管理';
    } catch (e) { job({ status: 'failed', message: String(e) }); }
    finally{busy=false;hydrate();}
  }
});
render('overview');
if (api) {
  await api.event.listen('host-job', e => job(e.payload));
  const previousJob = await api.core.invoke('get_job');
  job(previousJob);
  if (!busy) {
    try {
      const environment = await api.core.invoke('run_action',{action:'inspect',value:null});
      installRoot=environment.root??installRoot;updateRepo=environment.updateRepo??updateRepo;
      if(environment.resume){render('environment');await action('setup');}
      else if(environment.registered) await action('status');
      else { loaded=true; render('environment'); }
    } catch(e) { job({status:'failed',message:String(e)}); render('environment'); }
    if(['failed','interrupted'].includes(previousJob.status)) job(previousJob);
  }
} else job({ message: '界面预览模式 · 不会安装或修改本机环境' });
