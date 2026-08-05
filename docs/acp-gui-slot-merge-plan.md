# OpenMA ACP 事件与 GUI 槽位合并计划

## 目标与边界

本目标把所有能获得的 ACP 原生输入/输出、各 harness adapter 的结构化 metadata，以及 OpenMA 自己的生命周期，统一走：

`ACP / ACP 扩展 → per-harness ACP adapter → OpenMA canonical event → 现有 GUI 槽位`

不改变 GUI 的布局和槽位。GUI 不解析 Claude、Codex、Pi、OpenCode、Kilo、Cursor、Kimi 的 `_meta`，只消费 OpenMA canonical event；无法证明生命周期含义时保留 `vendor.event` 或 `raw.event`，并使用 `unknown` / `work_item.missing_terminal`，不猜测完成。

## 版本基线（本轮核查）

| 组件 | 版本 | 备注 |
|---|---:|---|
| ACP SDK | 1.3.0 | 本地 schema/types 与官方 v1 文档核对 |
| Claude ACP | 0.64.2 | 实际依赖 Claude Agent SDK 0.3.220 |
| Claude Agent SDK | 0.3.222 | npm 最新版本；Claude ACP 尚未升级到该版本 |
| Codex ACP | 1.1.9 | 本地 adapter/metadata 核对 |
| Pi ACP | 0.0.33 | 本地 adapter/metadata 核对 |
| Kimi Code | 1.49.0 | Kimi ACP 文档与 notification 格式核对 |
| OpenCode | 1.18.13 | 2026-08-05 registry 最新；Task/ACP source 已核 |
| Kilo | 7.4.20 | 2026-08-05 registry 最新；Task/ACP source 已核 |
| Cursor | 2026.07.23 | Cursor ACP 扩展核对 |

`elicitation/create` 与可选的 `elicitation/complete` 已于 2026-07-24 成为 ACP 稳定协议；`session/resume`、`session/list/delete/close/logout` 也按当前官方文档视为稳定。`plan_update/plan_removed`、`session/fork`、providers、NES/document、MCP-over-ACP 仍按 SDK/RFD 标为实验或不稳定。

兼容边界另外接受 ACP v2 draft 的 complete `user_message`、`agent_message`、`agent_thought` 和 `state_update`（running/idle）更新：它们投影到现有 user/message/thinking/session 状态槽位；v2 agent-owned terminal update 尚未在当前 v1 transport 中启用，收到时保留 raw evidence，不假装已经协商了 v2 能力。

## 分层原则

| 层 | 责任 | 禁止越界 |
|---|---|---|
| ACP / ACP 扩展 | 标准方法、`session/update`、reverse callback、扩展 request/notification、`_meta` | 不决定 OpenMA 的 Background、Agent tree 或 Monitor 语义 |
| per-harness adapter | 读取 capability 和已确认 metadata；翻译输入命令和输出生命周期；保留 raw/vendor | 不引用 React 组件，不按 GUI 名称判断工具含义 |
| OpenMA canonical event | 稳定 envelope、来源、关联、顺序、生命周期、幂等 reducer | 不暴露 harness 工具名作为跨 harness 语义 |
| GUI | 把 canonical event 投影到现有聊天、Activity Dock、Agents、Background、Permission、Command、Usage 槽位 | 不读取 harness `_meta`，不从自然语言猜 task id 或终态 |

OpenMA canonical event envelope 是 `oma.event.v1`，核心字段为 `event_id`、`type`、`session_id`、`turn_id`、`work_item_id`、`parent_id`、`source`、`occurred_at`、可选 `seq`、`data`、`raw`。main 侧 enricher 为标准 ACP 更新加 per-session `seq`，canonical 事件会随 IPC 传输并由 SessionStore 消费；同一事件的 ACP/adapter 原始证据保留在 `raw`。canonical envelope 已作为 `openma_event` 行写入 SQL，replay 优先以 canonical 为事实源，同时兼容旧 raw rows 并按 raw fingerprint 去重。renderer 派生的 native Agent/transcript/usage/Monitor 事件通过 host persistence API 回写 SQL，且已有 Electron 退出后重启 replay 回归。

## 现有 GUI 槽位

| GUI 槽位 | 统一语义 | 典型 canonical event |
|---|---|---|
| 主聊天 | 用户、agent、thinking 的文本和结构化内容 | `user.message`、`agent.message_chunk`、`agent.thinking` |
| Turn | 主回合排队、运行和终态 | `turn.queued`、`turn.completed`、`turn.failed`、`turn.cancelled` |
| Tool | 工具输入、进度、输出、错误和 client-side cancellation | `tool.started`、`tool.progress`、`tool.completed`、`tool.failed`、`tool.cancelled` |
| Plan/task-list | 聊天内计划步骤，不是后台任务 | `plan.updated`、`plan.completed`、`plan.removed` |
| Activity Dock | composer 上方一个 shell 内的独立 Plan、Monitor、Background 模块；最多直显三个模块 | `plan.*`、`monitor.event`、`work_item.*` |
| Agents | native/嵌套 agent 的层级、transcript、usage | `work_item.*`、`work_item.reidentified`、`usage.updated` |
| Background | 可独立观察的 agent、bash、other work item；Monitor 不再归入右栏 generic Background | `work_item.started/progress/output/completed/failed/cancelled/killed/terminated` |
| Command | harness 声明的可用命令 | `command_catalog.updated`，选择后发 OpenMA prompt command |
| Mode/config | mode、model、配置选项 | `capability.updated`、`session.started` 数据 |
| Usage/context | session 或 child work item 的 token/context 计量 | `usage.updated` |
| Permission/elicitation | agent 反向请求用户决定；typed form 与 URL consent 复用现有 ask sheet | `user.permission_response`、`user.elicitation_response`、`callback.requested/completed/failed/notification` |
| Terminal/file callback | ACP reverse RPC 的文件和终端能力 | `callback.*`、`tool.*`、`work_item.*` |
| Notice | 短暂系统提示，复用现有 composer notice | `system.notice` |
| Raw/vendor | 已识别但未统一，或完全未知的事件 | `vendor.event`、`raw.event` |

Plan 不进入 Background；普通 TaskCreate/TaskUpdate 只进入 Plan；普通 Bash tool 只有在 adapter 能证明后台语义时才进入 Background。

## 输入表

“输入”包含 OpenMA 发给 harness 的命令，以及 harness 通过 ACP reverse RPC 发给 OpenMA 的请求。`ACP 官方支持` 描述协议本身，`Harness 填槽` 描述当前桌面 adapter 是否把结果投影进现有槽位。

| 输入事件/命令 | ACP 官方支持 | 稳定性 | Harness/adapter 扩展 | Common runtime | OpenMA canonical / command | GUI 槽位 | Claude | Codex | Cursor | Pi | OpenCode | Kilo | Kimi | 缺口或边界 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `initialize` capability negotiation | 是 | 稳定 | 各 harness `_meta` 能力证据 | 已支持并保存完整 response | `session.started` / `capability.updated` | Mode/config、Commands、Usage、callbacks | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | GUI 不解释未知 `_meta`；只使用 adapter 已确认的能力 |
| `session/new` | 是 | 稳定 | Pi `sessionSetupMeta.piAcp.startupInfo` 等 response `_meta` | 已支持；仅 agent 声明 `additionalDirectories` 时发送 | `session.started` | Session、Workspace | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | setup metadata 与 canonical `session.started` 均可持久化和 replay |
| `session/load` | 是 | 稳定（兼容 legacy load） | harness setup metadata | 已支持 | `session.started` | Session、历史恢复 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 缺少 setup metadata 的 harness 只能返回 null |
| `session/resume` | 是 | 稳定 | setup response metadata | 已支持并优先于 load | `session.started` | Session、历史恢复 | 已填 | 已填 | 部分适配 | 部分适配 | 已填 | 已填 | 已填 | Cursor/Pi 当前版本未声明 resume；fallback 到 load/new 不伪造 provider resume 成功 |
| `session/fork` | 是 | 实验/不稳定 | fork response metadata | 已支持 capability gate | `session.started`（fork capability） | Side chat / inherited context | 已填 | 未填 | 未填 | 未填 | 已填 | 已填 | 未填 | Claude/OpenCode/Kilo 当前版本声明 fork；fork 是 context seed，不等于 native subagent lifecycle |
| OpenMA prompt → `session/prompt` | 是 | 稳定 | available command 选择默认转 prompt | 已支持文本、图片、结构化 content block | `user.message`；结果由 `agent.*` / `turn.*` 表示 | 主聊天、Turn | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 不把 command picker 伪造成 ACP 新方法 |
| Stop → `session/cancel` | 是 | 稳定 | Claude TaskStop、Codex close/steer、terminal kill | 一次 Stop 只发送一次 cancel；立即取消当前 turn 未完成 tool；仍接收 PromptResponse 前的晚到 tool update；`stopReason:cancelled` 落到 cancelled 终态 | `user.interrupt` + `tool.cancelled` + `turn.cancelled`，或独立 `work_item.killed` | Stop、Tool、Background | 部分适配 | 已填 | 部分适配 | 已填 | 已填 | 已填 | 部分适配 | `tool.cancelled` 是 client 派生语义，不是 ACP wire ToolCallStatus；Claude Background Bash 当前 `canStop:false` |
| Steering → `_session/steering` | 否（ACP 扩展） | 实验/厂商扩展 | Claude/Codex `_meta.steering` | 已支持 negotiated steering 与 outcome | `user.message`（steering input）+ `session.steering` | Composer、Turn | 已填 | 已填 | 未填 | 未填 | 未填 | 未填 | 未填 | 只能作用于当前 ACP session/turn，不提供 subagent 定向发信 |
| `session/set_mode` | 是 | 稳定兼容层 | harness mode metadata | 已支持；优先 config option，兼容 legacy modes | `capability.updated` / `session.started` modes | Mode/config | 已填 | 已填 | 部分适配 | 已填 | 已填 | 已填 | 已填 | 只在 capability 或返回 modes 有证据时显示 |
| `session/set_config_option` | 是 | 稳定 | harness-specific option values | 已支持 select/boolean | `capability.updated` | Model、mode/config | 已填 | 已填 | 部分适配 | 已填 | 已填 | 已填 | 已填 | free-form value 不在 GUI 中猜 schema |
| Command picker selection | 否（OpenMA command） | OpenMA 稳定 | harness 声明 catalog；Codex `_meta.commandAction` 是展示/adapter 行为提示 | runtime 发普通 prompt；host 记录选择事实 | `user.message` + `input_kind:"command"`；command/args 保留结构化字段 | Command palette；不新增聊天气泡 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | ACP wire 仍是文本 prompt；例如 `/plan` 由 Codex adapter 收到 prompt 后调用 `setConfigOption`，GUI 不绕过 ACP |
| `session/list` | 是 | 稳定 | providers/session metadata | Common API 已支持；Desktop SessionManager/IPC 未接 | 尚无 canonical input command | 无；本地 sidebar 是 OpenMA SQL session list | 未填 | 未填 | 未填 | 未填 | 未填 | 未填 | 未填 | 不能把本地 session list 当作 provider session/list |
| `session/delete` | 是 | 稳定 | — | Common API 已支持；Desktop delete 只删除 OpenMA 本地 session | 尚无 provider delete canonical input | 本地 Session list（不同语义） | 未填 | 未填 | 未填 | 未填 | 未填 | 未填 | 未填 | provider delete 不等同 GUI archive/delete |
| `session/close` | 是 | 稳定 | — | 已支持，dispose 前按 capability 优先 close | `session.terminated` | Session lifecycle | 已填 | 已填 | 未填 | 未填 | 已填 | 已填 | 未填 | Cursor/Pi/Kimi 当前版本未声明 close；close 失败仍需安全 kill child |
| `logout` / providers | 是 | 稳定 logout；providers 实验 | provider selection metadata | Common API 已支持；Desktop 未暴露 command | 尚无 canonical input fact | Auth、Mode/config 尚未接 provider control | 未填 | 未填 | 未填 | 未填 | 未填 | 未填 | 未填 | capability evidence 会保留，但 GUI 未调用 provider API |
| Permission response | 是 | 稳定 | 各 harness permission metadata | main/per-harness callback adapter 先归一 `title/kind/reason/command`，broker 再交给 GUI；原 tool metadata 仅作 callback/raw 证据 | `user.permission_response` + `callback.completed/failed` | Permission | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | GUI 不读取或写入 harness `_meta` |
| `fs/read_text_file` / `fs/write_text_file` | 是 | 稳定 | path policy adapter | 已支持 callback broker | `callback.requested/completed/failed` | File callback、Tool | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 权限策略是 OpenMA 本地策略 |
| `terminal/create` | 是 | 稳定 | terminal metadata | 已支持 callback broker | `callback.requested`，后台时 `work_item.started` | Terminal、Background bash | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | terminal callback 不自动等价后台 task |
| `terminal/output` / wait / kill | 是 | 稳定 | `_meta.terminal_*`、退出码 | 已支持输出、退出、kill | `callback.*` + `work_item.output/completed/failed/killed` | Terminal、Background bash | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | foreground terminal 仍保留 Tool 槽位 |
| `elicitation/create` / complete | 是 | 稳定（SDK legacy 名仍 unstable） | harness form schema、URL、elicitation/complete | form 六类 typed field 已复用现有 ask sheet并按 schema 校验；URL 显示完整 target/host，明确 consent 后才交给 OS 外部浏览器；complete 按同连接 outstanding id 去重 | `user.elicitation_response` + `callback.requested/completed/failed/notification` | Permission/elicitation | 部分适配 | 部分适配 | 部分适配 | 部分适配 | 部分适配 | 部分适配 | 部分适配 | OpenMA form/URL 生命周期已填；“部分”仅表示各 harness 是否实际发出该请求 |
| MCP-over-ACP callbacks | 否（扩展） | 实验 | `mcp/connect/message/disconnect` | 已支持 generic request/notification | `callback.*` | MCP app / raw inspector | 部分适配 | 部分适配 | 未填 | 未填 | 未填 | 未填 | 未填 | 不把 MCP notification 伪造为 assistant message |
| NES/document commands | 否（扩展） | 实验 | `nes/*` request、`document/*` notification | Common typed API 已支持；Desktop 没有 facade/IPC | 尚无 canonical input fact | Source/editor 未接 | 未填 | 未填 | 未填 | 未填 | 未填 | 未填 | 未填 | 这是 client→agent API，不是 reverse callback；缺少可靠 editor owner 时不伪造事件 |
| Claude SendMessage to child | 否 | 无公开 ACP 输入 | Claude Code 内部 tool 语义 | 不支持 host 定向输入 | 不生成 canonical input | 无专用槽位 | 未填 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不能把主 agent 的 steering 误称为 subagent message |

## 输出表

| 输出事件 | ACP 官方支持 | 稳定性 | Harness/adapter 扩展 | Common runtime | OpenMA canonical event | GUI 槽位 | Claude | Codex | Cursor | Pi | OpenCode | Kilo | Kimi | 缺口或边界 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `session.ready` / setup response | 是 | 稳定 | response `_meta`（Pi startupInfo 等） | 已保留 initialize、setup metadata、capabilities | `session.started` | Session、Mode/config、Commands | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | setup metadata 随 canonical `session.started` 持久化并可 replay |
| `agent_message_chunk` | 是 | 稳定 | Pi notify、Claude nested parent id、Codex phase | 已解析文本、content、message id、adapter meta；Codex `commentary/final_answer` 已提升为中立的 canonical `data.phase` | `agent.message_chunk` 或 `system.notice` | 主聊天或 Notice；有 parent 时 Agents | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | GUI 只读取 `data.phase`，不读取 `_meta.codex`；相同 chunk 由 main enricher 加 seq 保证 canonical id 不重复 |
| ACP v2 `user_message` / `agent_message` / `agent_thought` | 是（v2 draft） | draft | complete message upsert、content replacement、messageId | 已接受并保留 content block 与 message id | `user.message`、`agent.message`、`agent.thinking` | 主聊天、thinking；有 parent 时 Agents | 部分适配 | 部分适配 | 部分适配 | 部分适配 | 部分适配 | 部分适配 | 部分适配 | 当前 session transport 仍以 ACP v1 为主；v2 state/terminal update 继续 raw |
| `agent_thought_chunk` | 是 | 稳定 | Claude nested thinking、Codex thought phase | 已解析并保留 parent/metadata | `agent.thinking` | 主聊天 thinking 或 Agents | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | unknown thought extension 进 raw |
| `tool_call` | 是 | 稳定 | `_meta.claudeCode`、`_meta.codex`、terminal metadata | 已解析 input/status/parent/tool name | `tool.started` | Tool；Task schema 再进入 Agents/Background | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | tool 名称本身不制造后台生命周期 |
| `tool_call_update` | 是 | 稳定 | terminal delta、Claude toolResponse、OpenCode/Kilo Task output | 已合并 logical tool、输出和终态；Stop 后晚到 update 继续接收 | `tool.progress/completed/failed`；client Stop 另发 `tool.cancelled`；native Task 另发 `work_item.*` | Tool、Agents、Background | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | cancelled 不伪造成 ACP wire status；不结构化猜测 provider 私有终态 |
| ACP `plan` | 是 | 稳定 | harness plan representation | 已解析 items/markdown | `plan.updated` | Plan/task-list | 已填 | 已填 | 已填（Cursor 扩展） | 未发出 | 未发出 | 未发出 | 已填 | Pi/OpenCode/Kilo 当前版本没有 plan emitter；Plan 与 Background registry 分离 |
| `plan_update` / `plan_removed` | 是（SDK v1 extension） | 实验/不稳定 | harness plan metadata | 已保留并归一 | `plan.updated` / `plan.removed` | Plan/task-list | 部分适配 | 部分适配 | 未填 | 部分适配 | 部分适配 | 部分适配 | 部分适配 | 官方状态仍不稳定，不能视为全 harness 保证 |
| Cursor `create_plan` / `update_todos` | 否 | Cursor 2026.07.23 扩展 | Markdown + todos + optional phases；stable todo id + merge boolean | 文档与任务同时归一；replace/merge 由 canonical reducer 处理；cancelled 保真 | `plan.updated` + `update_mode` | 现有 Plan document + task-list | 不适用 | 不适用 | 已填 | 不适用 | 不适用 | 不适用 | 不适用 | phases 留在 raw；不增加 phase 分组布局 |
| OpenCode/Kilo `todowrite` | 否（普通 ACP tool transport） | harness 版本语义 | 精确 `todowrite` tool identity + typed `rawInput.todos` 完整快照 | per-harness adapter 只接受精确工具 schema，按 ACP Plan 的整表语义归一为 replace | `plan.updated` + `update_mode:replace` | 现有 task-list | 不适用 | 不适用 | 不适用 | 不适用 | 已填 | 已填 | 不适用 | harness 不发 ACP `plan`；GUI 不解析 tool `_meta`/raw input，相似 tool 不识别；已覆盖 host→SQL→restart replay |
| `available_commands_update` | 是 | 稳定 | harness command catalog | 已替换式保存完整列表 | `command_catalog.updated` | Command palette | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 调用仍使用普通 prompt command |
| `current_mode_update` / config update | 是 | 稳定 | mode/config metadata | 已保存并更新 session row | `capability.updated` | Mode/config | 已填 | 已填 | 部分适配 | 已填 | 已填 | 已填 | 已填 | 不把 legacy modes 当新事件类型 |
| `usage_update` | 是 | 稳定 | Claude parent/child、Codex parent/child、OpenCode/Kilo parent usage | 已归一 parent/child usage | `usage.updated`；Claude total-only child usage 在 `work_item.progress` | Usage/context；child usage 进 Agents | 已填（child total-only 部分） | 已填 | 未发出 | 未发出 | 已填（parent） | 已填（parent） | 未发出 | 供应商成本字段只作 adapter metadata；没有结构化 usage 不估算 |
| `session_info_update` | 是 | 稳定 | Codex thread status/goal、Pi running/queueDepth；Claude/Cursor title metadata | 通用层只合并 session metadata；Codex adapter 解释 `threadStatus/goal`，Pi adapter 解释 `running/queueDepth` | `session.running` / `session.idle` / `capability.updated` | Session status、Goal、Notice；Pi queued placeholder | 仅 title metadata | 已填 | 仅 title metadata | 已填 | 未发出 | 未发出 | 未发出 | GUI 不读取 provider `_meta`；终态以 OpenMA turn lifecycle 为准；provider queue 不进入可编辑 prompt queue |
| Native Claude Agent/Task | 否（Claude adapter extension） | Claude ACP 不提供标准 SDK task event；可 opt-in raw SDK stream | `_meta.claudeCode.toolResponse.agentId/usage/progress`、`parentToolUseId`、`_claude/sdkMessage` | 已解析 nested transcript、usage、progress；raw task terminal 只使用实际字段 | `work_item.started/progress/completed/failed/cancelled/killed/missing_terminal` | Agents + Background agent | 已填 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | raw extension 不是 ACP 标准 lifecycle；缺失终态仍保持 unknown |
| Codex child/collaboration agent | 否（Codex adapter extension） | 扩展 | `_meta.codex.collaboration/subagent`、child thread | 已解析 spawn/wait/close、goal、child usage | `work_item.*`、`work_item.reidentified` | Agents + Background agent | 不适用 | 已填 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | provider thread 不等于 ACP 标准 subagent |
| OpenCode/Kilo foreground Task | 否（harness adapter extension） | 版本扩展 | optional `background`、resume `task_id`、rawOutput child session | omission 是前台；resume 直接使用稳定 child id；新任务 provisional → reidentified → terminal | `work_item.started/reidentified/completed/failed` | Agents（复用现有 side view） | 不适用 | 不适用 | 不适用 | 不适用 | 已填 | 已填 | 不适用 | 必须匹配完整 Task input schema；相似普通 think tool 不识别 |
| OpenCode/Kilo background Task | 否（harness adapter extension） | 版本扩展 | `background:true`、parent/session/model/jobId、synthetic `<task state>` | tool return 只证明 running；live ACP 不转发 synthetic user terminal，父 turn 后落 `missing_terminal`；load/replay 的 audience envelope 可恢复 terminal | `work_item.started/reidentified/missing_terminal/completed/failed` | Agents + Background agent | 不适用 | 不适用 | 不适用 | 不适用 | 部分适配 | 部分适配 | 不适用 | 不从后续自然语言猜终态；Kilo resumable hint 只作为 raw error 保留 |
| Kimi background notification | 否（Kimi extension） | 版本扩展 | 固定 title + Task ID/Status/Description/terminal reason/exit/failure 字段 | idle/turn 内均按 session scope 解析 terminal-only，`missing_start:true` | `work_item.completed/failed/killed` | Background agent | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 部分适配 | 未公开结构化 start/progress/kind，不能补造 agent/bash identity |
| Claude nested transcript | 否（Claude ACP extension） | 版本扩展 | `_meta.claudeCode.parentToolUseId` + subagent-transcript capability | 已解析 text/thinking/tool/content/usage | `agent.message_chunk`、`agent.thinking`、`tool.progress`、`usage.updated` | Agents transcript | 已填 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | child token 可归属，但 GUI 不解析 Claude meta |
| Terminal output/exit | 是（callback + session update evidence） | 稳定 | `_meta.terminal_*`、terminal reverse RPC | 已记录输出、exit code、signal、kill | `work_item.output/completed/failed/killed` 或 `callback.*` | Terminal + Background bash | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | Claude Background Bash 的 `canStop:false` 是诚实能力声明 |
| Claude `Monitor` | 否（Claude tool + raw SDK extension） | Claude Agent SDK 0.3.220（已核 0.3.222）/ Claude ACP 0.64.2 扩展 | `Monitor` tool response 的 `taskId` 是直接身份；command Monitor 的 SDK `task_type="local_bash"` 与后台 Bash 共用；WebSocket Monitor 为 `monitor_ws`；`origin:task-notification` user delivery 的 XML 含稳定 `<task-id>/<summary>/<event>` | Claude session opt-in `emitRawSDKMessages`；tool result 或 `monitor_ws` 直接分类；delivery 的结构化 task id 将同 ID generic `local_bash` 以 `work_item.classified` 收敛；idle 时 `turn_id:""` delivery 仍按 session scope 接收 | `work_item.started/classified/completed/failed/killed/missing_terminal` + `monitor.event` | Activity Dock / Monitor；原 Tool 仍保留；plugin command Monitor 首次 delivery 前暂在 generic Background，之后归入 Monitor | 已填（无 direct Stop） | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 禁止按 description 关联；GUI `canStop:false`；缺口是首次 delivery 前的短暂歧义与无 direct Stop |
| Claude `TaskOutput` | 否（Claude tool semantics） | Claude SDK tool；自 Claude Code 2.1.83 deprecated | 查询/等待既有 task output | 仅保留普通 Tool call/result | `tool.*` | Tool | 已填 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 它不是 Monitor delivery，也不创建 Activity Dock 模块；优先读 output file |
| Claude SDK task lifecycle / `task_notification` | 否（Claude ACP raw extension） | opt-in 版本扩展 | Claude ACP 默认内部消费；配置 `emitRawSDKMessages` 后以 `_claude/sdkMessage` 发出 | 已解析 `task_started/task_updated/task_progress/task_notification/background_tasks_changed`；level REPLACE 修复丢失 start，absence 仅产生可逆 `missing_terminal`；有 `subagent_type` 才进入 native Agent；terminal-only usage 先补 child progress 再终结 | `work_item.*`；Monitor user delivery 另为 session-scoped `monitor.event` | Agents、Activity Dock Monitor/Background | 部分适配 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | total-only usage 留在 progress payload；level/edge 顺序未定义，不从 absence 猜终态；不是 ACP `session/update` |
| `callback.*` lifecycle | 是（reverse RPC） | 稳定；elicitation stable | permission/fs/terminal/elicitation 与 MCP/extension callbacks | 已归一 request/response/error/notification | `callback.requested/completed/failed/notification` | Permission、Terminal、File、MCP/raw | 已填 | 已填 | 部分适配 | 部分适配 | 部分适配 | 部分适配 | 部分适配 | NES/document client commands 不混入 callback；GUI 只投影已知 category |
| unknown extension | 是（ACP extensibility envelope） | 稳定扩展机制 | vendor namespace/method/payload | generic request/notification 已保留 | `vendor.event` 或 `raw.event` | Raw/vendor inspector | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 未知事件不自动进入 Background/Monitor |

## GUI 槽位与 harness 填槽总表

| GUI 槽位 | Claude | Codex | Cursor | Pi | OpenCode | Kilo | Kimi | 当前结论 |
|---|---|---|---|---|---|---|---|---|
| 主聊天 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 标准 message/thought 与已知扩展都经过 canonical |
| Tool | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | Tool input/output 保留 raw 与 adapter metadata |
| Plan | 已填 | 已填 | 已填（Cursor 扩展） | 未发出 | 已填（`todowrite` adapter） | 已填（`todowrite` adapter） | 已填 | OpenCode/Kilo 没有 ACP Plan emitter，但结构化完整 todo snapshot 已在 adapter 层填入同一 canonical 槽位；不与 Background 合并 |
| Agents | 已填 | 已填 | 已填（lifecycle） | 未发出 | 已填（foreground） | 已填（foreground） | 未发出 | Claude 有 transcript；Codex/Cursor/OpenCode/Kilo 至少有结构化 lifecycle |
| Background agent | 部分适配 | 已填 | 未验证 | 未发出 | 部分适配 | 部分适配 | terminal-only 部分 | OpenCode/Kilo live terminal 不可见并落 missing_terminal；Kimi 只有 terminal |
| Background bash | 部分适配 | 已填 | 部分适配 | 部分适配 | 部分适配 | 部分适配 | 部分适配 | ACP terminal lifecycle 已填；provider 普通 Bash 不自动升级 |
| Activity Dock Monitor | 已填（无 direct Stop） | 未填 | 未填 | 未填 | 未填 | 未填 | 未填 | Claude 通过 opt-in raw SDK extension 填入；其他 harness 没有等价结构化 delivery |
| Commands | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | `available_commands_update` 进入 palette |
| Mode/config | 已填 | 已填 | 已填 | 已填 | 已填（setup） | 已填（setup） | 已填（legacy mode/model） | 仅显示 capability 有证据的控制 |
| Usage | 已填（child total-only 部分） | 已填 | 未发出 | 未发出 | 已填（parent） | 已填（parent） | 未发出 | parent 与 child usage 分开归属，不估算缺失值 |
| Session status | 仅 title metadata | 已填 | 仅 title metadata | 已填（含 queueDepth） | 未发出 | 未发出 | 未发出 | GUI status 槽位存在；只统计 provider 实际 session status emitter |
| Permission/elicitation | 部分适配 | 部分适配 | 部分适配 | 部分适配 | 部分适配 | 部分适配 | 部分适配 | form 六类 typed field 与 URL consent/complete 已复用现有 ask sheet；部分状态仅指 harness 是否发出请求 |
| Raw/vendor inspector | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 已填 | 未知扩展保留，不污染 GUI 语义槽位 |

## 剩余适配顺序

1. Claude Monitor 的 tool identity、真实 `local_bash`/`monitor_ws` start、REPLACE level、terminal、delivery 已接入；delivery 的稳定 XML `<task-id>` 会通过 `work_item.classified` 收敛 plugin command Monitor，specific Monitor kind 不会被 generic SDK start 降级，level absence 只显示 `missing_terminal`，晚到 definitive terminal 可覆盖。剩余缺口是 command Monitor 首次 delivery 前仍与 Bash 同为 `local_bash`，以及没有 direct GUI Stop command。`TaskOutput` 继续保持普通 Tool。
2. elicitation form 与 URL mode 已完整复用现有 Permission ask sheet；NES/document 目前只有 Common client API，Desktop 没有 editor owner/facade/IPC，因此不制造 callback/raw 假事件；若未来接入现有 File/Source owner，再补 canonical input fact。
3. Stop/tool cancellation、terminal metadata bookend、晚到 update、cancelled PromptResponse、Plan update 可见性和 steering input identity 已有 lifecycle-specific 回归；renderer→host→SQL→Electron restart replay 已覆盖 Monitor、Cursor stable-id todo merge，以及 OpenCode/Kilo `todowrite` replace snapshot。七个 harness 的版本化 fixtures 与统一 canonical→GUI conformance runner 已建立，并逐一覆盖 capability、commands、mode/config、plan、usage、session status、terminal/background、callback、native-agent 九个维度；未发出或无法验证的维度也保留版本化负证据。升级任一 harness 时必须更新 fixture 证据并重跑矩阵。canonical `event_id` 已由 SQL 幂等去重；canonical `seq` 已从持久化最大值跨 desktop 重启续写，并尊重 adapter 附带的更高序号。

## 验收口径

- 所有已适配输入和输出都有测试，且至少保留 raw/adapter metadata 证据。
- 事件没有结构化终态时不会长期伪装 `running`；显示 `unknown` 或 `missing_terminal`。
- OpenMA canonical event 是 GUI 语义入口；GUI 不按 harness 名称或 `_meta` 分支。
- `available_commands`、setup capabilities、usage、nested transcript、callback lifecycle 均能在对应槽位或 raw/vendor inspector 找到；Stop 必须产生单次 ACP cancel、`user.interrupt`、未结束 tool 的 `tool.cancelled` 和最终 `turn.cancelled`；steering 每条输入只有一个 canonical `user.message` 身份。
- canonical persistence/replay 已完成迁移；旧 raw rows 仅作为兼容证据，不能与 canonical envelope 重复回放。
