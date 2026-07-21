# LLMPET Cat

一只陪你使用 Codex 的猫猫桌宠。它会从本机 Codex 会话中读取最新的工作状态，在桌面上陪你工作、提醒休息，并用对话气泡告诉你任务已完成。

## 下载

请从本仓库的 [Releases](../../releases) 页面下载。

- **Windows**：下载 `LLMPET-Cat-Setup-x.x.x.exe`，运行安装程序。
- **便携版**：下载 ZIP，解压后运行 `LLMPET Cat.exe`。
- **macOS**：本仓库保留了 macOS 打包配置。正式签名的 macOS 安装包尚未发布；你可以在 Mac 上从源码运行或自行打包。

## 能做什么

- 自动关注 Codex Desktop、Codex CLI 与 VS Code Codex 的本机会话。
- 根据思考、工具调用、等待回复、完成等状态更换猫猫表情。
- 任务完成时显示日漫风对话框，记录每日完成。
- 连续工作 40 分钟提醒休息；空闲时间过长会上演“吃掉屏幕”的视觉小剧场。
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

## 素材与许可

猫猫 GIF 的材料来源请见 `assets/cat/CREDITS.md`。本项目以 MIT 许可发布，必要的许可文本保留在 [LICENSE](LICENSE)。
