import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OpenmaRunnerOutbox } from "./openma-runner-outbox.js";

describe("runner output delivery", () => {
  it("starts a fresh stream after best-effort delivery to a legacy service", () => {
    const dir = mkdtempSync(join(tmpdir(), "runner-outbox-legacy-"));
    const box = new OpenmaRunnerOutbox(join(dir, "outbox.db"), "scope");
    try {
      const first = box.append({ type: "session.event", tenant_id: "a", session_id: "s", event: {} });
      const second = box.append({ type: "session.complete", tenant_id: "a", session_id: "s" });
      box.acknowledge(first, true);
      expect(box.pending()).toEqual([second]);
      box.acknowledge(second, true);
      const upgraded = box.append({ type: "session.event", tenant_id: "a", session_id: "s", event: {} });
      expect(upgraded.delivery.seq).toBe(1);
      expect(upgraded.delivery.stream_id).not.toBe(first.delivery.stream_id);
    } finally { box.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  it("survives reopening, retains unconfirmed output and scopes acknowledgements", () => {
    const dir = mkdtempSync(join(tmpdir(), "runner-outbox-"));
    const path = join(dir, "private", "outbox.db");
    let box = new OpenmaRunnerOutbox(path, "server/user/runtime");
    try {
      const first = box.append({ type: "session.event", tenant_id: "a", session_id: "s", turn_id: "t", event: { text: "one" } });
      const second = box.append({ type: "session.complete", tenant_id: "a", session_id: "s", turn_id: "t" });
      const other = box.append({ type: "session.event", tenant_id: "b", session_id: "s", event: { text: "private" } });
      expect(second.delivery).toEqual({ stream_id: first.delivery.stream_id, seq: first.delivery.seq + 1 });
      expect(other.delivery.stream_id).not.toBe(first.delivery.stream_id);
      box.close();
      box = new OpenmaRunnerOutbox(path, "server/user/runtime");
      expect(box.pending()).toEqual([first, second, other]);
      for (const ack of [
        { ...first, tenant_id: "b" }, { ...first, session_id: "different" },
        { ...first, delivery: { ...first.delivery, seq: 1000 } },
      ]) box.acknowledge(ack);
      expect(box.pending()).toHaveLength(3);
      box.acknowledge(first);
      box.acknowledge(first);
      expect(box.pending()).toEqual([second, other]);
      const separate = new OpenmaRunnerOutbox(path, "different-account");
      try { expect(separate.pending()).toEqual([]); separate.acknowledge(second); }
      finally { separate.close(); }
      expect(box.pending()).toEqual([second, other]);
      box.acknowledge(second);
      const next = box.append({ type: "session.ready", tenant_id: "a", session_id: "s", acp_session_id: "native" });
      expect(next.delivery).toEqual({ stream_id: first.delivery.stream_id, seq: second.delivery.seq + 1 });
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(statSync(join(dir, "private")).mode & 0o777).toBe(0o700);
    } finally { box.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
