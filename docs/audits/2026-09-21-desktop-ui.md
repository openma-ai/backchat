# Backchat 桌面 UI 审查 · 2026-09-21

## 实现一致性结论

**本轮审查和定向整改已完成；这不等于全部平台的发布认证。** 修复集中在点击命中区域、项目与草稿状态、批注生命周期、原生子任务事件合并、共享流式渲染和设置入口成本。保留现有视觉语言，没有整体重写。

范围：Electron 桌面主界面、侧栏、项目/workspace 选择、会话与历史加载、批注、设置外壳与活动页；1280×800 和应用允许的 720×800 窗口，浅色/深色模式。包含本机实际窗口观察、隔离 Electron UI 测试、源码审查和 Impeccable detector。不是全部页面的 WCAG 认证，没有硬件触控板事件录制。新增了隔离 Electron 的导航、输入延迟和 Long Task 测量；这不是生产长会话的完整性能 trace。

PRODUCT.md 的产品原则是安静、精确、响应及时，保持空间连续性。本轮遵循现有风格；仓库没有根 DESIGN.md，本轮没有补写设计规范或改变产品风格。context 工具只列出 packages 子项目，但用户明确指向 Backchat 桌面，因此审查目标是根目录 src/renderer，而非任一子包。

## 健康评分

评分是本轮覆盖范围的工程判断，不是自动跑分。

| 维度 | 分数 / 4 | 证据与限制 |
| --- | --- | --- |
| 可访问性 | 3 | 采样设置页无无名按钮；紧凑控件恢复 focus-visible 轮廓并通过键盘回归；未做全部对比度认证 |
| 性能 | 3 | 设置子页拆包，主入口减少约 7%；隔离流式输入 P95 约 8 ms；真实超长会话和冷磁盘启动仍需持续测量 |
| 响应式 | 3 | 两档窗口尺寸无 document 横向溢出；活动网格依赖内部横滚，不能把 document 检查等同所有内容均可见 |
| 主题 | 3 | 使用真实 settingsPatch 切换主题后 token 正确更新；尚未逐控件计算全部主题对比度 |
| 实现一致性 | 3 | 完整 session-store 与原生适配器测试通过；项目、批注、侧栏、加载均有交互回归 |
| **合计** | **15 / 20** | **覆盖范围内完成整改，保留明确验证限制** |

基线记录 10 项：P0 0，P1 4，P2 6，P3 0。9 项完成针对性整改与验证；第 6 项配置已修，原生首击和硬件触控板仍未完成实测。性能问题仅声明本次量到和降低的成本，不宣称所有卡顿消失。

## 已确认并修复的既有请求

### 1. [P1] 行高与可点击区域不一致

- 位置：`src/renderer/src/components/shell/Sidebar.tsx:1026`，workspace 和会话行同类结构。
- 类别：交互 / 可访问性。
- 证据：容器有固定行高，原按钮高度仅包住内容；整行 hover，文字上下留白却不触发。
- 影响：鼠标或触控板轻点落在留白时没有动作，用户误以为要点两次。
- 修复：按钮撑满行高并提供键盘焦点轮廓。
- 验证：UI 测试断言按钮高与行高一致，并在距按钮顶部 2px 位置单击展开。
- 后续命令：`$impeccable harden`，扩展相同命中区域契约至其他行型组件。

### 2. [P1] 纯批注发送后缺少可见内容

- 位置：`src/renderer/src/lib/session-store.ts` 的 registerTurn、两条历史回放分支；`src/renderer/src/components/chat/ChatTurn.tsx`。
- 类别：实现一致性。
- 证据：持久化 prompt 含 annotations，但 Turn 未保存该字段；空正文回放时没有可见的用户内容。新增回放用例修改前失败。
- 修复：保留实时与历史 annotations；展示引用原文和 comment，不改变请求协议或轮次结束规则。
- 验证：回放单元测试，以及批注-only 历史的 Electron UI 测试通过。
- 后续命令：`$impeccable harden`，继续覆盖队列、重载和多种上下文附件组合。

### 3. [P1] 最近项目恢复了旧 checkout 路径

- 位置：`src/renderer/src/components/chat/ComposerProjectControls.tsx:88`；`src/renderer/src/lib/composer-project-paths.ts:15`。
- 类别：实现一致性。
- 证据：localStorage 旧值原来优先且不校验；缺失 workspace 元数据的托管 checkout 会被当作普通项目。
- 修复：旧值必须存在于当前候选集合；候选包含普通历史目录和保存项目；过滤 `.oma/worktrees` 路径，失效值删除并回退候选。通过“浏览”明确选择的新目录会保存到项目列表，再更新草稿，使侧栏和后续新会话都能找到它；取消目录对话框不创建项目。
- 验证：缺失 workspace 元数据的 checkout 过滤用例修改前失败、修改后通过；workspace 新建会话仍保留父项目的 UI 回归通过。
- 限制：候选存在不等于磁盘目录存在；没有新增每次渲染时进行文件系统扫描的行为。
- 后续命令：`$impeccable harden`，统一侧栏和选择器的项目来源及失效处理。

### 4. [P2] 设置返回时侧栏从收起跳到展开

- 位置：`src/renderer/src/components/shell/Sidebar.tsx:74`、`:316`、`:410`。
- 类别：实现一致性 / 动效。
- 证据：原状态初始化为空 Set，再在 effect 内展开活跃项目。
- 修复：项目、workspace 收起标记、分区和本机分区从存储同步初始化；同一活跃会话不会在每次回到页面后重复自动展开。
- 验证：设置往返和页面重载的展开状态通过 UI 回归。
- 后续命令：`$impeccable harden`，把披露状态持久化机制统一到其他导航分区。

### 5. [P2] 无选中文字时残留批注操作栏

- 位置：`src/renderer/src/components/chat/ResponseAnnotations.tsx:122`。
- 类别：实现一致性。
- 证据：原逻辑仅监听消息区 mouseup/keyup，未监听全局 selectionchange。
- 修复：监听选区变化，在空选区、范围失效、外部点击/焦点移动及窗口失焦时清理；操作栏自身保留选择以完成批注操作。
- 验证：UI 用例先创建选区，清空全部 ranges 后操作栏消失。
- 后续命令：`$impeccable harden`，把跨组件临时 UI 与真实 DOM 选区生命周期对齐。

### 6. [P2] 非活跃 macOS 窗口的首击被用于激活

- 位置：`src/main/index.ts:216`。
- 类别：原生交互。
- 证据：安装版本 Electron 类型文档明确 acceptFirstMouse 在 macOS 默认 false；主窗口原来没有设置。
- 修复：启用 acceptFirstMouse。
- 状态：构建及隔离 Electron 启动通过。原生自动化不能可靠区分同一 Electron 包下的开发窗口与隔离测试窗口，未取得有效的失焦→首击结果；没有重启用户正在使用的开发主进程。硬件 trackpad tap 和首击行为仍待手工验证，不能宣称全部“轻点无响应”已解决。
- 后续命令：`$impeccable audit`，原生失焦→单击与前台轻点分别验证。

## 本轮完成的后续整改

### 7. [P1] 原生子任务事件与会话恢复

- 按 ACP v1 的 patch 语义核验：后续 tool update 可能只含状态和 `_meta`，原始输入来自之前的事件。
- 修复：Codex 适配器使用合并后的 logicalTool，保留拆分到达的任务、fork 和原始输入；原生 interrupted 信号在工具确认完成前不提前标记 cancelled。
- 纠正过期测试：正向原生子任务夹具提供结构化 `_meta.codex` 信息；保留“未知 harness / 只有工具名称不得生成子任务”的负向断言，没有恢复工具名猜测。
- 完整 session-store（106 条）、adapter（70 条）及相关 native/annotation 测试通过。两处真实实现缺陷与过期夹具分别处理。

### 8. [P2] 设置按需加载与性能证据

- 8 个设置子页使用 React.lazy，SettingsLayout/Sidebar 同步加载；Suspense 使用现有 skeleton。未延长历史 loader 的等待时间。
- 主入口从 4,557.46 kB 降至约 4,239 kB，约减少 7%，为未压缩构建大小。体积变化不能直接等同响应时间改善。
- 新增 `e2e/interaction-performance.spec.ts`：3 次 renderer reload，200 段历史、每 16 ms 注入一块格式化流式文本，同时输入 112 个字符；关闭 Playwright tracing，reload 后恢复真实动画。
- 最终一次记录：renderer reload 首屏 51.1–62.1 ms；设置 pointerdown 到外壳下一帧 7.2–12.6 ms；历史会话 pointerdown 到内容就绪下一帧 86.9–130 ms；流式输入事件到下一帧 P95 7.7–8.4 ms，最大 9.1 ms。完整采样阶段检测到 50、53、77 ms 的任务。原始数据见同目录 `2026-09-21-performance.json`。
- 这些是本机、缓存可能已热的隔离测量，不是冷磁盘进程启动，不包含硬件触控板采样，也不能外推至任意大型会话。仍然较大的主入口应继续按实际 trace 拆分，避免无证据重构。

### 9. [P2] 焦点可见性

- `.app-compact-control:focus-visible` 恢复 2px 轮廓及 2px offset；透明的 runtime 控件也能辨识焦点。
- 中文批注 UI 回归使用真实 Tab 激活键盘 modality，再检查 focus-visible、solid 轮廓及其宽度；Electron 115% 缩放下 CSS 计算值约 1.739px，测试按缩放后的有效轮廓检查。

### 10. [P2] 中文操作和读屏文案

- 批注工具栏、编辑器、录音/语音输入、样式控件和 Branch/Worktree 名称迁入 en/zh 翻译表。
- Electron 中文流程验证“添加到输入”、批注对话框和录制语音批注的名称；不只替换可见按钮。

## common 源码与消费关系

共享修改在 `../.worktrees/common-ui-quality`，基于 Backchat 实际依赖的 `d00d876c41a3e244c5f14f7d7ff145d957df7a7f`，没有改动较旧的 common 主目录或别人的协议 worktree。

- `src/agent-ui/react.tsx`：首块即时显示、按帧批量写入、根据积压调整速度，限制加速度及其变化，保留跨块状态；根据写入成本调整帧预算。末尾 flush、断流等边界不声称具有连续的物理加速度；这是一套有约束的自适应控制器，不是已证明全局最优的算法。
- `src/chat-ui/components.tsx`：嵌套过程分组默认收起，用户主动切换仍有效。
- `src/chat-ui/markdown.tsx`：提供类型化 rehypePlugins 扩展点，未传入时保留默认处理链。
- common 全部 359 条测试、类型检查和构建通过，包含速度/加速度变化边界、Unicode 和突发追赶测试。补齐静态资源测试缺失的 website.css 夹具。
- 匹配的 dist 及 source map 已生成；Backchat 的 `patches/@openma__common-ui@0.4.0.patch` 直接由这些源码构建产物生成，锁文件已同步。未提交、发布或更新远端 common 版本；正式发布仍需执行 common 的双消费端发布清单。

## Detector 核验

`impeccable detect src/renderer/src` 报 3 条：

- AppShell padding-left 过渡、CommandPalette height 过渡：确实改变布局，但有明确空间用途，不能仅凭属性名就断言掉帧。列入性能 profiling，不另计一个已证实故障。
- animate-bounce：**误报**。命中的是 reduced-motion 中禁用动画的选择器，不是新增 bounce 动效。

## 应保留的实现

- 主题通过完整 token 集合替换，不只切换 class；采样浅色正文 rgb(85,85,85)，深色正文 rgb(173,171,159)，实际主题切换得到不同值。
- 基础按钮、菜单、分区具备语义名称；设置采样未发现无名称按钮。
- 历史加载状态、首屏 loader、设置 skeleton 已有可运行 UI 回归。
- 工作区与源目录在数据模型中区分；新会话绑定 workspace 的现有测试仍通过。
- reduced-motion 已为部分动画提供静态替代，不应因为扫描器误报删除这些规则。

## 验证与限制

- common：43 个测试文件、359 条测试通过；typecheck/build 通过。
- Backchat：259 条 renderer 状态/交互单元测试、94 条 main 文件/工作树/会话测试、额外 2 条项目控件测试通过；web/node 类型检查及生产构建通过。
- Electron：项目/工作区选择与父项目归属、最近项目及显式不选择、批注-only 历史与选区清理、中文文案与键盘焦点、设置 lazy/skeleton、首屏 loader、历史分页锚点、流式尾字及突发追赶、目录链接打开文件管理器、两档窗口与两主题检查。
- Electron 组合检查 17 项通过；另 1 项 workspace 注入测试暴露 reload 就绪竞争，修正 helper 等待后关闭 tracing 连续 3 次通过（共覆盖 18 个不同用例）。不能把测试启动时序修复称为产品性能提升。
- Native 首击仍为明确的手工验证项；未做全仓所有测试、所有页面 WCAG 审核、所有主题对比度测试或生产长会话性能认证。
- 工作区中的既有未提交修改保留，本轮没有提交或推送。报告与 common 源码均可直接审阅。

## 后续性能优化 · 增量装饰与长历史

- common 新增 `decorateNodes` 扩展点：同步消费 parser 写入产生的 DOM mutation，只将新增元素或 href 变更的元素交给宿主；普通文本追加不调用装饰器。旧 `decorate` 保持兼容。Backchat 的文件链接、favicon 装饰已切换到增量接口。
- 回归先失败后通过：已有 100 个链接时追加纯文字，装饰回调为 0 次；追加新链接只访问新子树，旧链接保留。避免了原本每批文本对整段回答执行两次 querySelectorAll。
- 超过 20 轮时，已结束且不在最后两轮的消息启用 `content-visibility: auto` 与浏览器记忆的 intrinsic size。活动轮次完整渲染；保留原 DOM、展开状态、选区及批注。此方案降低离屏布局/绘制，不回收 DOM，也不宣称降低长历史的全部解析成本或内存占用。
- 修复首屏 settle 与用户操作竞争：收到 wheel、touchmove 或 keydown 后立即停止自动钉住底部和自动跟随；之前用户已经滚动，代码仍会把视图拉回底部。120 轮历史 E2E 在修改前跳转失败，修改后通过；24 次首尾快速跳转后原选区仍完整，批注入口正常。
- 核查 session-store 后保留现有订阅机制：普通文本流已有独立通道，后续文字块会提前 return，不逐块触发全局 emit。没有在缺少 Profiler 证据时重写订阅体系。
- common 360 条测试、typecheck/build 通过；Backchat 29 条定向单测、14 条 Electron 用例、web 类型检查和构建通过。common 的编译产物通过同一补丁机制接入。
- 新测量数据在 `2026-09-21-incremental-performance.json`。三轮流式输入到下一帧 P95 为 7.5–8.3 ms，最大 15.7 ms；200 段单轮历史切换为 93.7–209.6 ms，第一轮有较大波动。与上一轮相比没有足够证据宣称整体延迟显著下降；本次确认的是全量重复扫描被消除、离屏布局确实被跳过，以及滚动争抢被修复。
