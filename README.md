# DSH Desktop Next

<img src="src-tauri/icons/128x128.png" width="96" height="96" alt="DSH Desktop Next 虎鲸图标">

**把 DeepSeek Harness 带到 Windows 桌面：一个窗口管理聊天、Linux 环境、内核更新与插件。**

这是个人维护的非官方客户端，与 DeepSeek 官方无隶属或背书关系。DeepSeek、WSL 等名称及相关商标归各自权利人所有。
当前版本为 **0.4.0-alpha.4**，适合试用与反馈，不应作为重要数据的唯一保存位置。

## 为什么做这个应用

官方负责演进 DSH，本项目负责适配 Windows 桌面体验：不要求官方为桌面端修改内核，也不将模型绑定到 CLI Bus。

| 特性 | 带来的便利 |
| --- | --- |
| 轻量桌面架构 | Tauri + Rust 复用系统 WebView2，不随外壳重复打包完整 Chromium；实际占用取决于工作台、WSL 和任务，不承诺固定性能提升 |
| WSL 集成安装 | 在界面准备独立 Linux 环境，虚拟磁盘可放 D 盘；支持离线载荷构建 |
| 单窗口聊天 | 聊天与桌面管理同窗切换，保留已打开的聊天页面 |
| 内核独立更新 | 跟随官方 npm 发布，先验证候选内核，再切换运行版本 |
| 快照与回滚 | 保留上一份内核与数据快照，为更新失败提供恢复路径 |
| 官方插件机制 | 通过官方插件管理器安装、查看和卸载可信 npm 插件，不要求重写插件 |
| 渐进迁移 | 复制导入旧会话，不改动旧应用；密钥、插件配置与项目文件不自动搬运 |
| 可扩展外观 | 明暗主题、独立样式变量与内置页面注册器，方便后续扩展管理界面 |

桌面外壳与官方内核是两条更新路径。桌面支持签名验签客户端，但公开自动更新通道需单独发布配置；并非创建源码仓库后就自动生效。

## 架构

独立于旧 Electron 0.3 的 Windows 桌面客户端：Tauri 2 / Rust + WebView2 + 专用 WSL2 Ubuntu。
使用未修改的官方 npm 内核，不依赖 CLI Bus，不固定模型或 agent preset。

## 使用

要求 Windows x64、可用的 WSL2/硬件虚拟化及 WebView2。离线包较大，还应为 Linux 虚拟磁盘、内核快照和项目预留空间。

若发行页已提供安装包，下载安装 `DSH-Next_0.4.0-alpha.4_x64-offline.exe`（约 1.15 GB，完整载荷）；没有安装包时请按下方开发说明构建。
打开“安装与环境”。选择环境目录，点击
“安装 / 继续准备环境”。程序准备 Ubuntu、Node.js、pnpm、Git、bubblewrap 和官方内核。
已有 WSL 时无需管理员权限准备 Linux 环境。没有 WSL 时先点“首次启用 WSL（管理员）”；
若 Windows 要求重启，重启后重新打开应用继续。不会强制重启。

普通安装包采用在线引导；离线版另行捆绑干净 Linux 镜像、WSL 和 WebView2。在线版 Ubuntu/Node/npm 下载需要网络，Windows 的虚拟化、WSL
系统组件、WebView2、少量管理配置仍在系统盘。WSL 虚拟磁盘位于所选目录。
需要支持 `wsl --install --name --location` 的现代 WSL；旧 WSL 的失败会显示在活动区。

- 工作空间：启动/停止官方内核。顶部“聊天 / 桌面管理”在同一窗口切换，切换不重载聊天。模型、preset 等在官方工作台配置。
- 内核更新：检查官方 npm `latest`，安装固定版本；不将未发布 master 源码作为默认更新。
- 插件管理：通过官方 `dsh plugin --profile web` 管理器安装受信任 npm 包；不支持任意 shell 参数。
- 外观与扩展：浅色/深色主题；`src/extensions.js` 注册内置管理页面。

首次运行创建全新数据，**不自动导入旧版的会话、凭据或 CLI Bus 配置**。旧版和 DSH-Ubuntu 保持原状。
内核运行在独立进程中，关闭管理窗口不会自动停止工作；需要释放资源时先点击“停止内核”。
不执行全局 `wsl --shutdown`，也不终止其他发行版。

## 更新和恢复

每个内核位于独立 UUID 目录。安装固定包版本，并核对 npm 锁文件中的 SHA512 integrity。
这验证包与 npm registry 元数据一致，**不是独立供应商签名或恶意代码审计**；安装会执行依赖脚本。
临时 DSH_HOME 中验证 bubblewrap、CLI 和 HTTP 登录流程后，停止旧进程并复制数据，再验证候选。
数据复制解引用符号链接，避免新快照仍写入旧快照；超大数据或链接循环可能导致复制失败。
仅全部成功后原子切换 `{active, previous}`。每个 slot 都拥有自己的 DSH_HOME。

回滚会回到上一数据快照，更新后新增的会话保留在新 slot，不会合并到旧快照。
插件安装另做数据备份，失败时保留失败目录并恢复备份。用户项目文件不在 DSH_HOME 快照内。
一次健康检查不能证明所有 API/插件都兼容；官方破坏性变化仍由本项目维护者更新适配器。
环境页支持手动清理未使用的内核目录，保留当前、上一快照及其引用的代码。日志、迁移副本和插件备份不自动清理。

## 安全边界

- 只有打包的 `main` 管理页面有受限 Rust 命令权限；官方 Web UI 是同窗口内隔离的子视图，无原生能力授权。详见 [单窗口说明](docs/single-window.md)。
- 只打开本次进程公布的 `127.0.0.1` 地址，保留官方 token/cookie 认证。令牌不显示在管理页地址栏。
- 不提供通用 `exec`、任意文件系统或关闭沙箱的界面。
- Linux `flock` 防止并发更新，`timeout` 管理长任务；被中断任务不自动宣称成功。
- 进程停止验证 `/proc` 环境中的随机所有权标记，不按名称杀 Node。
- WSL 和所有权标记不是同用户恶意软件的隔离边界。npm 插件是可执行代码，需自行信任。

## 开发

需要 Node.js、Rust MSVC、Microsoft C++ Build Tools 与 WebView2。开发依赖不是终端用户依赖。

```powershell
npm ci
npm test
npx playwright test
npm run desktop
npm run dist
```

`scripts/build.ps1` 默认使用当前环境的工具链；非默认位置可提前设置 `CARGO_HOME`、`RUSTUP_HOME` 和 `PATH`。
前端使用原生 ES modules/CSS，不引入完整组件框架。页面注册器目前只接受内置模块，
不允许第三方任意 JS 获取宿主权限。官方工作台自己的外观不由管理页 CSS 覆盖。

`scripts/verify-desktop.mjs` 仅用于测试，通过临时 loopback WebView2 调试端口验证真实桌面，
正常安装启动不设置该端口。`runtime/manager.mjs` 可在 Linux 通过 stdin 接收脚本执行固定动作。

## 本阶段边界

已加入旧会话复制迁移、签名桌面更新客户端、离线载荷支持、环境准备续装注册、目录选择器、插件卸载和安全清理。
桌面更新的公开 Release 源仍需维护者发布；插件市场、磁盘配额和完整性能基线不在本版承诺内。
当前交付为并行试用 alpha，不是可覆盖旧版的正式升级。不要将 WSL 平台安装成功等同于全部内核安装成功。
详见 [发布与离线说明](docs/release-and-offline.md)。

## 反馈与贡献

报告问题时请附 Windows / WSL 版本、桌面版本、内核版本、复现步骤及脱敏日志。
不要提交 API 密钥、登录链接、会话内容或完整个人配置。提交改动前请运行单元测试、前端构建和适用的界面测试。

## 许可证

本项目采用 [MIT License](LICENSE)，版权署名为 `sindo-s`。
第三方依赖、官方 DSH、Linux 发行版及微软组件仍遵循各自的许可证和分发条款；本项目的 MIT 许可不替代它们，也不授予第三方商标权。

参考：[官方 DSH](https://github.com/deepseek-ai/deepseek-harness)、
[WSL 安装命令](https://learn.microsoft.com/en-us/windows/wsl/basic-commands)、
[Tauri Windows 分发](https://v2.tauri.app/distribute/windows-installer/)。
