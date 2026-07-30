# GrandEunuch（大内总管）

[English](./README.md) | 中文

通过私聊对话接入的个人 Agent，兼任两个角色：

1. **秘书**——降低用户漏掉重要协作承诺的概率（你对别人或别人对你的承诺、待确认的结果、责任不清晰的事项），同时把不必要的打扰降到最低。
2. **创意助手**——当你不知道该做什么时，主动浮现并综合你已记录的想法，在散碎的片段之间找出连接，而不只是被动地逐条回忆。

这不是两个独立的应用。两者是同一个 Agent 在不同 Run 中追求不同目标，共享同一套记忆与唤醒基础设施。完整的产品和运行时契约见 [`docs/GRAND_EUNUCH.md`](./docs/GRAND_EUNUCH.md)（中文，v1.0）——那份文档是约束性规格，本 README 只是入口。

## 当前状态

这是骨架原型，并非完整规格的实现。目前已完成：

- LLM 接入层：支持 Anthropic 的 `/v1/messages`、OpenAI 的 `/v1/chat/completions`、OpenAI 的 `/v1/responses` 三种线路协议中的任意一种
- 基于 [`pi-agent-core`](https://www.npmjs.com/package/@earendil-works/pi-agent-core) 的 Agent Loop
- 规格定义的八个工具中的两个：`memory.remember` 和 `memory.search`（SQLite 持久化，基于 `node:sqlite`，重启不丢失）

**尚未实现：** `memory.read`、`memory.revise`、`memory.forget`、`wake.list`、`wake.schedule`、`wake.cancel`、自动化测试。

## 安装

需要 Node.js >= 22.13（`node:sqlite` 免 flag 可用的版本）。

```bash
npm install
cp .env.example .env
```

填写 `.env`：

| 变量 | 说明 |
|---|---|
| `LLM_BASE_URL` | LLM 端点的 base URL |
| `LLM_API_KEY` | API key |
| `LLM_MODEL` | 端点期望接收的模型名 |
| `LLM_API_FORMAT` | `anthropic`（`/v1/messages`，默认）、`openai`（`/v1/chat/completions`）或 `openai-responses`（`/v1/responses`）——必须和端点实际说的协议一致 |
| `DB_PATH` | SQLite 文件路径（默认 `./data/kokanee.sqlite`），目录不存在会自动创建 |

## 常用命令

```bash
npm run typecheck                              # 类型检查（tsc --noEmit）
npm run build                                   # 编译到 dist/
node --env-file=.env scripts/check-llm.ts       # 验证 LLM 连通性
node --env-file=.env scripts/repl.ts            # 交互式 Agent REPL
```

## 目录结构

```
src/llm/provider.ts       LLM provider 配置与鉴权
src/memory/store.ts       SQLite 持久化存储（node:sqlite，文件路径见 DB_PATH）
src/memory/tools.ts       memory__remember / memory__search 工具定义
src/agent/system-prompt.ts
src/agent/create-agent.ts 将模型、工具、system prompt 组装为 Agent
scripts/check-llm.ts      一次性连通性验证
scripts/repl.ts           交互式终端 REPL
```

实现中的注意事项（包括工具命名约束、`model.baseUrl` vs `provider.baseUrl` 等坑）以及本项目遵循的架构原则（Agent 负责判断，Runtime 只保证安全执行）见 [`CLAUDE.md`](./CLAUDE.md)。
