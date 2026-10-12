import { describe, expect, it } from "vitest";
import {
  extractAcpSystemNotice,
  splitAcpSystemNoticeText,
} from "./acp-system-notices.js";
import { toOpenMAEvent } from "./openma-event.js";

const diagnosticWarning =
  "Warning: Codex couldn't save diagnostic logs to its local database. " +
  "Use /feedback with logs included before closing Codex, or run " +
  "`codex doctor` for diagnostics.";

const skillWarning =
  "Warning: Skill descriptions were shortened to fit the 2% skills context budget. " +
  "Codex can still see every skill, but some descriptions are shorter. " +
  "Disable unused skills or plugins to leave more room for the rest.";

function warningEvent(
  text: string,
  meta?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text },
    ...(meta ? { _meta: meta } : {}),
  };
}

describe("ACP harness system notices", () => {
  it("classifies the Codex diagnostic envelope with or without a turn", () => {
    const event = warningEvent(`${diagnosticWarning}\n\n`);

    expect(extractAcpSystemNotice(event, { outOfTurn: true })).toEqual({
      message: diagnosticWarning,
      tone: "warning",
    });
    expect(extractAcpSystemNotice(event, { outOfTurn: false })).toEqual({
      message: diagnosticWarning,
      tone: "warning",
    });
  });

  it("splits any Codex warning wording from a coalesced transcript", () => {
    expect(splitAcpSystemNoticeText(`${skillWarning}\n\n`)).toEqual({
      notice: skillWarning,
      transcript: "",
    });
    expect(splitAcpSystemNoticeText(`${skillWarning}\n\nThe project is ready.`)).toEqual({
      notice: skillWarning,
      transcript: "The project is ready.",
    });
  });

  it.each(["final_answer", "commentary"] as const)(
    "keeps phase-tagged %s text as model output",
    (phase) => {
      expect(extractAcpSystemNotice(warningEvent(`${skillWarning}\n\n`, {
        codex: { phase },
      }))).toBeNull();
    },
  );

  it("does not classify an in-turn, unterminated warning-looking answer", () => {
    const text = "Warning: back up first";
    expect(splitAcpSystemNoticeText(text)).toEqual({ transcript: text });
    expect(extractAcpSystemNotice(warningEvent(text), {
      outOfTurn: false,
    })).toBeNull();
  });

  it("classifies an unterminated warning only when the event is out of turn", () => {
    expect(splitAcpSystemNoticeText(diagnosticWarning, {
      outOfTurn: true,
    })).toEqual({
      notice: diagnosticWarning,
      transcript: "",
    });
  });

  it("does not classify a warning mentioned after the chunk prefix", () => {
    expect(splitAcpSystemNoticeText(
      "The build printed Warning: unused var.\n\nFixed.",
    )).toEqual({
      transcript: "The build printed Warning: unused var.\n\nFixed.",
    });
    expect(splitAcpSystemNoticeText("Model is warning: no changes.", {
      outOfTurn: true,
    })).toEqual({ transcript: "Model is warning: no changes." });
  });

  it("still recognizes Pi's structured warning marker", () => {
    expect(extractAcpSystemNotice(warningEvent("Pi warning", {
      piAcp: { notify: { level: "warning" } },
    }))).toEqual({ message: "Pi warning", tone: "warning" });
  });

  it("projects an empty-turn Codex warning as a canonical system notice", () => {
    const message = {
      type: "session.event" as const,
      session_id: "sess-codex-warning",
      turn_id: "",
      event: warningEvent(`${diagnosticWarning}\n\n`),
    };

    expect(toOpenMAEvent(message, {
      occurredAt: "2026-10-10T00:00:00.000Z",
      harness: "codex-acp",
      adapter: "acp",
    })).toMatchObject({
      type: "system.notice",
      session_id: "sess-codex-warning",
      turn_id: "",
      data: { message: diagnosticWarning, tone: "warning" },
    });
  });
});
