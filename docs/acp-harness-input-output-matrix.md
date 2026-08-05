# ACP Harness 输入 / 输出适配矩阵

本文是逐事件核对表。每行从同一条链路下钻：ACP 官方是否支持 → 稳定性 → harness/adapter metadata → Common runtime → OpenMA canonical event → 当前 GUI 槽位 → 各 harness 是否填槽 → 缺口。GUI 不直接读取 harness `_meta`。

## 版本与协议状态

| 项目 | 版本/状态 |
|---|---|
| ACP SDK | 1.3.0 |
| Claude ACP | 0.64.2，依赖 Claude Agent SDK 0.3.220 |
| Claude Agent SDK 最新 | 0.3.222 |
| Codex ACP | 1.1.9 |
| Pi ACP | 0.0.33 |
| Kimi Code | 1.49.0 |
| OpenCode | 1.18.13（2026-08-05 registry 最新） |
| Kilo | 7.4.20（2026-08-05 registry 最新） |
| Cursor | 2026.07.23 |
| stable ACP | initialize、session/new/load/resume/list/delete/close/logout、prompt/cancel、available commands、mode/config、usage、plan、reverse callback、elicitation |
| unstable/experimental ACP | session/fork、plan_update/plan_removed、providers、NES/document、MCP-over-ACP；SDK 1.3.0 的 elicitation legacy API 名仍带 unstable，但官方协议已 stable |

## 术语

| 术语 | 含义 |
|---|---|
| 已填槽 | adapter 已有结构化证据，并能生成 canonical event 让现有 GUI 投影 |
| 部分适配 | 只有部分生命周期、部分 harness 或只有 raw/tool 证据 |
| 未填 | 未生成对应 GUI 语义，保留 vendor/raw 或普通 Tool |
| unknown | 收到工作事实但缺失结构化终态，不能假设完成 |
| missing_terminal | 父 turn 已结束而 child/task 没有终态 bookend |
| OpenMA event | `oma.event.v1` canonical envelope；不是 React 专用事件，也不是 ACP payload 的别名 |

## 输入矩阵

输入包括 OpenMA 到 harness 的 command，以及 harness 通过 reverse RPC 进入 OpenMA 的 request/notification。

| 输入 | ACP 官方支持 | 稳定性 | adapter extension | Common runtime | OpenMA event/command | GUI 槽位 | Claude | Codex | Cursor | Pi | OpenCode | Kilo | Kimi | 缺口 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| initialize request/response | 是 | 稳定 | initialize `_meta` | 完整保存 protocol、agentInfo、capabilities、initializeMeta | `session.started` | Session/能力 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | GUI 不解析未知 capability |
| session/new | 是 | 稳定 | setup response `_meta`，Pi startupInfo | 已支持；additionalDirectories 需 capability | `session.started` | Session/Workspace | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | canonical envelope 与 setup metadata 已持久化，replay 优先 canonical |
| session/load | 是 | 稳定 | setup response `_meta` | 已支持 fallback | `session.started` | History | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 七个当前版本均声明 `loadSession`；load 没有旧历史时只保留 setup evidence |
| session/resume | 是 | 稳定 | Pi resume metadata | 已支持，优先 resume，缺能力时 fallback load/new | `session.started` | History/Session | 已填 | 已填 | 部分 | 部分 | 已填 | 已填 | 已填 | Cursor/Pi 当前版本未声明 resume；fallback 不伪造 provider resume |
| session/fork | 是 | 实验 | fork response `_meta` | 已支持 capability gate | `session.started` | Side chat | 已填 | 未填 | 未填 | 未填 | 已填 | 已填 | 未填 | Claude/OpenCode/Kilo 当前版本声明 fork；fork 只表示 context seed，不是 native subagent |
| prompt text/content blocks | 是 | 稳定 | image/resource metadata | 已支持 text、image、structured blocks | `user.message` | 主聊天 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | typed cross-harness command 尚缺 |
| cancel | 是 | 稳定 | TaskStop、close、terminal kill | 一次 Stop 只发送一次 session/cancel；发送时立即把当前 turn 未结束 tool 投影为 cancelled，并继续接收 prompt 终态前的晚到 tool update | `user.interrupt`、`tool.cancelled`、`turn.cancelled` | Stop/Tool | 部分 | 已填 | 部分 | 已填 | 已填 | 已填 | 部分 | `tool.cancelled` 是 ACP client 派生事实，不伪造成 ACP wire status；provider task stop 能力仍不统一 |
| steering | 否 | 实验扩展 | Claude/Codex `_meta.steering` | negotiated steering 已支持 | `user.message` + `session.steering` | Composer/Turn | 已填 | 已填 | 未填 | 未填 | 未填 | 未填 | 未填 | 不能定向发给 child agent |
| set mode | 是 | 稳定兼容 | legacy mode metadata | 已支持 | `capability.updated` | Mode/config | 已填 | 已填 | 部分 | 已填 | 已填 | 已填 | 已填 | 只有 capability evidence 才发送 |
| set config option | 是 | 稳定 | vendor option values | 已支持 select/boolean | `capability.updated` | Model/config | 已填 | 已填 | 部分 | 已填 | 已填 | 已填 | 已填 | free-form schema 未扩展 |
| available command invoke | 否 | OpenMA command | catalog command + args；Codex `_meta.commandAction` 是展示/adapter 行为提示 | 普通 prompt；host 记录选择事实 | `user.message` + `input_kind:"command"` | Command palette；不新增聊天气泡 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | command/args 在 OpenMA 结构化保留；ACP wire 仍是文本 prompt；例如 `/plan` 由 Codex adapter 收到 prompt 后调用 `setConfigOption`，GUI 不绕过 ACP |
| session/list | 是 | 稳定 | provider/session metadata | Common generic API 已支持；Desktop SessionManager/IPC 未调用 | 尚无 canonical command | 无；本地 sidebar 不是 provider session/list | 未填 | 未填 | 未填 | 未填 | 未填 | 未填 | 未填 | 不能把 OpenMA 本地 SQL session list 写成 provider session/list 已适配 |
| session/delete | 是 | 稳定 | — | Common generic API 已支持；Desktop 删除只处理 OpenMA 本地 session | 尚无 provider delete canonical command | 本地 Session list（不同语义） | 未填 | 未填 | 未填 | 未填 | 未填 | 未填 | 未填 | provider delete 与 GUI archive/delete 必须分开 |
| session/close | 是 | 稳定 | — | generic API 已支持并按 capability gate 调用 | `session.terminated` | Session lifecycle | 已填 | 已填 | 未填 | 未填 | 已填 | 已填 | 未填 | Cursor/Pi/Kimi 当前版本未声明 close；close 失败仍 kill child |
| logout/providers | 是 | 稳定/实验 | provider selection | Common generic API 已支持；Desktop 未暴露 SessionManager/IPC command | 尚无 canonical input fact | Auth/Config 尚未接 provider control | 未填 | 未填 | 未填 | 未填 | 未填 | 未填 | 未填 | capability 会保留，但不能据此宣称 GUI 已调用 provider API |
| permission response | 是 | 稳定 | provider permission metadata | main/per-harness callback adapter 先归一 `title/kind/reason/command`，broker 再交给 GUI；原 tool metadata 仅作 callback/raw 证据 | `user.permission_response`、`callback.completed` | Permission | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | GUI 不读取 provider `_meta`；callback outcome 才是终态 |
| fs callback response | 是 | 稳定 | path policy | broker 已支持 | `callback.*` | File/Tool | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 不把 callback 当 assistant text |
| terminal callback response | 是 | 稳定 | terminal id/exit metadata | broker 已支持 | `callback.*`、`work_item.*` | Terminal/Background bash | 已填 | 已填 | 部分 | 部分 | 部分 | 部分 | 部分 | foreground terminal 不自动进入 Background |
| elicitation response / complete notification | 是 | 稳定 | form schema、URL、elicitation/complete | 六类 form field 已复用 ask sheet并在 broker 边界校验；URL 显示完整 target/host，consent 后交给 OS 外部浏览器；非 HTTP(S) decline；complete 仅接受 outstanding id，未知/重复忽略 | `user.elicitation_response` + `callback.requested/completed/failed/notification` | Permission/elicitation | 部分 | 部分 | 部分 | 部分 | 部分 | 部分 | 部分 | OpenMA form/URL 生命周期已填；各 harness 是否发出请求仍依赖自身实现 |
| MCP-over-ACP response | 否 | 实验扩展 | mcp connect/message/disconnect | generic callback 已支持 | `callback.*` | MCP/raw | 部分 | 部分 | 未填 | 未填 | 未填 | 未填 | 未填 | 不伪造标准 message |
| NES/document command | 否 | 实验扩展 | nes/* request 与 document/* notification | Common runtime typed API 已支持；Desktop 没有 facade/IPC 触发，也不会伪造 reverse callback | 尚无 canonical input fact | 现有 File/Source 未接 editor lifecycle | 未填 | 未填 | 未填 | 未填 | 未填 | 未填 | 未填 | NES/document 是 client→agent API，不应误写成 agent→client callback；GUI 缺少可靠 editor owner |

## 输出矩阵

| 输出 | ACP 官方支持 | 稳定性 | adapter extension | Common runtime | OpenMA canonical event | GUI 槽位 | Claude | Codex | Cursor | Pi | OpenCode | Kilo | Kimi | 缺口 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| session.ready/setup response | 是 | 稳定 | Pi startupInfo 等 response `_meta` | setup metadata 已保留 | `session.started` | Session/Config | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | canonical 是 replay 事实源，旧 raw 仅兼容并去重 |
| agent_message_chunk | 是 | 稳定 | Pi notify、Claude parent id、Codex phase | text/content/message id/meta 已保留；Codex `commentary/final_answer` 已提升为 canonical `data.phase` | `agent.message_chunk`；warning/error 为 `system.notice` | Chat/Notice/Agents | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | GUI 不读取 `_meta.codex`；info notify 仍是普通 message |
| ACP v2 `user_message` / `agent_message` / `agent_thought` / `state_update` | 是（v2 draft） | draft | complete message upsert、content replacement、messageId、running/idle state | content block、message id 与 session state 已归一 | `user.message`、`agent.message`、`agent.thinking`、`session.running/idle` | Chat/Thinking/Agents/Session | 部分 | 部分 | 部分 | 部分 | 部分 | 部分 | 部分 | v1 transport 默认不协商 v2；agent-owned terminal update 暂保留 raw |
| agent_thought_chunk | 是 | 稳定 | nested thinking | parser 已支持 | `agent.thinking` | Chat/Agents | 已填 | 已填 | 部分 | 已填 | 部分 | 部分 | 部分 | 未知 thought 只进 raw |
| tool_call | 是 | 稳定 | Claude/Codex/OpenCode/Kilo/Cursor metadata | tool input/status/parent 已归一 | `tool.started` | Tool | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | Task 需 adapter schema 证据 |
| tool_call_update | 是 | 稳定 | terminal delta、toolResponse、Task output | logical tool merge 已支持；Stop 后仍接收晚到 update | `tool.progress/completed/failed`；client Stop 另发 `tool.cancelled` | Tool/Background | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | cancelled 不是 ACP ToolCallStatus；不从工具名猜 Monitor |
| ACP plan | 是 | 稳定 | provider plan metadata | items/markdown 已支持 | `plan.updated` | Plan | 已填 | 已填 | 已填（Cursor 扩展） | 未发出 | 未发出 | 未发出 | 已填 | Pi/OpenCode/Kilo 当前版本没有 plan emitter；与 Background 分离 |
| plan_update/plan_removed | 是 | 实验 | vendor plan extension | 已保留 raw/canonical | `plan.updated/removed` | Plan | 部分 | 部分 | 未填 | 部分 | 部分 | 部分 | 部分 | stable 性不能过度声明 |
| Cursor `create_plan` / `update_todos` | 否 | Cursor 2026.07.23 扩展 | `create_plan` 同时携带 Markdown、todos、可选 phases；`update_todos` 携带 stable todo id 与 `merge` | Markdown 与 todos 同时归一；`merge:false` 全量替换，`merge:true` 按 id 合并；`cancelled` 状态保真 | `plan.updated`，`update_mode:replace/merge` | Plan document + task-list | 不适用 | 不适用 | 已填 | 不适用 | 不适用 | 不适用 | 不适用 | phases 保留在原始扩展 payload；现有 GUI 不新增 phase 分组布局 |
| OpenCode/Kilo `todowrite` | 否（普通 ACP tool transport） | harness 版本语义 | 精确 tool identity 与 typed `rawInput.todos` 全量快照 | per-harness adapter 归一为 replace；GUI 只消费 canonical Plan | `plan.updated`，`update_mode:replace` | task-list | 不适用 | 不适用 | 不适用 | 不适用 | 已填 | 已填 | 不适用 | 不宣称 harness 发 ACP Plan；相似 tool 不识别；已覆盖 SQL/restart replay |
| available_commands_update | 是 | 稳定 | command catalog | 已替换保存 | `command_catalog.updated` | Command | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 无 catalog 时不显示 picker |
| current_mode/config_option_update | 是 | 稳定 | mode/config metadata | 已更新 SessionRow | `capability.updated` | Mode/config | 已填 | 已填 | 部分 | 已填 | 已填 | 已填 | 已填 | 不能把 session mode 当 Plan |
| usage_update | 是 | 稳定 | child usage/cost | parent/child usage 已分开 | `usage.updated` | Usage/Agents | 已填（child total-only 部分） | 已填 | 未发出 | 未发出 | 已填（parent） | 已填（parent） | 未发出 | Claude `task_notification` 的 total/tool-count/duration 也进入 child progress；无 usage 不估算 |
| session_info_update | 是 | 稳定 | Codex goal/status、Pi running/queueDepth | 通用层合并 metadata；Codex/Pi 各自 adapter 解释 provider 状态；Pi queue depth 只读保存 | `session.running/idle`、`capability.updated` | Session/Goal/Notice；Pi queueDepth 复用 queued placeholder | 仅 title metadata | 已填 | 仅 title metadata | 已填 | 未发出 | 未发出 | 未发出 | GUI 不读取 provider `_meta`；本地 turn terminal 更权威；provider queue 不伪造成可编辑 prompt queue |
| Claude native Agent/Task | 否 | Claude adapter + opt-in raw SDK extension | toolResponse.agentId、usage/progress、parentToolUseId、`_claude/sdkMessage` | nested transcript、Agent view 与可证明 terminal 已支持 | `work_item.*`、`agent.*`、`usage.updated` | Agents/Background agent | 已填 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不是 ACP 标准 lifecycle；缺失终态保持 unknown |
| Claude Monitor | 否 | Claude ACP 0.64.2 raw SDK extension | `Monitor` toolResponse.`taskId` 是直接身份；command Monitor 的 SDK `task_type="local_bash"` 与后台 Bash 共用；WebSocket Monitor 为 `monitor_ws`；user-role XML delivery 带 `<task-id>/<summary>/<event>` | opt-in `emitRawSDKMessages`；tool result 或 `monitor_ws` 直接分类；真实 XML `task-id` 将同 ID generic `local_bash` 以 `work_item.classified` 收敛为 Monitor；不按 description 猜关联 | monitor `work_item.*`（含 `classified/missing_terminal`）+ `monitor.event` | Activity Dock Monitor；原 Tool 仍保留 | 已填（无 direct Stop） | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | plugin command Monitor 在首次 delivery 前仍只能保持 generic；首次 delivery 后可稳定关联；out-of-band delivery 保持 session scope |
| Claude TaskOutput | 否 | Claude SDK tool（自 Claude Code 2.1.83 deprecated） | 查询/等待既有 task output | 保留普通 Tool call/result | `tool.*` | Tool | 已填 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不创建 Monitor/Background 生命周期；优先读取 task output file |
| Claude SDK task lifecycle / task_notification | 否 | opt-in Claude ACP extension | 默认内部消费；`emitRawSDKMessages` 后发 `_claude/sdkMessage` | 已解析 `task_started/task_updated/task_progress/task_notification/background_tasks_changed`；level 按 REPLACE 修复丢失 start，absence 只发可逆 `missing_terminal`；有 `subagent_type` 才进入 native Agent；terminal-only usage 先生成 child progress 再落终态 | `work_item.*`；Monitor delivery 另发带 `work_item_id` 的 session-scoped `monitor.event` | Agents / Activity Dock | 部分 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | total-only usage 保留在 progress payload；level 与 edge 顺序未定义，不能从 absence 猜终态；不是 ACP 标准 `session/update` |
| Codex child/collaboration | 否 | Codex adapter extension | collaboration/subagent/child thread meta | spawn/wait/close/goal/usage 已支持 | `work_item.*`、`work_item.reidentified` | Agents/Background agent | 不适用 | 已填 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不是 ACP 原生 subagent event |
| OpenCode/Kilo foreground Task | 否 | harness extension | optional `background`、optional resume `task_id`、child-session metadata | omission 按前台处理；resume 直接复用 stable id；新任务 provisional → reidentified → terminal | `work_item.started/reidentified/completed/failed` | Agents | 不适用 | 不适用 | 不适用 | 不适用 | 已填 | 已填 | 不适用 | 必须匹配完整 Task input schema；相似普通 think tool 不识别 |
| OpenCode/Kilo background Task | 否 | harness extension | `background:true`、rawOutput parent/session/model/jobId、synthetic `<task state>` | tool 返回只证明 running；live ACP 不转发 synthetic user terminal，父 turn 后落 `missing_terminal`；load/replay 的 `audience:["assistant"]` user chunk 可恢复 definitive terminal | `work_item.started/reidentified/missing_terminal/completed/failed` | Agents/Background agent | 不适用 | 不适用 | 不适用 | 不适用 | 部分适配 | 部分适配 | 不适用 | 不从后续自然语言回答猜终态；Kilo resumable hint 作为原始 error 保留 |
| Kimi background notification | 否 | Kimi extension | 固定 title + Task ID/Status/Description/Terminal reason/Exit code/Failure reason 文本字段 | idle/turn 内均按 session scope 解析 terminal-only，保留 `missing_start` | `work_item.completed/failed/killed` | Background agent | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 部分 | 无结构化 start/progress/kind，不把普通 task 猜成 agent 或 bash |
| Claude nested transcript | 否 | Claude extension | subagent-transcript、parentToolUseId | text/thought/tool/content/usage 已归属 child | `agent.message_chunk`、`agent.thinking`、`tool.progress`、`usage.updated` | Agents transcript | 已填 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | child token 结构化归属已补 |
| terminal output/exit | 是 | 稳定 | terminal metadata/reverse callback | output/exit/signal/kill 已支持 | `work_item.output/completed/failed/killed` | Terminal/Background bash | 已填 | 已填 | 部分 | 部分 | 部分 | 部分 | 部分 | ordinary Bash 仍是 Tool |
| callback lifecycle | 是 | 稳定 | permission/fs/terminal/elicitation 与 MCP/extension callback | request/response/error/notification 已归一 | `callback.requested/completed/failed/notification` | Permission/File/Terminal/MCP | 已填 | 已填 | 部分 | 部分 | 部分 | 部分 | 部分 | NES/document client commands 不混入 callback；unknown method 保留 extension/raw |
| unknown extension | 是（扩展 envelope） | 稳定扩展机制 | namespace/method/payload | generic extension 已支持 | `vendor.event` 或 `raw.event` | Raw/vendor inspector | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 不自动映射 GUI lifecycle |

## 当前实现与剩余适配

已完成：additionalDirectories capability gate；session setup response `_meta` 保留；canonical `openma_event` SQL persistence 与 canonical-first replay（兼容旧 raw 并去重）；renderer native Agent/transcript/usage/Monitor host persistence 及 Electron 跨进程重启 replay；Claude、Codex、Cursor、Pi、OpenCode、Kilo、Kimi 七个 harness 的真实/版本化 fixture manifest 与统一 canonical→GUI conformance runner。Claude fixture v2 覆盖 ACP 0.64.2 / 实际依赖 SDK 0.3.220 的 Agent progress、terminal-only usage、Monitor tool identity、真实 `local_bash` start、`background_tasks_changed` REPLACE、terminal 和 delivery，并已对照最新 SDK 0.3.222；Cursor fixture v2 覆盖 `create_plan` 双投影、todo stable-id replace/merge、`cancelled` 与 SQL/restart replay；Pi fixture v2 覆盖 provider `running/queueDepth` 和 warning/error notice；OpenCode/Kilo fixture v3 覆盖 optional foreground、resume `task_id`、provisional/reidentify、background running→missing-terminal、load/replay synthetic terminal，以及真实 `todowrite` tool snapshot → canonical Plan → SQL/restart replay；Kimi fixture v2 覆盖 idle terminal-only completed/failed/killed/lost/timed-out。available command catalog/invocation、permission、elicitation、Stop/cancel、steering、callback 与 Pair relay 均已有 canonical 输入事实和 lifecycle-specific 回归。

仍需：Claude Monitor 没有 direct GUI Stop。plugin command Monitor 没有普通 tool result 时，公开 start/level 的 `local_bash` 在首次 delivery 之前仍无法与后台 Bash 区分；首次真实 XML delivery 到达后已用稳定 `<task-id>` 结构化收敛，WebSocket `monitor_ws` 可从 start/level 直接识别。`task_progress` 只按稳定 `task_id` 更新 work item，不能把未带 `subagent_type/task_type` 的进度猜成 Monitor。OpenCode/Kilo live ACP 不转发后台 synthetic user terminal，因此实时 GUI 在父 turn 后诚实显示 `missing_terminal`；只有 load/replay 的带 audience envelope 能恢复 definitive terminal。其他 harness 仍等待等价结构化证据。NES/document 等到 Desktop 有明确 editor owner/facade/IPC 后再接，当前不伪造 callback/raw。七个版本化 fixture 已覆盖 capability、commands、mode/config、plan、usage、session status、terminal/background、callback、native-agent 九个维度；升级版本时必须更新正/负证据并重跑 conformance。Stop/tool cancellation、terminal metadata bookend、晚到 update、cancelled PromptResponse、Plan update 可见性和 steering input identity 已有 lifecycle-specific 测试；duplicate `event_id` 已在 SQL 边界幂等，跨 desktop 重启的 canonical `seq` 已从持久化最大值续写。

验收门禁：

```text
cd /Users/minimax/oos-proj/openma/openma-common && pnpm verify
cd /Users/minimax/oos-proj/openma/openma-desktop && pnpm typecheck && pnpm test && pnpm build
```
