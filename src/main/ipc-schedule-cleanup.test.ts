import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ipc = readFileSync(new URL("./ipc.ts", import.meta.url), "utf8");

describe("session archive removes owned schedules", () => {
  it("deletes source-session schedules when a chat is archived or hard-deleted", () => {
    const archiveHandler = ipc.slice(
      ipc.indexOf("InvokeChannel.SessionsArchive"),
      ipc.indexOf("InvokeChannel.SessionsUnarchive"),
    );
    const deleteHandler = ipc.slice(
      ipc.indexOf("InvokeChannel.SessionsDelete"),
      ipc.indexOf("InvokeChannel.SessionsLoadHistory"),
    );

    expect(archiveHandler).toContain("scheduleStore.deleteBySourceSession(p.session_id)");
    expect(archiveHandler).toContain("scheduleEngine.reschedule()");
    expect(deleteHandler).toContain("scheduleStore.deleteBySourceSession(p.session_id)");
    expect(deleteHandler).toContain("scheduleEngine.reschedule()");
  });
});
