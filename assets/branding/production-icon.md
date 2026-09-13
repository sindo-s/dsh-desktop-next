# 已采用：鲸核 v6

0.4.0-alpha.4 将用户选定的 v6 用于 Windows 可执行文件、安装程序及本地管理页。
原始设计保留为 dsh-orca-core-v6.png。用户授权程序化清理后，scripts/prepare-icon.ps1 仅去除外围棋盘格；每行深蓝底板边界以内的像素逐个原样复制。
透明生产源：dsh-app-icon.png。通过 Tauri icon 命令生成 src-tauri/icons 中的 PNG 和多尺寸 ICO。
管理页引用 128x128.png；官方内核自己的网页品牌未修改。旧设计文件保留，不影响内核更新和会话数据。
