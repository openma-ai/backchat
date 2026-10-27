# Composer controls and steer-message consistency

Status: implementation and focused verification complete in source; installed-app deployment is separate. Active goal created on 2026-10-23.

## User feedback

- “底部这三个按钮的行为样式完全不同，尤其是弹出的 select，请以第二个为标准。”
- “这个 steer 的消息感觉和普通消息逻辑不一致。”

## Acceptance criteria

1. Use the project picker (second footer control) as the reference for runtime,
   project, and workspace triggers and popovers: open/hover/focus appearance,
   positioning, container, spacing, list density, selection feedback, scrolling,
   and keyboard navigation. Preserve domain-specific actions and locking.
2. Steered user input should share ordinary user-message presentation and
   applicable actions, attachment rendering, and sending/error feedback.
   Investigate live rendering and history replay together.
3. Do not change steering delivery semantics just to match the visual layout.
   Injected steering belongs inline in its declared active turn; an actual new
   turn remains a separate turn. Verify official ACP v1 documentation and
   docs/turn-lifecycle-and-state.md (especially I1, I2, I4, I11) before changes.
4. Add regression tests before implementation; run type checks, related tests,
   and Electron visual/interaction verification.
5. Preserve existing uncommitted sidebar status changes.

## Initial findings

- RuntimeLocationControl.tsx currently uses DropdownMenu, no search, default
  menu density, custom transparent command surface and an open-surface opt-out.
- ComposerProjectControls.tsx uses a Popover and GroupedCommandMenu for project
  selection with comfortable density, search, native list scrolling, and a
  rounded popover surface; workspace has a similar but separately authored shell.
- Initial steer renderer used the shared fallback rather than the ordinary prompt bubble. The completed patch now supplies the same UserPromptBubble for injected input.

## Additional user feedback

- After an interim assistant message, an unresolved running turn can look idle.
  Add a visible “Thinking…” fallback when no more specific in-progress activity
  is visible, and remove it only on authoritative turn completion (I1/I3).
- Collapsing process details must crop height/fade without stretching text.
- A tool-created active goal is not visible in the GUI. Trace structured goal
  updates from the current runtime through session projection and goal controls;
  do not synthesize a GUI goal from assistant prose or tool-name matching.

## Tracking

The complete user-reported bug list, current evidence and sequential execution
order are now tracked in `gui-bug-tracker-2026-10-23.md`. This document remains the
original task brief; the tracker is the status source for the current fixes.


## Completion audit — 2026-10-23

| Requirement | Current authoritative evidence |
| --- | --- |
| Three selectors use project reference | ComposerPickerMenu shares GroupedCommandMenu density, native scrolling and command shell. Composer runtime uses Popover; workspace uses the same project shell. Electron compares computed trigger + popover styles, search, arrow keys, Escape and focus return. |
| Keep real controls/locking | ComposerProjectControls component tests include existing target/workspace locking. Runtime groups retain offline/locked rules and account/manage actions; sidebar runtime intentionally unchanged. |
| Ordinary/steer presentation and actions | ChatTurn renderUserInput invokes UserPromptBubble with input-owned text/attachments/time/id; shared attachment preview and copy/edit affordances. Edit callback resubmits input text + its attachments, not the parent's. |
| Pending/failure feedback | Shared optimistic echo and retry path retained; steer-message-replay regression explicitly checks pending → failed → retry and parent remains running. |
| Live/replay and delivery semantics | steer-message-replay tests preserve input timestamp/images inline under the parent in live + replay. Existing session-store injected/startedNewTurn tests pass. No protocol delivery behavior changed to force the appearance. |
| ACP and invariants | Official prompt-turn/extensibility docs consulted before edits; docs/turn-lifecycle-and-state.md I1/I2/I4/I11 retained. Terminal/queue regressions prevent old snapshots resurrecting completed parents. |
| Types/build/GUI | Both web + node TypeScript checks and Electron build passed against a separately patched original registry package. Footer/steer Electron scenarios passed again on that build. |
| Preserve sidebar work | Sidebar source and tests remain present; integrated status aggregation Electron regression passed. No reset/revert or app restart performed. |
| Reproducible common changes | patches/@openma__common@0.11.0.patch + pnpm-workspace.yaml + pnpm-lock.yaml hash. Patch applies to registry 0.11.0 and all 14 changed files match built source byte-for-byte. Temporary dependency linkage receipt records local validation only. |

This closes the original two-item source implementation goal only. Other reports,
including missing upstream live goal snapshots and installation into the running
App, remain tracked separately in gui-bug-tracker-2026-10-23.md. Passing synthetic
goal snapshot tests is not evidence that live native goal delivery is repaired.

Final verification: frozen-lockfile metadata/policy validation succeeded for all
1426 entries (pnpm 11.24.0); no dependency-tree reinstall or active-app change.
Supplementary Electron test exercised Enter selection, reopening and checked
state on runtime/project/workspace; all passed. Original two-item source goal
meets the audit above. Remaining wider bug/deployment work is not marked done.
