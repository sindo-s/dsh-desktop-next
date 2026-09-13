# 发布、离线安装和恢复

## 应用标识变更（下次发行前必查）

源码已改用不含个人用户名的 `io.github.dshdesktop.next` 标识。目前未重新打包。
Tauri 的应用数据目录跟随标识变化，旧版桌面管理配置及 WebView 数据不会自动出现在新目录。
下次发行前必须验证旧配置迁移、安装程序识别及升级流程；不要直接将此变更作为无缝自动升级发布。
此源码修改本身不会移动或删除已安装应用的数据，也不会更改 WSL 发行版和其中的会话。

## 桌面签名更新

签名公钥固定在 `src-tauri/update.pub` 和 Tauri 配置里。维护者应把私钥保存在仓库以外的安全位置，
限制文件访问权限。自行发行的 fork 必须生成自己的签名密钥对并替换公钥。
请另行安全备份私钥；不要上传到 GitHub，不要放进发行包。该签名是更新验签，不是 Windows
Authenticode 证书；首次安装仍可能出现 SmartScreen 未知发布者提示。

构建时设置 `TAURI_SIGNING_PRIVATE_KEY` 为私钥文件路径，`npm run dist` 生成安装程序及 `.sig`。
在 GUI“桌面升级”填写自己控制的 `owner/repo`。检查端点固定为 HTTPS GitHub Release 的
`latest/download/latest.json`；更新包必须通过内置公钥验证，不接受前端指定的替代公钥。
未成功读取版本元数据时显示失败，不能显示“已经最新版”。

```powershell
node scripts/release-manifest.mjs owner/repo "release/installer.exe" 0.4.0-alpha.4
```

此命令只生成本地清单，不上传。正式发布需要将安装包、签名和 `latest.json` 上传到该仓库
对应的 `v<version>` Release，并确保它被 GitHub 标记为 Latest。GitHub 的 prerelease 默认不会
成为 Latest；测试发布不能直接作为默认通道。源码公开不代表安装包与自动更新通道已经发布。
桌面更新退出的是 Windows 外壳；WSL 内核保持运行，不打断其任务。更新动作与其他管理操作互斥。

## 离线镜像制作

只能使用从官方 Ubuntu 新建的 `DSH-Offline-Builder`。**不要导出用户正在使用的发行版作为安装镜像。**
依次运行 bootstrap、安装固定官方 npm 内核、`runtime/seal-image.mjs`、`apt-get clean`，再
`wsl --export ... --format tar.gz`。封存脚本检查发行版名、root 身份和单一新内核，停止测试进程，
清空其空数据目录、测试令牌和 npm 缓存；保留官方程序依赖。

微软 WSL MSI 从官方 GitHub Release 获取，验证 Microsoft Authenticode 签名和官方 SHA256。
本次固定 2.7.13 x64。将 `rootfs.tar.gz` 与 `wsl.x64.msi` 放入专用 payload 目录，运行：

```powershell
node scripts/package-offline.mjs D:/deepseek/dsh-image-build/payload
$env:DSH_OFFLINE_MANIFEST='D:\deepseek\dsh-image-build\payload\manifest.json'
npm run tauri -- build --config D:\deepseek\dsh-image-build\payload\tauri.offline.json
```

构建把两个载荷 SHA256 固定到可执行文件中，同时捆绑 WebView2 离线安装程序。导入前流式计算
镜像哈希，篡改时拒绝导入。已有发行版不会被替换；离线模式不会调用 apt/npm 更新。
离线 NSIS 使用 zlib 压缩，避免对已经压缩的 Linux 镜像再次进行耗时的 LZMA 压缩。
历史在线包约 2.2 MB，当前离线包约 1.15 GB；实际大小及校验值应随对应 Release 提供。
公开分发离线包之前，应核对其中 Ubuntu、npm 依赖及微软组件的再分发条款，提供所需许可声明与源代码获取方式。
Windows 首次启用虚拟化可能要求 UAC、BIOS 配置和重启；如果系统组件存储已被裁剪，Windows
仍可能需要本机 Windows 安装介质修复。不能绕过这些操作系统前提。

程序首次创建环境前写入安装记录与 HKCU RunOnce 单次续装入口。重启登录后再次打开安装界面
继续，环境和内核都成功后删除该值。不会关机或强制重启。取消 UAC/系统功能安装失败需要重试。

## 会话迁移

迁移向导读取旧桌面 config 中的 DSH_HOME，只复制 session.jsonl / session.jsonl.zstd 文件。
复制前后按文件清单与 SHA256 校验旧数据未变化；拒绝符号链接和超出 2 GiB/50000 会话的输入。
暂存副本放在新版 Linux `imports/`，不会把 Windows 重定向目录误当作可访问的 /mnt/c 路径。
使用当前官方 JSONL backend 实际解析全部会话后，在新的数据快照中合并；同路径不同内容会拒绝。
验证与启动全部成功后切换，旧数据与新应用之前的快照均保留。

不迁移 API 密钥、插件可执行配置、投影缓存或项目文件。会话的原 cwd 不改写；历史可以保留，
但恢复在旧 Linux 路径下的项目任务前，用户需要迁移项目或选择新的工作区。
