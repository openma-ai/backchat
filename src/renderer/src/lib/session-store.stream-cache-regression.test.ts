import { expect, test } from "vitest";
import { SessionStore } from "./session-store";

test("completion republishes all streamed text after an earlier projection", () => {
  const store = new SessionStore();
  store.registerStarting("s", "codex-acp", "Stream");
  store.registerTurn("t", "s", "hello");
  const chunk = (text: string) =>
    store.apply({
      type: "session.event",
      session_id: "s",
      turn_id: "t",
      event: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    });
  chunk("First");
  expect(store.projectTurn(store.turnsFor("s")[0]!).assistantText).toBe("First");
  chunk(" and last");
  // In-place mutate must not freeze the first-token projection.
  expect(store.projectTurn(store.turnsFor("s")[0]!).assistantText).toBe(
    "First and last",
  );
  store.apply({ type: "session.complete", session_id: "s", turn_id: "t" });
  const done = store.turnsFor("s")[0]!;
  expect(done.status).toBe("complete");
  expect(done.assistantText).toBe("First and last");
  expect(store.projectTurn(done).assistantText).toBe("First and last");
  // Text-only completed turns drop event shells (MEMORY); projectTurn synthesizes.
  expect(done.events).toHaveLength(0);
});
