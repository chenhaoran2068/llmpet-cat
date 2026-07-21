# Codex 使用说明

LLMPET Cat 不需要由 Codex 启动。它是一个独立的桌面应用，会监视本机的 Codex 会话文件来改变猫猫状态。

## 支持的 Codex 形态

- Codex Desktop
- Codex CLI
- VS Code 中使用的 Codex

这三种方式都使用 `~/.codex/sessions/**/*.jsonl`。当你使用 Codex 工作时，猫猫会根据本地会话活动进入思考、工作、等待、完成或需要回复等状态。

## 隐私边界

- 会话内容和用户文件不会上传。
- 猫猫只使用本地会话的活动状态来触发动画与提醒。
- 为了判断空闲和休息，应用只读取系统空闲时间与鼠标相对方向，不记录鼠标坐标。

更完整的说明请阅读 [PRIVACY.md](PRIVACY.md)。
