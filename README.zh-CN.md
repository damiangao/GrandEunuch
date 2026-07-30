# GrandEunuch（大内总管）

[English](./README.md) | 中文

通过私聊对话接入的个人 Agent，兼任两个角色：

1. **秘书**——降低用户漏掉重要协作承诺的概率（你对别人或别人对你的承诺、待确认的结果、责任不清晰的事项），同时把不必要的打扰降到最低。
2. **创意助手**——当你不知道该做什么时，主动浮现并综合你已记录的想法，在散碎的片段之间找出连接，而不只是被动地逐条回忆。

这不是两个独立的应用。两者是同一个 Agent 在不同 Run 中追求不同目标，共享同一套记忆与唤醒基础设施。完整的产品和运行时契约见 [`docs/GRAND_EUNUCH.md`](./docs/GRAND_EUNUCH.md)（中文，v1.0）——那份文档是约束性规格，本 README 只是入口。

## 当前状态

可用的本地 MVP：单用户 PWA，只监听 `127.0.0.1`，无账号、无云端，除了你自己配置的 LLM 端点之外没有任何数据离开本机。

已完成：

- 规格定义的八个工具全部实现——`memory__search/read/remember/revise/forget` 与 `wake__list/schedule/cancel`
- 记忆重启不丢失，带版本与冲突检测，并保留每条的来源以及它是你的原话、Agent 的推断还是你的决定
- 提醒会自我重评：唤醒到点时 Agent 重新判断此刻打扰是否仍然值得，而不是复读一条预先写好的文案
- 遗忘需要明确确认，并会连带取消相关提醒
- 流式回复的对话界面，本地永久保存，可安装为 PWA
- LLM 接入层：支持 Anthropic 的 `/v1/messages`、OpenAI 的 `/v1/chat/completions`、OpenAI 的 `/v1/responses`

**尚未实现：** Run Coordinator 与 Execution Budget 上限、规格中十二个 Eval 的评分框架、浏览器端 E2E 测试。时区固定为 `Asia/Shanghai`。提醒只在应用内显示，不做浏览器通知。

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

## 启动

```bash
./scripts/serve.sh start      # 构建并后台启动
./scripts/serve.sh status
./scripts/serve.sh restart
./scripts/serve.sh stop
./scripts/serve.sh logs
```

然后打开 http://127.0.0.1:3000。

建议这样后台常驻，而不是挂在终端会话里：提醒只在服务运行时触发。如果到点时服务没开，下次启动会补处理一次。

## 常用命令

```bash
npm run typecheck                               # 类型检查（tsc --noEmit）
npm test                                        # 运行测试（vitest run）
npm run build                                   # next build
node --env-file=.env scripts/check-llm.ts       # 验证 LLM 连通性
node --env-file=.env scripts/repl.ts            # 交互式 Agent REPL
```

## 目录结构

```
app/                       Next.js App Router：对话界面与本机 HTTP 接口
src/agent/                 System prompt（含可信时间）与 Agent 组装
src/llm/provider.ts        LLM provider 配置与鉴权
src/memory/                版本化记忆：仓储、遗忘确认、五个工具
src/wake/                  提醒：调度、到期扫描、重评、三个工具
src/conversation/          对话记录与界面读取的时间线
src/persistence/sqlite.ts  可注入的 node:sqlite 与事务化 migration
src/runtime/               本地装配：仓储、每次运行的 Agent、唤醒轮询
scripts/serve.sh           后台服务管理
```

Runtime 从不判断什么重要。它只保证投递、幂等、预算和原子提交；所有关于相关性、时机和措辞的判断都属于 Agent。

实现中的注意事项（包括工具命名约束、`model.baseUrl` vs `provider.baseUrl` 等坑）以及本项目遵循的架构原则（Agent 负责判断，Runtime 只保证安全执行）见 [`CLAUDE.md`](./CLAUDE.md)。
