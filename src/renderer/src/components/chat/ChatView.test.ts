import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/AgentIcon", () => ({
  AgentIcon: () => null,
}));

import {
  buildSlashCommandSections,
  canSubmitComposer,
  removeSuggestionTemplateSlot,
  serializeSuggestionTemplate,
} from "./ChatView";
import * as chatViewModule from "./ChatView";

describe("chat module boundaries", () => {
  it("places transient session notices immediately above the composer", () => {
    const source = readFileSync(resolve(__dirname, "ChatView.tsx"), "utf8");

    expect(source).toContain('from "./ComposerNotice"');
    expect(source).toContain("const composerNotice =");
    expect(source.indexOf("{composerNotice}")).toBeLessThan(
      source.indexOf("{composer}"),
    );
  });

  it("delegates the composer implementation to its dedicated module", () => {
    const source = readFileSync(resolve(__dirname, "ChatView.tsx"), "utf8");

    expect(source).toContain('from "./Composer"');
    expect(source).not.toContain("export function Composer(");
  });
});

describe("canSubmitComposer", () => {
  it("allows submitting text while a turn is running so it can be queued", () => {
    expect(
      canSubmitComposer({ text: "follow up", disabled: false, running: true }),
    ).toBe(true);
  });

  it("still blocks empty or disabled submits", () => {
    expect(
      canSubmitComposer({ text: "  ", disabled: false, running: true }),
    ).toBe(false);
    expect(
      canSubmitComposer({ text: "follow up", disabled: true, running: true }),
    ).toBe(false);
    expect(
      canSubmitComposer({
        text: "follow up",
        disabled: false,
        running: true,
        actionDisabled: true,
      }),
    ).toBe(false);
  });

  it("allows attachment-only prompts", () => {
    expect(
      canSubmitComposer({
        text: "  ",
        disabled: false,
        attachments: [
          {
            id: "att-1",
            name: "screenshot.png",
            path: "/tmp/screenshot.png",
            uri: "file:///tmp/screenshot.png",
            kind: "image",
            mimeType: "image/png",
            size: 10,
          },
        ],
      }),
    ).toBe(true);
  });

  it("allows annotation-only prompts", () => {
    expect(
      canSubmitComposer({
        text: "  ",
        disabled: false,
        annotations: [
          {
            id: "annotation-1",
            source_session_id: "sess-source",
            source_turn_id: "turn-source",
            text: "The selected assistant response",
          },
        ],
      }),
    ).toBe(true);
  });
});

describe("home suggestions", () => {
  it("keeps the welcome logo and suggestions for a started session with no turns", () => {
    const source = readFileSync(resolve(__dirname, "ChatView.tsx"), "utf8");
    const emptyState = source.slice(
      source.indexOf("{isEmpty ? ("),
      source.indexOf("// Conversation flow"),
    );

    expect(emptyState).toContain("<EmptyStateIntro");
    expect(emptyState).not.toContain('active.status === "draft"');
    expect(emptyState).not.toContain("<SessionIntro");
    expect(source).not.toContain("function SessionIntro");
  });

  it("dismisses suggestions when the user starts typing", () => {
    const transition = (
      chatViewModule as unknown as {
        transitionHomeSuggestionPhase?: (
          phase: "visible" | "choosing" | "dismissed",
          event:
            | "select"
            | "back"
            | "template-selected"
            | "user-input"
            | "user-clear"
            | "reset",
        ) => "visible" | "choosing" | "dismissed";
      }
    ).transitionHomeSuggestionPhase;

    expect(transition).toBeTypeOf("function");
    if (!transition) return;

    expect(transition("visible", "user-input")).toBe("dismissed");
    expect(transition("choosing", "user-input")).toBe("dismissed");
    expect(transition("dismissed", "user-input")).toBe("dismissed");
    expect(transition("dismissed", "user-clear")).toBe("visible");
    expect(transition("dismissed", "reset")).toBe("visible");

    const chatViewSource = readFileSync(resolve(__dirname, "ChatView.tsx"), "utf8");
    const composerSource = readFileSync(resolve(__dirname, "Composer.tsx"), "utf8");
    expect(chatViewSource).toContain("onUserInput={syncHomeSuggestionsForUserInput}");
    expect(composerSource).toContain("onUserInput(nextText.trim().length > 0");
  });

  it("uses a two-stage suggestion flow without submitting or navigating", () => {
    const source = readFileSync(resolve(__dirname, "ChatView.tsx"), "utf8");

    expect(source).toContain("useHomeSuggestionState(active?.id)");
    expect(source).toContain("fillSuggestionPrefix(prompt)");
    expect(source).toContain("suggestionDraft={suggestionDraft}");
    expect(source).not.toContain("void onSubmit(prompt)");
    expect(source).toContain("homeSuggestionSelection");
    expect(source).toContain("<EmptyStateIntro");
    expect(source).toContain("<HomeSuggestionSelect");
  });

  it("uses probed agent commands in the draft slash picker", () => {
    const normalize = (
      chatViewModule as unknown as {
        normalizeAgentAvailableCommands?: (
          value: unknown,
        ) => Array<{ name: string; description?: string }>;
      }
    ).normalizeAgentAvailableCommands;

    expect(normalize).toBeTypeOf("function");
    if (!normalize) return;
    expect(normalize([
      { name: "compact", description: "Compact context" },
      { name: "" },
      null,
    ])).toEqual([
      { name: "compact", description: "Compact context" },
    ]);

    const source = readFileSync(resolve(__dirname, "Composer.tsx"), "utf8");
    const harnessSource = readFileSync(
      resolve(__dirname, "../../lib/composer-harness-state.ts"),
      "utf8",
    );
    expect(source).toContain("useComposerHarnessState");
    expect(harnessSource).toContain("normalizeAgentAvailableCommands(");
    expect(harnessSource).toContain(
      "harness.currentEnabledAgent?.available_commands",
    );
  });

  it("serializes a GUI template field into the submitted prompt", () => {
    const template = {
      before: "帮我打磨",
      slotLabel: "想法",
      after: "，把它变成具体计划",
    };

    expect(
      serializeSuggestionTemplate(template, "一个旅行计划"),
    ).toBe("帮我打磨一个旅行计划，把它变成具体计划");
    expect(
      serializeSuggestionTemplate(template, "   "),
    ).toBe("");
  });

  it("turns a deleted GUI template field back into ordinary composer text", () => {
    expect(
      removeSuggestionTemplateSlot(
        {
          before: "帮我打磨",
          slotLabel: "想法",
          after: "，把它变成具体计划",
        },
        "",
      ),
    ).toEqual({
      text: "帮我打磨，把它变成具体计划",
      caret: 4,
    });

    const source = readFileSync(resolve(__dirname, "Composer.tsx"), "utf8");
    expect(source).toContain("<SuggestionTemplateEditor");
  });

  it("consumes the suggestion draft when the composer submits", () => {
    const source = readFileSync(resolve(__dirname, "ChatView.tsx"), "utf8");
    const submissionSource = readFileSync(
      resolve(__dirname, "../../lib/chat-submission.ts"),
      "utf8",
    );
    const stateSource = readFileSync(
      resolve(__dirname, "../../lib/home-suggestion-state.ts"),
      "utf8",
    );

    expect(source).toContain("onSuggestionSubmitted: consumeSuggestionDraft");
    expect(stateSource).toContain(
      'consumeDraft: () => dispatch({ type: "consume" })',
    );
    expect(submissionSource).toContain("onSuggestionSubmitted();");
  });

  it("dismisses every suggestion surface after choosing a template", () => {
    const source = readFileSync(resolve(__dirname, "ChatView.tsx"), "utf8");
    const stateSource = readFileSync(
      resolve(__dirname, "../../lib/home-suggestion-state.ts"),
      "utf8",
    );

    expect(source).toContain("homeSuggestionPhase");
    expect(source).toContain("onSuggestion={selectHomeSuggestionTemplate}");
    expect(stateSource).toContain(
      '"template-selected"',
    );
    expect(source).toContain('homeSuggestionPhase === "dismissed"');
  });

  it("animates suggestion fill while respecting reduced motion", () => {
    const source = readFileSync(resolve(__dirname, "Composer.tsx"), "utf8");
    const suggestionState = readFileSync(
      resolve(__dirname, "../../lib/composer-suggestion-state.ts"),
      "utf8",
    );
    const styles = readFileSync(
      resolve(__dirname, "../../styles/index.css"),
      "utf8",
    );

    expect(suggestionState).toContain("prefers-reduced-motion: reduce");
    expect(source).toContain("useComposerSuggestionState");
    expect(source).toContain("suggestion-fill-active");
    expect(styles).toContain(".composer-suggestion-fill");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("anchors the second-stage picker above the composer without moving the hero", () => {
    const source = readFileSync(resolve(__dirname, "ChatView.tsx"), "utf8");
    const styles = readFileSync(
      resolve(__dirname, "../../styles/index.css"),
      "utf8",
    );
    const firstComposerFrame = source.indexOf('data-chat-column="composer"');
    const emptyComposer = source.slice(
      firstComposerFrame,
      source.indexOf("// Conversation flow"),
    );
    const pickerStyles = styles.slice(
      styles.indexOf(".home-suggestion-composer-popover {"),
      styles.indexOf(".home-suggestion-select-header {"),
    );

    expect(emptyComposer).toContain("<HomeSuggestionSelect");
    expect(emptyComposer.indexOf("<HomeSuggestionSelect")).toBeLessThan(
      emptyComposer.indexOf("{chipRow}"),
    );
    expect(pickerStyles).toContain("position: absolute;");
    expect(pickerStyles).toContain("bottom: calc(100% + 12px);");
    expect(pickerStyles).not.toContain(
      "height: var(--home-suggestion-card-height, 112px);",
    );
  });

  it("keeps second-stage suggestions non-scrollable and truncates long rows", () => {
    const styles = readFileSync(
      resolve(__dirname, "../../styles/index.css"),
      "utf8",
    );
    const optionsStyles = styles.slice(
      styles.indexOf(".home-suggestion-options {"),
      styles.indexOf(".home-suggestion-option {"),
    );
    const copyStyles = styles.slice(
      styles.indexOf(".home-suggestion-option-copy {"),
      styles.indexOf(".home-suggestion-option-prefix {"),
    );

    expect(optionsStyles).toContain("overflow: hidden;");
    expect(optionsStyles).not.toContain("overflow-y: auto;");
    expect(copyStyles).toContain("overflow: hidden;");
    expect(copyStyles).toContain("text-overflow: ellipsis;");
    expect(copyStyles).toContain("white-space: nowrap;");
  });

  it("pins the empty-state composer to the normal chat composer frame", () => {
    const source = readFileSync(resolve(__dirname, "ChatView.tsx"), "utf8");
    const styles = readFileSync(
      resolve(__dirname, "../../styles/index.css"),
      "utf8",
    );
    const emptyState = source.slice(
      source.indexOf("{isEmpty ? ("),
      source.indexOf("// Conversation flow"),
    );

    expect(emptyState).toContain('className="home-empty-content');
    expect(emptyState).toContain('data-chat-column="composer"');
    expect(emptyState).toContain("CHAT_COMPOSER_FRAME_CLASS");
    expect(emptyState).toContain('"space-y-2 pb-4"');
    expect(source).not.toContain("composerTransition");
    expect(source).not.toContain('"composer-slide-in"');
    expect(styles).not.toContain(
      "html[data-theme-asset-home-hero-background=\"true\"] .home-composer-stack .composer-card",
    );
  });

  it("keeps the empty-state hero lower without moving the composer frame", () => {
    const styles = readFileSync(
      resolve(__dirname, "../../styles/index.css"),
      "utf8",
    );
    const emptyStackStyles = styles.slice(
      styles.indexOf(".home-empty-stack {"),
      styles.indexOf(".home-hero-panel {"),
    );

    expect(emptyStackStyles).toContain("--home-empty-stack-offset-y");
    expect(emptyStackStyles).toContain(
      "margin-top: var(--home-empty-stack-offset-y",
    );
    expect(emptyStackStyles).not.toContain("margin-top: -8vh;");
  });

  it("places the project picker above the composer in every draft surface", () => {
    const source = readFileSync(resolve(__dirname, "ChatView.tsx"), "utf8");
    const firstComposerFrame = source.indexOf('data-chat-column="composer"');
    const secondComposerFrame = source.indexOf(
      'data-chat-column="composer"',
      firstComposerFrame + 1,
    );
    const emptyComposer = source.slice(
      firstComposerFrame,
      source.indexOf("// Conversation flow"),
    );
    const conversationComposer = source.slice(
      secondComposerFrame,
      source.indexOf("{active?.status === \"errored\""),
    );

    expect(emptyComposer.indexOf("{chipRow}")).toBeLessThan(
      emptyComposer.indexOf("{composer}"),
    );
    expect(conversationComposer.indexOf("{chipRow}")).toBeLessThan(
      conversationComposer.indexOf("{composer}"),
    );
  });

  it("uses only the active Agent logo in the compact run trigger", () => {
    const controlsSource = readFileSync(
      resolve(__dirname, "ComposerSessionControls.tsx"),
      "utf8",
    );
    const runChip = controlsSource.slice(
      controlsSource.indexOf("function SessionRunChip"),
      controlsSource.indexOf("function SessionConfigSubmenu"),
    );

    expect(runChip).toContain("agentId={currentAgentId}");
    expect(runChip).toContain("title={agentLabel}");
    expect(runChip).not.toContain(
      '<span className="truncate">{agentLabel}</span>',
    );
  });

  it("only offers the local runtime in the run menu", () => {
    const controlsSource = readFileSync(
      resolve(__dirname, "ComposerSessionControls.tsx"),
      "utf8",
    );
    const runChip = controlsSource.slice(
      controlsSource.indexOf("function SessionRunChip"),
      controlsSource.indexOf("function SessionConfigSubmenu"),
    );

    expect(runChip).toContain('label={t("chat.local")}');
    expect(runChip).not.toContain('label={t("chat.cloud")}');
    expect(runChip).not.toContain('label={t("chat.otherMachine")}');
  });
});

describe("slash command presentation", () => {
  const commands = [
    { name: "compact", description: "Compact context" },
    { name: "export", description: "Export the session" },
    ...Array.from({ length: 7 }, (_, index) => ({
      name: `skill:tool-${index + 1}`,
      description: `Use tool ${index + 1}`,
    })),
  ];

  it("keeps native commands prominent and previews skills without flooding the composer", () => {
    const sections = buildSlashCommandSections(commands, "", 4);

    expect(sections.map((section) => section.kind)).toEqual([
      "commands",
      "skills",
    ]);
    expect(sections[0]?.commands.map((command) => command.name)).toEqual([
      "compact",
      "export",
    ]);
    expect(sections[1]?.commands).toHaveLength(4);
    expect(sections[1]?.hiddenCount).toBe(3);
  });

  it("shows every matching skill while the user filters", () => {
    const sections = buildSlashCommandSections(commands, "tool", 4);

    expect(sections).toHaveLength(1);
    expect(sections[0]?.kind).toBe("skills");
    expect(sections[0]?.commands).toHaveLength(7);
    expect(sections[0]?.hiddenCount).toBe(0);
  });

  it("delegates slash command presentation to the dedicated menu", () => {
    const source = readFileSync(resolve(__dirname, "Composer.tsx"), "utf8");

    expect(source).toContain("<ComposerSlashCommandMenu");
    expect(source).toContain("sections={slashCommandSections}");
    expect(source).toContain("selectedIndex={pickerIndex}");
  });

  it("renders plan as session state and Model, Effort, Fast as nested ACP controls", () => {
    const source = readFileSync(resolve(__dirname, "Composer.tsx"), "utf8");
    const harnessSource = readFileSync(
      resolve(__dirname, "../../lib/composer-harness-state.ts"),
      "utf8",
    );
    const controlsSource = readFileSync(
      resolve(__dirname, "ComposerSessionControls.tsx"),
      "utf8",
    );

    expect(source).toContain("<PlanSessionState");
    expect(source).toContain("useComposerHarnessState");
    expect(harnessSource).toContain("withSessionStateCommands");
    expect(source).toContain('from "./ComposerSessionControls"');
    expect(controlsSource).toContain("buildRunMenuConfigOptionSections");
    expect(controlsSource).toContain("<DropdownMenuSub");
    expect(controlsSource).toContain('t("chat.model")');
    expect(controlsSource).toContain('t("chat.effort")');
    expect(controlsSource).toContain('t("chat.fast")');
    expect(controlsSource).not.toContain("<FastModeControl");
  });

});

describe("new task submission", () => {
  it("shows a project-bound draft and submits from the draft's explicit scope", () => {
    const source = readFileSync(resolve(__dirname, "ChatView.tsx"), "utf8");
    const submissionSource = readFileSync(
      resolve(__dirname, "../../lib/chat-submission.ts"),
      "utf8",
    );

    expect(source).toContain("active?.chosenCwd");
    expect(submissionSource).toContain("resolveProjectScopedPickedCwd(");
    expect(submissionSource).toContain(
      "resolveWorkspaceMode(target.projectScope, isSide)",
    );
    expect(submissionSource).not.toContain("defaultWorkspacePath");
  });

  it("resolves the submit target from the live store instead of a stale render", () => {
    const source = readFileSync(resolve(__dirname, "ChatView.tsx"), "utf8");
    const submissionSource = readFileSync(
      resolve(__dirname, "../../lib/chat-submission.ts"),
      "utf8",
    );

    expect(source).toContain("useChatSubmission");
    expect(submissionSource).toContain(
      "isSide ? sessionStore.sideActive() : sessionStore.active()",
    );
    expect(submissionSource).not.toContain("let target = active;");
  });

  it("validates the draft Agent before creating a session or navigating", () => {
    const submissionSource = readFileSync(
      resolve(__dirname, "../../lib/chat-submission.ts"),
      "utf8",
    );

    expect(submissionSource.indexOf("if (!draftAgentId)")).toBeGreaterThan(-1);
    expect(submissionSource.indexOf("if (!draftAgentId)")).toBeLessThan(
      submissionSource.indexOf("newDraftSession()"),
    );
  });
});
