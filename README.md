# agent-tools-marketplace

面向 Codex 的可复用公共 agent-tools marketplace。当前提供：

- `harness-engineering@agent-tools-marketplace`
  - `harness-creator`：保守创建最小、可恢复的项目 harness，不覆盖已有文件。
  - `harness-doctor`：检查 harness 结构、JSON 状态和启动可恢复性。
  - `harness-archiver`：归档已记录的阶段进度，并保留下一次会话的入口。

插件的 skills 与 runtime 全部位于
`plugins/harness-engineering/`。安装后的运行不依赖本仓库之外的源码目录、
用户主目录或机器上的 plugin cache 路径。安装插件本身不会向项目根目录写入
harness 文件；只有显式调用 `harness-creator` 才会创建它们。

## 本地安装

要求：支持 `codex plugin` 的 Codex CLI，以及 Node.js 20 或更高版本。

```bash
codex plugin marketplace add /absolute/path/to/agent-tools-marketplace
codex plugin add harness-engineering@agent-tools-marketplace
```

检查 marketplace 与安装状态：

```bash
codex plugin marketplace list
codex plugin list --available --json
```

为了验证新进程发现，不要只依赖当前会话的 skill 列表。安装完成后启动一个新的
Codex 进程或新建 Codex thread，并确认以下三个完整名称出现：

- `harness-engineering:harness-creator`
- `harness-engineering:harness-doctor`
- `harness-engineering:harness-archiver`

隔离验证时可临时设置独立的 `CODEX_HOME`，执行 marketplace add、plugin add 和
新进程 skill discovery，避免读取已有安装状态。测试不会把插件发布到 GitHub。

## 开发验证

```bash
npm test
```

契约测试验证 marketplace/manifest/skill 所有权、运行时路径隔离、非覆盖创建、
doctor 检查、可执行 `init.sh` 与归档闭环。

## 许可证

MIT，见 [LICENSE](LICENSE)。
