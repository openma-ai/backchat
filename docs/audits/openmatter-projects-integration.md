# Backchat Projects / OpenMatter 接入审计与实现

日期：2026-09-21。工作区：Backchat 与相邻 `OpenMatter` SDK。

## 已落地的边界

保留 OpenMA 核心，新增独立的 `@openmatter/project-worker`。它通过公开
managed Sessions API 调用 OpenMA，运行 SDK 的 `coordinatorLoop`；不修改
OpenMA 核心调度器。Backchat 本地版使用相同的 `@openmatter/project-host`，
执行仍由既有 `SessionManager` / ACP runtime 负责。

| 所有者 | 职责 |
| --- | --- |
| Backchat | Projects 页面、已有项目元数据、typed IPC、本地执行桥、云端路由 |
| OpenMatter Project host | 配置与 context、durable inbox 投递、coordinatorLoop、project controls |
| OpenMatter SQLite Store | Session/Turn/Reaction/Context/事件、幂等、lease 和 fencing |
| 独立 Projects worker | 常驻云端宿主、workspace 鉴权、MCP、远程 session/turn 适配与恢复 |
| OpenMA | 既有会话、agent runtime、工具执行、环境与权限 |

没有新增 `LoopRun`，也没有用 memory store 作为产品后端。项目历史来自已有
WorkEvent、Turn、Reaction 和 canonical event。项目 ID 映射 scope，业务任务 ID
映射 workerId，消息/命令 ID 提供幂等；隔离 run 是关联 ID，不是另一套状态机。

## 审计发现及处理

1. 原 SDK 仅有 memory OpenMatterStore；`inbox-sqlite` 只保存投递，不能代替
   orchestration facts。新增 `store-sqlite` 实现现有端口，支持文件或宿主连接、
   WAL/FULL、事务、数据库时钟、fencing、scope 查询与重开恢复。
2. Backchat 与 SDK 的 common revision 不同。未直接升级 Backchat common；
   本地薄 Driver 使用 SDK 的 canonical event 构造器，输入来自既有 SessionManager。
   SDK 依赖由自身解析。独立 Projects 测试配置避免跨 package symlink 的类型冲突。
3. inbox 与宿主元数据跨文件写入存在 crash gap。新增 inbox inspect；命令索引
   由 inbox 重建，避免已接受命令丢失于 UI 或 completed 命令永久显示 pending。
4. 远程会话创建缺少上游幂等契约。保存 creation intent + metadata key；响应
   不确定时先查找原会话，没有确定结果时保留错误，禁止盲目创建第二个会话。
5. 远程输入使用现有 Idempotency-Key；按输入确认 ID 和 thread 过滤输出，
   保持稳定 seq。子线程 idle、interrupt 输入确认都不作为父 turn 完成。

## Backchat 产品接入

- Sidebar 的 Projects 入口及列表/详情；保留既有目录项目与聊天入口。
- 项目名称、说明、instructions、context、文本资源、连续性和 controls；空闲时
  可删除项目，保留底层 SDK 历史与远程会话，有待处理工作时拒绝删除。
- 本地或云端位置；分别选择 coordinator/worker agent，云端另选 environments。
- 持续会话、worker 委派/steer/cancel、显式 complete 和基于事实的 activity。
- Worker 输出在项目中只读查看，避免从普通聊天入口绕开 SDK 的 turn 所有权。
- 云端凭证留在 main process；校验 worker origin/workspace。已开始工作的项目
  不自动迁移位置，云端连接失败不回退本地执行。

本地路径：`~/.oma/backchat/projects/projects.db` 与 `project-inbox.db`（随
现有 OpenMA storage root 配置变化）。云端使用独立 worker 的持久目录。

## 运行

先在相邻 SDK 执行 `pnpm install && pnpm build:projects`。然后在 Backchat：

```sh
pnpm install
pnpm typecheck
pnpm exec vitest run --config vitest.projects.config.ts
pnpm build
pnpm exec playwright test e2e/projects-work.spec.ts --workers=1
```

云端 worker 的环境变量、HTTP、部署与恢复说明见 SDK
`docs/PROJECTS_WORKER.md`。启动 Backchat 时设置 `BACKCHAT_PROJECT_WORKER_URL`，
登录对应的 OpenMA workspace，在新项目中选择 Cloud。未进行真实云端部署。

## 验证与限制

本地 Electron E2E 使用真实 SessionManager 和独立 fake ACP subprocess，覆盖
建项目、保存上下文、coordinator turn、worker 委派、结果反馈与页面重载。
云端使用真实 HTTP/MCP/SQLite，加外部 OpenMA 的 HTTP fixture，覆盖鉴权、
分页、重开读取、丢失响应与输入重放。未声称使用真实远程 agent 验证。

当前事实查询为 scoped snapshot，尚未分页；资源仅限文本；云端为 workspace
级访问，尚无细粒度项目 ACL 和交互式权限审批 inbox；未提供执行位置迁移。
本地进程中断后不会自动重复不可确认的 ACP prompt，会显示 interrupted。

已遵循 Backchat `AGENTS.md` 及 turn-lifecycle 文档。ACP session setup 和
prompt-turn 官方页面已核对；取消文档访问失败，未改造底层取消协议。工作区
原有的大量其他改动均保留，OpenMA 核心没有被本项实现修改。

## WorkThread 分支与工作目录

本地代码 worker 按 WorkThread 分配独立 branch + Git worktree，基准提交在首次
分配时固定；重启、后续 turn 和本地 session generation 更换复用目录，保留未提交
修改。普通目录复制到私有目录，coordinator 使用空白协调目录。项目编辑器可选
目录、基准分支，以及云端 GitHub 仓库；worker 卡片显示分支与目录/远程会话。

OpenMatter project-host 的 SQLite registry 保存 thread → workspace 关联，并
注入 coordinator context。云端独立 worker 通过 GitHub 创建 thread 分支，再调用
OpenMA 现有 repository resource 接口；核心没有新增调度或 checkout 逻辑。
云端需配置 `PROJECT_WORKER_GITHUB_TOKEN`，令牌不进入项目记录或 renderer。

集成代码通过单独委派的 integration worker 处理；云端其他线程只能取得已 push
的代码。完成/删除项目保留工作区，清理由人工确认修改已保存后执行。目录缺失、
本地分支被切换或云端原会话丢失时明确报错，不悄悄丢弃工作重新 checkout。
旧共享目录会话需要新建工作线程，原文件保留。目录隔离不等同于权限沙箱。

## 创建与设置表单

创建仅要求名称，可附目标与上下文；未选择 agents 的配置作为 draft 持久化。
执行和 coordinator controls 在两个 agents 均配置前拒绝接收命令。
项目设置按 General / Context / Agents 分页，复用 Radix Tabs、Select、Checkbox
及既有 ProjectFolderList；公共 FormDialog 使用 Dialog + ScrollArea 管理边界、
固定标题与操作栏。目标随 instructions 进入 agent context。
