# agent-tools-marketplace

面向 Codex 的可复用公开 agent-tools marketplace。当前提供
`harness-engineering@agent-tools-marketplace`，包含三个技能：

- `harness-creator`：以 plan/apply 流程安全创建或改进项目 harness。
- `harness-doctor`：只读诊断 Instructions、Tools、Environment、State、
  Feedback 五个 Readiness 维度。
- `harness-archiver`：在用户明确要求后归档已完成、已验证的阶段。

## 安装

需要已支持 `codex plugin` 的 Codex CLI：

```bash
codex plugin marketplace add lichenbuliren/agent-tools-marketplace --ref master
codex plugin add harness-engineering@agent-tools-marketplace
```

安装后请启动一个新的 Codex 进程或新建 Codex thread，再通过 `/skills`
确认以下技能已发现：

```text
harness-engineering:harness-creator
harness-engineering:harness-doctor
harness-engineering:harness-archiver
```

## 使用

在 Codex 中直接描述目标，或显式调用插件技能。例如：

```text
$harness-engineering:harness-doctor 检查当前仓库的 harness readiness
```

Creator 和 Archiver 都采用先 plan、再使用同一 `planId` apply 的安全模型。
Doctor 保持只读，并将 Readiness 与 Effectiveness 分开报告。

## 验证

```bash
./init.sh
npm test
```

契约测试会检查 marketplace/plugin 元数据、三个技能、所有插件内相对导入、
禁止的机器路径、CLI 入口，并在临时 `CODEX_HOME` 和仓库隔离副本中完成本地
marketplace 安装、插件安装及新 app-server 进程的 `skills/list` 发现验证。

## 目录边界

发布产物位于 `plugins/harness-engineering/`，其运行时完全包含在插件目录内。
根目录 Harness 只服务源码仓库开发，包括 `AGENTS.md`、`CONTEXT.md`、
`feature_list.json`、`progress.md`、`.harness/` 和 `init.sh`。marketplace
只安装 registry 指向的 `plugins/harness-engineering/`，不会把这些根文件放入
插件 payload。只有用户显式调用 Creator 时，插件才会在目标项目中规划或创建
harness 文件。

## License

[MIT](LICENSE)
