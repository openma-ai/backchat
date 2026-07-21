import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Scheduled page", () => {
  it("uses the same content inset as the settings main surface", async () => {
    const source = await readFile(new URL("./Scheduled.tsx", import.meta.url), "utf8");

    expect(source).toContain('className="w-full px-8 pb-16 pt-8"');
    expect(source).not.toContain("max-w-[1120px]");
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
});
