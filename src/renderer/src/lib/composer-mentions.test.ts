import { describe, expect, it } from "vitest";

import {
  createBrowseFileMentionCandidate,
  filterFileMentionCandidates,
  filterSessionMentionCandidates,
  consumeSessionMention,
  resolveSessionMention,
  type SessionMentionCandidate,
} from "./composer-mentions";

const file = (name: string, path = `/workspace/${name}`) => ({
  kind: "file" as const,
  id: `file-${name}`,
  label: name,
  path,
  attachment: {
    id: `file-${name}`,
    name,
    path,
    uri: `file://${path}`,
    kind: "file" as const,
  },
});

const sessions: SessionMentionCandidate[] = [
  { id: "session-design", label: "Design review", agentId: "codex-acp" },
  { id: "session-api", label: "API migration", agentId: "claude-acp" },
  { id: "session-archive", label: "Archived notes", agentId: "codex-acp" },
];

describe("composer session mentions", () => {
  it("resolves an @ token only when it is a standalone token at the caret", () => {
    expect(resolveSessionMention("Compare @des", 12)).toEqual({
      query: "des",
      start: 8,
      end: 12,
    });
    expect(resolveSessionMention("email me@design", 15)).toBeNull();
    expect(resolveSessionMention("@design then", 3)).toBeNull();
  });

  it("filters candidates by label and excludes the current session", () => {
    expect(filterSessionMentionCandidates(sessions, "session-api", "des"))
      .toEqual([sessions[0]]);
    expect(filterSessionMentionCandidates(sessions, "session-design", ""))
      .toEqual([sessions[1], sessions[2]]);
  });

  it("filters workspace files by name or relative path", () => {
    const files = [
      file("package.json"),
      file("README.md", "/workspace/docs/README.md"),
    ];
    expect(filterFileMentionCandidates(files, "package")).toEqual([files[0]]);
    expect(filterFileMentionCandidates(files, "docs/")).toEqual([files[1]]);
    expect(filterFileMentionCandidates(files, "")).toEqual(files);
  });

  it("provides a native picker candidate for files outside the workspace", () => {
    expect(createBrowseFileMentionCandidate()).toMatchObject({
      kind: "browse",
      id: "browse-files",
    });
  });

  it("consumes the active token because the selected session renders as an inline block", () => {
    expect(consumeSessionMention("Compare @des", 12)).toEqual({
      text: "Compare ",
      caret: 8,
    });
    expect(consumeSessionMention("@des later", 4)).toEqual({
      text: "later",
      caret: 0,
    });
  });
});
