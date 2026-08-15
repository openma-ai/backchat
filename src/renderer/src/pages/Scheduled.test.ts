import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Scheduled page", () => {
  it("uses the shared appearance page skeleton", async () => {
    const source = await readFile(new URL("./Scheduled.tsx", import.meta.url), "utf8");

    expect(source).toContain("<ContentPage>");
    expect(source).toContain("<PageScaffold");
    expect(source).toContain("{schedule.prompt}");
    expect(source).not.toContain("max-w-2xl");
    expect(source).not.toContain("max-w-[1120px]");
    expect(source).not.toContain("rounded-xl border border-border/55");
    expect(source).not.toContain("StatusCount");
  });

  it("offers one-time, interval, cron, and RRULE scheduling", async () => {
    const source = await readFile(new URL("./Scheduled.tsx", import.meta.url), "utf8");
    expect(source).toContain('value="at"');
    expect(source).toContain('value="interval"');
    expect(source).toContain('value="cron"');
    expect(source).toContain('value="rrule"');
  });

  it("manages schedules and run history through the preload boundary", async () => {
    const source = await readFile(new URL("./Scheduled.tsx", import.meta.url), "utf8");
    expect(source).toContain("window.backchat.schedulesCreate");
    expect(source).toContain("window.backchat.schedulesUpdate");
    expect(source).toContain("window.backchat.schedulesDelete");
    expect(source).toContain("window.backchat.scheduleRunsList");
  });

  it("switches All, Active, and Paused without showing completed by default", async () => {
    const source = await readFile(new URL("./Scheduled.tsx", import.meta.url), "utf8");
    expect(source).toContain("scheduleRowsForTab");
    expect(source).toContain('role="tablist"');
    expect(source).toContain('"scheduled.all"');
    expect(source).toContain('"scheduled.active"');
    expect(source).toContain('"scheduled.paused"');
    expect(source).toContain('to="/chat/$sessionId"');
    expect(source).toContain("schedule.sourceSessionId");
    expect(source).toContain("scheduleSourceSessionLabel");
    expect(source).not.toContain('tone="completed"');
  });
});
