<!--
合并前写全下面六段。放在本描述或一条评论里均可，但必须对应当前 head SHA。
不适用的段落写「不适用」并说明原因。填写说明见 CONTRIBUTING.md「证据报告」与「截图与录屏要求」。
修复或实现某个 issue 时，还必须关联该 issue（见 CONTRIBUTING.md「Issue 关联」）。
截图不能代替 Closes #N。
-->

## 关联 issue / Linked issues

<!-- 修复或实现某个未关闭 issue 时必填。单独一行写关闭关键词；分支名带编号不够。也可用 GitHub Development 侧栏关联。多个 issue 各占一行。无关联写「不适用」。 -->

Closes #

## 问题 / 动机

<!-- 缺陷：贴在真实产品上跑过的命令、版本和原样输出。新能力：谁在什么场景下需要它。 -->

- [ ] 缺陷复现来自真实产品（命令 + 输出），或本段已说明这不是缺陷

## 根因

<!-- 代码或外部依赖的哪一层。上游变更和本仓库的缺陷分开写。 -->

## 改动说明

<!-- 做了什么、刻意没做什么。点名关键文件。 -->

## 验证证据

- Head SHA:
- CI（workflow、job、该 SHA 的 run 链接）:
- 测试（名称与通过数）:
- UI / 可见行为（截图或录屏；见 CONTRIBUTING.md「截图与录屏要求」。图片可放在孤立分支 `pr-assets`，用 raw 链接。每张图一行说明；Head SHA 必须与截图构建一致）:

截图清单（改到的表面才勾；未改写「不适用：…」。默认全不勾）：

- [ ] Before / after（同视口；修视觉 bug 时）
- [ ] Default / idle
- [ ] Hover / focus / open menu
- [ ] Selected / active / running
- [ ] Empty / error / loading
- [ ] Dialog / modal（整框：标题、字段、主+次按钮、关闭）
- [ ] Light and dark（或写：仅验证 light / 仅验证 dark）
- [ ] zh-CN and en（或写：仅验证 zh-CN / 仅验证 en）
- [ ] Nested / multi-panel（相关时）
- [ ] Regression neighbors（相邻未改控件仍对齐）
- [ ] 不适用：…………………………………………（纯逻辑 / CI / 仅文档且无可见变化时必填原因）

- [ ] 上面的 CI 链接就是当前 head SHA，不是更早的 push
- [ ] 截图对应的就是上面的 Head SHA（或已写明「不适用」）

## 未验证的部分

<!-- 没跑什么、为什么。mock / fixture / 测试替身和真实产品或上游分开写。 -->

## 风险与回滚

<!-- 最坏情况，以及 revert 这篇 squash 提交或发修复版本的办法。 -->
