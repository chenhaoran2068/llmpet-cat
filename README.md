# LLMPET Cat

一只陪你使用 AI 的猫猫桌宠。它在本机读取会话状态，用项目猫猫、日漫风气泡和小动作陪你工作；不会上传会话内容。

## 下载

请从本仓库的 [Releases](../../releases) 页面下载。

- **Windows**：下载 `LLMPET-Cat-Setup-x.x.x.exe`，运行安装程序。
- **便携版**：下载 ZIP，解压后运行 `LLMPET Cat.exe`。
- **macOS**：本仓库保留了 macOS 打包配置。正式签名的 macOS 安装包尚未发布；你可以在 Mac 上从源码运行或自行打包。

## 能做什么

- 监听 Codex Desktop、Codex CLI、VS Code Codex 与 Kimi Desktop 的本机会话。
- 最多显示五个当前项目；VS Code 会话合并为一只项目猫，历史项目不会制造空猫位。
- 默认是原味猫；也可为项目固定选择圆墨镜程序猫、贝雷帽作家猫或可乐小胖猫。项目名称和猫猫身份会持续保留。
- 按查资料、分析、等待决定、编写、完成、失败和休息切换动作；完成时由对应猫猫说出日漫风气泡。
- 原味猫直接使用经过挑选的高表现力原始 GIF；其他身份猫使用同动作、同画风的高帧 WebP 动画。
- 可拖动猫猫；右键猫猫可改名、绑定项目或唤回对应应用。透明空白区域不会拦截桌面鼠标。
- 连续工作 40 分钟会出现可停留五分钟的休息提醒；长时间无活动会触发仅视觉化的“吃屏幕”小剧场。
- Windows 安装后可随开机自启动。

LLMPET Cat 仅使用本机的 Codex 会话状态来驱动猫猫动画，不会上传会话内容。详见 [PRIVACY.md](PRIVACY.md)。

## 给 Mac 用户

1. 安装 Node.js 22 或更新版本。
2. 克隆本仓库并运行 `pnpm install`。
3. 使用 `pnpm start` 启动，或使用 `pnpm package:mac` 在本机生成 DMG 和 ZIP。

如果你从未打开过未签名的 Mac 应用，需要在 macOS 的“系统设置 > 隐私与安全性”中确认启动。

## 开发

```powershell
pnpm install
pnpm start
```

## 测试与打包

```powershell
pnpm test
pnpm package:win
```

在 macOS 上另外可用：

```bash
pnpm package:mac
```

## 许可

本项目以 [MIT 许可证](LICENSE) 发布。猫猫素材与动画为本仓库当前版本的桌宠资源；旧版 QQ、office 与实验素材不随发布版分发。
