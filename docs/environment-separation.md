# 日常使用与发布制作隔离

## 本机分工

| 用途 | 位置 / 环境 |
| --- | --- |
| 日常使用（保持原状） | `D:\DSH-Next\app`；WSL `DSH-Desktop-Next` |
| 开发运行 | `npm run desktop`；WSL `DSH-Desktop-Next-Dev`，安装根目录固定 `D:\DSH-Next-Dev` |
| 发布源码快照 | `D:\DSH-Publishing\source-<commit>\src` |
| 干净离线镜像制作 | WSL `DSH-Offline-Builder`，不能使用日常发行版导出 |
| 离线验证 | WSL `DSH-Offline-Verify`，只使用虚构数据 |

开发命令使用独立应用标识及 WebView 存储，调试构建另加 `development` 配置目录。
调试版不读取旧会话迁移入口、不安装正式桌面更新、不写日常续装注册项。
开发环境首次启动为空，不复制 API 密钥。需要模型测试时仅使用专门的测试凭据，不纳入制作镜像。

## 发布步骤

1. 在 Git 源码目录开发并提交经过检查的修改。
2. 执行 `powershell -NoProfile -File scripts/prepare-release.ps1`。
3. 在生成的 `src` 目录安装依赖并构建；脚本只导出已提交文件，不递归复制工作目录，也不带 Git 历史。
4. 离线载荷需另行按发布文档制作、检查。此脚本不会复制现有载荷或用户发行版。
5. 签名私钥留在制作目录以外，仅签名时提供路径。核对待发布附件，人工确认后上传。

正式 release 构建仍连接正式发行版；不能为了测试而在日常电脑启动正式构建。
完整安装器测试应在独立 Windows 虚拟机完成。旧的 `verify-desktop.mjs` / `verify-next-features.mjs` 属于真实环境测试，不能视为无副作用单元测试。
这是一层防误操作措施，不是抵御同一 Windows 用户下恶意程序的安全边界；WSL 能访问 Windows 磁盘。
发布源码的文件名检查也不能证明没有硬编码密钥，仍需内容扫描及人工复核。
