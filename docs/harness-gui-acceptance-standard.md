# Harness GUI 严格验收标准

本标准是 Backchat `GUI feature × harness` Goal 的验收契约。覆盖的 harness 是
Claude、Codex、Cursor、Pi、OpenCode、Kilo、Kimi Code。Kimi 一列必须使用
`@moonshot-ai/kimi-code` / `kimi acp`；旧 `kimi-cli` 不得作为运行时、fixture 或
验收结论。旧版 9 项聚合矩阵已撤销，不得继续作为验收依据。

## 判定等级

- `PASS-LIVE`：真实 harness 进程、真实 provider、真实用户操作触发，并通过真实
  Electron GUI 的可见断言。只有此等级能证明端到端可用。
- `PASS-REPLAY`：来自指定 harness/version 的真实捕获 trace，经当前 main/preload/
  renderer 链路重放后通过可见断言。只证明事件投射，不得冒充真实 harness 调用。
- `FAIL`：产品声称支持或 trace 已发出，但 GUI 断言失败。
- `BLOCKED`：安装、认证、provider、进程启动或环境阻塞。不得计入通过。
- `UPSTREAM-GAP`：harness 已声明该 capability，或当前版本已有对应结构化事件契约，
  但实际事件/adapter/GUI 链路缺失。它不得显示为产品“通过”。
- `N/A`：当前 harness/version 没有声明或实现该 capability。必须附 initialize capability、
  官方协议或当前版本源码/trace 依据；不计入通过率，也不阻塞 Goal。不得为了填矩阵
  制造 capability。

fixture 存在、协议事件存在、日志、数据库行、测试说明浮层、合成标注、空白界面、
截图外的文字说明，都不是 GUI 通过证据。

## GUI feature registry

### Session、history 与 workspace

1. `session.initialize-ready` — initialize/session ready、Agent 名称与版本、能力 gate。
2. `session.new-workspace` — 新会话、cwd、project/workspace、additional directories。
3. `session.load-history` — provider load 后的历史消息、工具与状态。
4. `session.resume` — provider resume 后的连续上下文与当前状态。
5. `session.fork-side-chat` — fork、Side chat 父子关系、上下文继承。
6. `session.side-chat-promote` — Side chat 提升为独立主会话并清除 side-parent。
7. `session.close-terminated` — close/terminated 后的不可运行状态。
8. `session.local-archive-delete` — 本地 archive/delete 与 provider delete 语义分离。
9. `session.restart-replay` — Electron 重启后的 canonical transcript/work item replay。

### Composer 与输入

10. `input.prompt-text` — 用户 prompt 输入、发送与用户气泡。
11. `input.image-attachment` — 图片附件 chip、预览与发送。
12. `input.resource-context` — embedded resource/context/file attachment。
13. `input.session-reference` — 会话引用与 response annotation。
14. `input.available-commands` — Slash commands listbox、具体命令与调用。
15. `input.mode` — mode 控件、选项与当前值。
16. `input.config-model-reasoning` — model、reasoning/thought level、boolean/select config。
17. `input.cancel-stop` — 运行中的 Stop 与取消后终态。
18. `input.steering` — negotiated steering 的追加消息与投递状态。
19. `input.queue` — 不支持 steering 时的排队消息、顺序与占位。

### Chat、turn 与 agent 输出

20. `output.streaming-response` — 真实增量文本和运行态。
21. `output.final-response` — 完整最终回复可见，Thinking/运行态结束。
22. `output.thinking-reasoning` — thought/reasoning 内容、折叠与终态。
23. `output.notice-warning-error` — warning/error/system notice 不伪装成普通回复。
24. `output.tool-start-input` — Tool 名称、输入与 started 状态。
25. `output.tool-progress-output` — Tool 增量输出/progress。
26. `output.tool-terminal` — completed/failed/cancelled、结果与错误。
27. `output.plan-document` — plan markdown/document 内容。
28. `output.task-list-progress` — task/todo 文本、状态、完成数与进度。
29. `output.usage-parent` — 父会话 token/context/cost 的具体数值。
30. `output.session-status-goal-queue` — running/idle、goal、title、queue depth。

### Reverse callback 与交互请求

31. `callback.permission` — 权限标题、原因/命令、选项、允许/拒绝与结果。
32. `callback.filesystem` — 文件路径、读写审批与结果。
33. `callback.terminal` — terminal callback、terminal id、输出/退出信息。
34. `callback.elicitation-form` — 表单字段、验证、提交/拒绝与结果。
35. `callback.elicitation-url` — 完整 URL/host、consent、complete notification。
36. `callback.mcp-extension` — MCP/extension callback 的请求、结果与错误展示。

### Terminal、background、resources 与 native agents

37. `runtime.foreground-terminal` — 前台 terminal 输出、退出码、失败/取消。
38. `runtime.background-work` — Background 条目、状态、输出与终态。
39. `runtime.claude-monitor` — Monitor 身份、活动事件、missing-terminal 语义。
40. `runtime.resources` — Sources、Files、Outputs 资源栏及对应内容。
41. `agent.native-list-lifecycle` — 子 Agent 创建、身份、running/terminal 状态。
42. `agent.native-detail` — Agents 入口、详情页与父子/层级关系。
43. `agent.native-transcript` — 子 Agent prompt、消息、thinking、tool transcript。
44. `agent.native-final` — 子 Agent 最终结果与 terminal/unknown/missing-terminal 状态。
    child usage 不属于本矩阵的强制验收项；父会话 usage 仍由 feature 29 验收。
45. `runtime.vendor-raw` — 未识别 extension/raw 进入检查面，不被猜成既有 GUI 语义。

## 每个矩阵单元格必须保存的证据

每个 feature × harness 单元格必须包含：harness/version、feature id、验证等级、
真实触发动作或 trace id、可见 locator、预期文本/状态、实际文本/状态、断言结果、
无遮挡截图、运行时间、provider/model（不得含密钥）、失败/阻塞原因和协议/版本依据。

`PASS-LIVE`/`PASS-REPLAY` 必须满足 locator 可见且目标位于截图边界内。截图加载失败、
目标被浮层遮挡、只截到输入的 `/`、只截到 Thinking、只截到空白 Agents 面板，
一律判 `FAIL`。

## 完成门槛

1. `output.final-response` 对七个 harness 全部为 `PASS-LIVE`。
2. native subagent 各维度按 capability 判定：当前 harness/version 明确支持的维度必须
   以结构化事件覆盖；未声明的维度记 `N/A`，不阻塞。已声明却缺失才记
   `UPSTREAM-GAP`。仅 start fixture 不能证明 transcript 或 final。
3. 所有 45 × 7 = 315 个单元格都有结果和截图；不允许重复格掩盖缺格。
4. 发布目录只能由完整通过结构校验的 staging 原子替换；失败运行不得删除上一版。
5. HTML 必须公开等级、selector、预期、实际和错误；不得把 Replay 写成 Live。
6. 九个以上 feature 分组逐类人工抽查，破图数为 0，密钥泄漏数为 0。
