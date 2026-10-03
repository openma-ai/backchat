# 贡献指南

**English.** Canonical contribution guide for the openma-ai org. It lives in `open-managed-agents` first; copy it to other org repos or an org `.github` repo and replace only **本仓库**. Shared rules: conventional-commit titles, squash merge, small PRs, green CI with a root cause for failures, a compatibility check on dependency bumps plus a follow-up bump downstream after release, private security reports, and an evidence report on every PR before merge.

以下各节是组织约定。「本仓库」只适用于 `backchat`。

## 分支 / Branches

从 `main` 拉出。人工分支用小写：

```text
<type>/<kebab-summary>
```

`type` 与 PR 标题类型一致。近期合并：`fix/ci-minio-image`（#227）、`feat/sql-realtime-fanout`（#222）、`refactor/split-node-assembly`（#234）、`docs/discord-community`（#197）。关联 issue 时把编号放进名字，例如 `fix/196-session-update-idle`。

工具前缀保持原样：`dependabot/…`、`codex/…`、`cursor/…`。deepseek-harness-acp 的 dsh 升级分支是 `codex/bump-dsh-<version>`。

一个分支一件事。跟上 `main` 用 rebase。

## PR 标题与 squash / PR titles

标题用 [Conventional Commits](https://www.conventionalcommits.org/)。squash 之后它就是 `main` 上的提交说明，GitHub 再追加 `(#编号)`：

```text
<type>(<scope>): <祈使句，说明做了什么>
```

`scope` 可省略。常用 type：`feat` `fix` `refactor` `perf` `docs` `test` `ci` `chore`。依赖用 `chore(deps):`。一篇 PR 一个 type。近期合进去的标题也不都是这个格式：#224 是 `fix+feat(...)`；#237 是 `Workspace persistence semantics: durable_mount vs fenced checkpoint_restore, shared Session outputs`；#239 是 `CMA retry_status semantics + live-found fixes (...)`。新 PR 用单一 conventional type。

发版提交的主题是 `release: vX.Y.Z`（见「发布」），普通 PR 不用这个前缀。

合并方式是 **squash**。本仓库近期 `main` 上每篇 PR 是一个单父提交，主题即 PR 标题。#202 写明仓库不接受 merge commit，因此把多篇依赖 PR 合成一篇再 squash。deepseek-harness-acp 历史上有过 merge commit（#30）；新 PR 按 squash 合。

## 小 PR / Small PRs

一次改一个问题或一个职责。`main-node` 控制面拆分是一串短 PR（#225、#228–#234），每篇只动一层。文档、重命名、行为变更分开。

lockfile 冲突时可以把多篇依赖更新合成一篇，跑一次完整 CI（#202 包含 #201–#206）。描述里列出被包含的 PR。

## 证据报告 / Evidence report

**合并前，PR 描述或一条评论里必须有证据报告，并且对应当前 head SHA。** 缺段，或证据还停在旧 SHA 上，就不合并。仓库没有把这件事做成 status check：作者填写，维护者核对。模板是 `.github/pull_request_template.md`。

六段都要出现。没有内容就写「不适用」并给一句原因。

### 问题 / 动机

缺陷要有**在真实产品上**的复现：命令、版本、原样输出。只写推理不够。新能力写清谁在什么场景下需要它。

### 根因

写到代码或外部依赖的哪一层。上游变更（镜像仓库、npm 发布）和本仓库的缺陷分开写。

### 改动说明

做了什么、刻意没做什么。点名关键文件，不贴大段 diff。

### 验证证据

- 当前 head SHA。
- 该 SHA 上的 CI run 链接，写明 workflow 和 job。旧 push 的绿 run 不算。
- 跑过的测试名称和通过数（例如 `8 files / 42 tests`）。本地和 CI 都写。
- 改了 UI 或可见行为时，把截图或录屏嵌进 PR。可以直接拖进 GitHub。需要稳定链接时，推到孤立分支 `pr-assets`：

  ```bash
  git checkout --orphan pr-assets
  git rm -rf .
  mkdir -p pr-<编号>
  # 只放 png / webm。不要放密钥，也不要放未剪辑的大体积录屏。
  git add pr-<编号>
  git commit -m "pr-assets: <编号>"
  git push -u origin pr-assets
  ```

  链接形式：`https://raw.githubusercontent.com/openma-ai/<repo>/pr-assets/pr-<编号>/<file>`。`pr-assets` 只存证据，不在上面开发。

### 未验证的部分

写明没跑的检查和原因。作者自己的 mock、fixture、测试替身，与真实产品或上游行为分开。mock 通过不等于 KVM 沙箱、托管环境或下游仓库已经验证。

### 风险与回滚

最坏情况，以及怎么退回：revert 这篇 squash 提交，或发一个修复版本。发版和迁移要写用户会看到什么。

### 示例

#227 的缩写，只示范格式。新 PR 按自己的改动重写。

> **问题 / 动机。** `pnpm test:integration:storage` 在 CI run [36001613340](https://github.com/openma-ai/open-managed-agents/actions/runs/36001613340) 的 global setup 失败，测试还没开始。日志是 MinIO 匿名拉取 `401 unauthorized`。干净机器上 `docker pull quay.io/minio/minio@sha256:d249d1fb…` 同样 401。
>
> **根因。** 仓库代码没有变化。`quay.io/minio/minio` 停止匿名拉取。
>
> **改动说明。** 测试镜像改为可匿名拉取的 `cgr.dev/chainguard/minio`，并钉住 manifest digest。
>
> **验证证据。** 本地 `pnpm test:integration:storage`：8 files / 42 tests 通过。合并前该 PR head 上的 CI storage 步骤通过。
>
> **未验证的部分。** 这是 CI 用的 MinIO 镜像，不是产品运行时依赖。没有改 S3 条件写相关的产品代码，也就没有另做产品级 S3 手工验证。
>
> **风险与回滚。** 只影响存储集成测试。revert 该提交即回到旧镜像引用。

## CI / 必须是绿的

合并前，当前 head SHA 上该 PR 该跑的 CI 全部成功。失败先读日志，写出根因，再改代码或改测试。不要对同一 SHA 反复 Re-run，直到碰巧变绿再合。

Re-run 可以用来收集第二次日志。第一次红、第二次绿时，报告里写明两次差异（超时、外部注册表、被 concurrency 取消的 run）。说不清原因就继续查。#227 的处理是确认 MinIO 注册表 401，然后更换镜像。

`concurrency.cancel-in-progress: true` 会取消同一 ref 上还在跑的旧 workflow。被取消的 run 不是 flake；看新 SHA 上的 run。

## 依赖升级 / Dependency upgrades

Dependabot 和手工 lockfile 更新都要做兼容性检查。CI 变绿只是其中一步：

- 读上游 changelog / release notes，列出行为变化。
- 跑本仓库已有的兼容矩阵，而不是只跑默认单测。deepseek-harness-acp 的 job `dsh-compatibility` 按 `runtime/compatibility.json` 安装多个 `@deepseek-ai/dsh` 并做 profile smoke。定时 workflow `dsh-update.yml` 会打开 `chore: upgrade bundled dsh to <version>`。#33 给这个 workflow 加了 Cursor agent 复查；人仍然负责合并。
- 升级 PR 不顺便给本包打版本。dsh 自动 PR 的正文写明：This PR does not bump or release the ACP package。
- 适配修不好就不合并。

发布之后，下游另开 bump PR，把依赖改到刚发布的版本，并跑下游自己的 CI：

- Martty 的 `npm/package.json` 依赖 `@openma/deepseek-harness-acp`。CHANGELOG 记录过随 0.4.29、0.4.31 的升级；#135 跟上了 0.4.35 的打包修复。
- openma-common 打 tag 之后，两个消费仓库改到新 tag 并提交 lockfile（该仓库 `CONTRIBUTING.md` 的 release checklist）。

## 发布 / Release

以该仓库的 workflow 为准。组织里实际有两种。

**打 tag。** deepseek-harness-acp、Martty、openma-common：

1. 版本写进清单。Martty 还要求 tag、`npm/package.json`、`Cargo.toml` 一致（`scripts/check-release-tag.mjs`）。
2. dsh 与 Martty 在 `main` 上的发版提交主题为 `release: vX.Y.Z`（dsh `v0.4.36`、Martty `v0.3.0`）。openma-common 是发版 PR 合并后再打同名 tag。
3. `git tag vX.Y.Z && git push origin vX.Y.Z`。tag 指向 `main` 上的那次提交。
4. tag 触发发布：dsh `release.yml` 先确认 tag 在 `main` 上，再跑测试、dsh 兼容矩阵和 standalone smoke，然后用 npm OIDC 发布。Martty `package-npm.yml` 监听 `v*.*.*`。
5. openma-common 是 `private: true` 的 git 依赖：打 tag 后更新消费方，不发 npm。

**Changesets。** 用来发布 `@openma/cli` / `@openma/sdk`。步骤在「本仓库」。本仓库的 `version-pr` 会跑 MySQL 集成，但没有 `Enable KVM for Litebox`；没有 `/dev/kvm` 时 Litebox 用例会失败。

发版提交只含版本和 changelog。功能先进普通 PR。发版后按上一节给下游开 bump PR。

## 安全 / Security

私下报告，不要开公开 issue。本仓库走 [`SECURITY.md`](https://github.com/openma-ai/open-managed-agents/blob/09bbbd37b9cf3b2c62c4aa5df1298b2ff4c6043f/SECURITY.md) 和 [Private vulnerability reporting](https://github.com/openma-ai/open-managed-agents/security/advisories/new)。复制到别的仓库时改成那个仓库的私下渠道。

发行物里不带调试端口，也不带密钥：

- 发布的 Node 进程、镜像 `CMD`、安装包里不开 `--inspect`、`9229`，也不开 Chrome `--remote-debugging-port`。
- 镜像只暴露产品端口，不额外 `EXPOSE` 调试端口。
- `.env`、`.dev.vars`、token、keystore 不进 git、npm 包、GHCR 镜像或桌面安装包。

依赖安全公告单独修（Backchat 有 `chore: prepare Backchat v0.0.9 security release`）。修法仍走普通 PR 和证据报告；公告细节走私下渠道。

## 本仓库：backchat

仓库 [openma-ai/backchat](https://github.com/openma-ai/backchat)。根 `package.json` 的 `name` 是 `backchat`，`version` 是 `0.0.12`，`private` 是 `true`。`packages/openma-sdk/package.json` 的包名是 `@openma/sdk`，`version` 是 `1.0.0-beta.1`，`private` 是 `true`。没有 `.changeset/` 目录。

没有 `.node-version` 或 `.nvmrc`。根 `package.json` 的 `engines.node` 是 `>=24`，`packageManager` 是 `pnpm@11.24.0`。CI 的 `.github/actions/setup-node-pnpm/action.yml` 用 `pnpm/action-setup@v4` 安装 pnpm `11.24.0`，用 `actions/setup-node@v4` 的 `node-version: 24`，然后 `pnpm install --frozen-lockfile`。`node-version: 24` 只写主版本。2026-10-02 的 [CI run 37018810738](https://github.com/openma-ai/backchat/actions/runs/37018810738)（push 到 `main`，head `85caaa8`，#29）里，`unit` 打印 `node: v24.21.0`，`e2e` 打印 `node: v24.20.0`。

根 `package.json` 的 `devDependencies.electron` 是 `^42.5.1`，`pnpm-lock.yaml` 的根 importer 解析为 `42.5.1`。`.npmrc` 写 `runtime=electron`、`target=42.5.1`，注释要求改 electron 时一起改 `target`。`packages/pet-app/package.json` 的 `electron` 是 `^42.11.8`，同一份 lock 解析为 `42.11.8`。根 lock 里 `electron-builder` 是 `26.17.0`，`electron-vite` 是 `5.0.0`，`typescript` 是 `6.0.3`，`vite` 是 `8.0.16`，`vitest` 是 `4.1.11`，`wrangler` 是 `4.123.0`。

与 `unit` job 相同的命令：

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:ci
node --test scripts/*.test.mjs
```

`pnpm typecheck` 是 `tsc -p tsconfig.node.json --noEmit && tsc -p tsconfig.web.json --noEmit`。网站的 `tsc -p tsconfig.website.json` 在 `pnpm website:build` 里，不在 `pnpm typecheck` 里。

| 命令 | 作用 |
|---|---|
| `pnpm dev` | `electron-vite dev` |
| `pnpm website:dev` | `vite --config website.vite.config.ts`。该文件没有 `server.port` |
| `pnpm test` | `vitest run`。`ci.yml` 和 `build-dmg.yml` 都不跑这条。`vitest.ci.config.ts` 开头注释写明完整套件仍有已知失败文件，CI 用单独的 include 列表 |
| `pnpm test:ci` | `vitest run --config vitest.ci.config.ts --reporter=dot` |
| `pnpm test:e2e:fast` | `electron-vite build` 后 Playwright 跑 `e2e/smoke.spec.ts`、`e2e/composer.spec.ts`、`e2e/composer-slash.spec.ts`、`e2e/composer-config.spec.ts`、`e2e/storage.spec.ts`、`e2e/file-first-export.spec.ts`、`e2e/sidebar-custom-sections.spec.ts`、`e2e/project-conversation.spec.ts` |
| `pnpm test:e2e:openma` | 先构建，再跑 `e2e/openma-account.spec.ts`、`e2e/openma-cloud.spec.ts`、`e2e/openma-daemon-ownership.spec.ts`、`e2e/openma-tenants.spec.ts`、`e2e/direct-agents.spec.ts`、`e2e/power-management.spec.ts`、`e2e/quit-confirmation.spec.ts` |
| `pnpm test:verify` | `typecheck`、完整 `pnpm test`、`test:e2e:fast`。`src/main/github-ci-contract.test.ts` 断言 CI 与 DMG workflow 不跑 `pnpm run test` |
| `pnpm build` | `electron-vite build` |
| `pnpm package` | `electron-vite build`、`runtime:prepare`、`electron-builder` |

`playwright.config.ts` 写明对真实 Electron 构建启动应用，`workers: 1`。`node --test scripts/*.test.mjs` 只匹配 `scripts/` 根上的文件。2026-10-02 工作树里是 `scripts/publish-preview-release.test.mjs`、`scripts/verify-release-version.test.mjs`、`scripts/harness-feature-matrix-report.test.mjs`。

改 Electron 界面时跑 `pnpm test:e2e:fast`。改 OpenMA 账号、云、daemon、租户、直连 agent、电源管理或退出确认时跑 `pnpm test:e2e:openma`。`e2e` job 的 `runs-on` 是 `macos-latest`。

Workflow `CI`（`.github/workflows/ci.yml`；`pull_request`、`push` 到 `main`、`workflow_dispatch`；`concurrency.cancel-in-progress: true`）：

1. `dependency-review`：仅 `pull_request`，`ubuntu-latest`，超时 10 分钟，`actions/dependency-review-action@v5`。
2. `unit`：`ubuntu-latest`，超时 15 分钟。顺序是 `pnpm run typecheck`、`pnpm run test:ci`、`node --test scripts/*.test.mjs`。
3. `e2e`：`macos-latest`，超时 30 分钟，`CSC_IDENTITY_AUTO_DISCOVERY: "false"`。顺序是 `pnpm run test:e2e:fast`、`pnpm run test:e2e:openma`。失败时上传 `test-results/` 和 `playwright-report/`。

| Workflow | 何时跑 | Job |
|---|---|---|
| `CI` | 见上 | `dependency-review`、`unit`、`e2e` |
| `CodeQL`（`.github/workflows/codeql.yml`） | `pull_request`、`push` 到 `main`、cron `18 11 * * 1`、`workflow_dispatch`。`cancel-in-progress: true` | `analyze`（显示名 Analyze JavaScript and TypeScript），`ubuntu-latest`，超时 30 分钟，`languages: javascript-typescript`，`build-mode: none` |
| `Build macOS DMG`（`.github/workflows/build-dmg.yml`） | `workflow_dispatch`、`push` 到 `main`、tag `v*`。触发器里没有 `pull_request`。`cancel-in-progress: true` | `dmg`，`macos-latest`，超时 45 分钟，`CSC_IDENTITY_AUTO_DISCOVERY: "false"` |
| `Deploy website`（`.github/workflows/deploy-website.yml`） | `release` 的 `published`，以及 `workflow_dispatch`。`cancel-in-progress: true` | `deploy`。`if` 为 `workflow_dispatch`，或 `github.event.release.tag_name` 以 `v` 开头。`ubuntu-latest`，超时 15 分钟 |

`dmg` 的步骤：checkout、setup、仅 tag 时 `node scripts/verify-release-version.mjs package.json`、`pnpm run typecheck`、`pnpm run test:ci`、`node --test scripts/*.test.mjs`、`pnpm exec electron-vite build`、`pnpm run runtime:prepare`、`pnpm exec electron-builder --publish never`、`scripts/verify-packaged-runtime.mjs`、`scripts/verify-packaged-macos-signature.mjs`、`scripts/verify-packaged-first-prompt.mjs`，然后上传 `release/**/*.dmg`。`github.ref == refs/heads/main` 时执行 `node scripts/publish-preview-release.mjs release`。这个脚本把唯一的版本化 `*-arm64.dmg` 复制为 `Backchat-preview-arm64.dmg`，上传到 tag `preview`（prerelease，标题 `Backchat Preview`，说明 `Latest successful build from the main branch.`）。tag 上执行 `gh release create "${GITHUB_REF_NAME}"`，同时上传版本化 DMG 和复制出的 `Backchat-arm64.dmg`，参数 `--generate-notes --verify-tag`。

`scripts/verify-release-version.mjs` 要求 `GITHUB_REF_NAME` 等于 `v` 加上 `package.json` 的 `version`。`scripts/verify-packaged-macos-signature.mjs` 在非 darwin 上以退出码 2 结束；在 macOS 上运行 `/usr/bin/codesign --verify --deep --strict --verbose=4`。根 `package.json` 的 `build.mac.identity` 是 `"-"`，`hardenedRuntime` 是 `false`；`build.mac.target` 是 `dmg`，另外配置了 Windows `nsis` 和 Linux `AppImage`。CI 的打包 job 只构建 macOS DMG。`README.md` 把 push 到 `main` 的 DMG 称为 unsigned，并写签名与公证见 [`docs/releasing.md`](docs/releasing.md)。`docs/releasing.md` 写的是 tag workflow 在 packaged runtime、signature 和 first-prompt 检查之后发布 GitHub Release。该文件没有 notarization、Developer ID 或 `codesign`。`codesign --verify` 在 `scripts/verify-packaged-macos-signature.mjs`，由 `build-dmg.yml` 调用。tag 流程以这两处为准。

`docs/releasing.md` 要求把发布改动合并进 `main`，再在该提交上推不可变 tag `vX.Y.Z`，且不要移动已有 tag。它没有写 main 上的 `preview` 预发布。本仓库的发布文件是 `build-dmg.yml` 和 `deploy-website.yml`。没有 `release.yml`，也没有 `version-pr`。「发布」一节里 `@openma/cli` / `@openma/sdk` 的 changesets 和 `version-pr` 句子保留自 open-managed-agents 的原文。

已打出的 tag 指向的提交：`v0.0.6` → `9f5c83b`，主题 `chore(release): v0.0.6`。`v0.0.7` → `8bdd3b7`，主题 `Merge pull request #14 from openma-ai/codex/release-backchat-0.0.7`；祖先 `4808679` 的主题是 `chore: release Backchat 0.0.7`。`v0.0.8` → `202f70c`，主题 `Merge pull request #20 from openma-ai/codex/backchat-release-0.0.8`。`v0.0.9` → `cbdcd6a`（#21 的 merge commit），annotated tag 说明是 `Backchat v0.0.9 security update`；父提交之一 `9306c6f` 的主题是 `chore: prepare Backchat v0.0.9 security release`。`v0.0.10` → `26dd81b`（#22）。`v0.0.11` → `a6d9f4d`（#23）。`v0.0.12` → `7ba68da`（#24）。2026-10-02，`main` 是 `85caaa8`（#29），根 `package.json` 的 version 仍是 `0.0.12`，tag `v0.0.12` 指向 `7ba68da`。

网站稳定下载地址在 `src/website/release.ts`：`https://github.com/openma-ai/backchat/releases/latest/download/Backchat-arm64.dmg`。`wrangler.jsonc` 把 `backchat.openma.ai` 配成自定义域，静态资源目录是 `./dist/website`。`deploy` 先 `pnpm exec playwright install --with-deps chromium`，再 `pnpm run website:build`，然后 `cloudflare/wrangler-action@v3`（`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`）。tag `preview` 不以 `v` 开头，不满足 `deploy` 的 `if`。

依赖升级在本仓库的门是 PR 上的 `dependency-review`，以及 `unit` 和 `e2e`。`.github/dependabot.yml` 只有 `package-ecosystem: github-actions`，`interval: weekly`。没有单独的 compatibility matrix job。`pnpm-workspace.yaml` 的 overrides 钉了 `@ai-sdk/provider-utils@4.0.27`、`@xmldom/xmldom`、`brace-expansion`、`colord`、`decode-uri-component`、`js-yaml`、`sharp`、`undici`。`@openma/common` 在根 `package.json` 和这份 overrides 里是 `github:openma-ai/openma-common#v0.7.3`。OpenMatter 各包钉在 `620a0d02ace288ddfcdab4283989db3967190bc9`。#21 的标题是 `fix: resolve Backchat dependency advisories`。

2026-10-02，`GET /repos/openma-ai/backchat` 的 `allow_squash_merge`、`allow_merge_commit`、`allow_rebase_merge` 都是 `true`。`git log origin/main --merges` 有 8 个：#21 `cbdcd6a`、#20 `202f70c`、#17 `698789b`、#15 `7954562`、#14 `8bdd3b7`、#13 `e5a2c9e`，以及 `35885b3`（`Merge branch 'main' of https://github.com/openma-ai/backchat`）和 `45feab6`（`Merge branch 'codex/browser-extension-ux' into main`）。#22、#23、#24、#26、#29 在 `main` 上是单父提交：#29 `85caaa8` 的父提交是 #26 `5500c48`。

安全报告渠道：仓库里没有 `SECURITY.md`（2026-10-02，`GET /repos/openma-ai/backchat/contents/SECURITY.md` 为 404）。`GET /repos/openma-ai/backchat/private-vulnerability-reporting` 返回 `{"enabled":false}`。`GET /repos/openma-ai/backchat/security-advisories` 的长度是 0。`GET /orgs/openma-ai` 的 `email` 是 null。上面「安全」一节的 `SECURITY.md` 与 Private vulnerability reporting 链接指向 open-managed-agents。漏洞不要开成公开 issue。

调试端口见 #26（`5500c48`）和 `src/main/remote-debugging.ts`、`src/main/index.ts`。`resolveRemoteDebugging` 在打包应用或 `devBuild !== true` 时默认返回 null，`index.ts` 只在返回值非空时追加 `remote-debugging-address` 与 `remote-debugging-port`。`BACKCHAT_REMOTE_DEBUGGING_PORT` 匹配 `^[1-9]\d{0,4}$` 且数值不超过 65535 时，地址固定为 `127.0.0.1`。开发默认端口常量是 `9222`；`BACKCHAT_TEST_HOOKS=1` 时不使用这个默认端口。`.gitignore` 忽略 `.env` 和 `.env.*`，并列出例外 `!.env.example`；2026-10-02 工作树里没有 `.env.example`。仓库里没有 Dockerfile。`package.json` 的 `private: true`，workflow 里没有 npm publish。

可复现的缺陷用 GitHub Issue。`README.md` 要求附上 OS、Backchat build、agent/harness、project type，以及最小复现。模板是 `.github/ISSUE_TEMPLATE/bug_report.md`（标签 `bug`，仓库里已有这个 label）。本仓库没有 `.github/ISSUE_TEMPLATE/config.yml`。`README.md` 没有 Discord 链接。
