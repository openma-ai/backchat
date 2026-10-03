import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendEvent,
  closeSessionDb,
  openSessionDb,
  setSessionExternalClient,
  upsertSession,
} from "../sql-store.js";
import type { ProjectWorkView } from "../../shared/project-work.js";
import {
  externalClientWorkFacts,
  mergeExternalClientSessionsIntoWorkView,
} from "./external-client-work-sessions.js";

const roots: string[] = [];

afterEach(async () => {
  closeSessionDb();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("external client work sessions", () => {
  it("merges CLI SQL sessions and user prompts into work.view facts", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-ext-work-"));
    roots.push(root);
    openSessionDb(join(root, "sessions.db"));
    const projectId = "proj-cli";
    upsertSession({
      id: "sess-cli",
      agent_id: "codex-acp",
      cwd: root,
      project_id: projectId,
      title: "CLI thread",
    });
    setSessionExternalClient("sess-cli", "cursor killer");
    appendEvent("sess-cli", "user_prompt", { text: "hello from cli" });

    const facts = externalClientWorkFacts(projectId, "cursor killer");
    expect(facts.sessions.map((session) => session.id)).toEqual(["sess-cli"]);
    expect(facts.turns[0]?.contextDigest).toContain("hello from cli");

    const merged = mergeExternalClientSessionsIntoWorkView(projectId, "cursor killer", {
      facts: { sessions: [], turns: [] } as unknown as ProjectWorkView["facts"],
    });
    expect(merged.facts.sessions.map((session) => session.id)).toEqual(["sess-cli"]);
    expect(merged.facts.turns).toHaveLength(1);
  });
});
