import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { translate } from "@/lib/i18n";
import { Tabs } from "@/components/ui/tabs";
import { ProjectOverviewTabs, ProjectRoutines } from "./ProjectOverview";
import type { ScheduleInfo } from "@shared/schedules";
vi.mock("@/lib/i18n", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/i18n")>(),
  useI18n: () => ({ locale: "en", t: (key: string) => translate("en", key) }),
}));
it.each([false, true])("renders Overview labels with PR visibility %s", hasPullRequests => {
  const html = renderToStaticMarkup(<Tabs value="workers"><ProjectOverviewTabs hasPullRequests={hasPullRequests} /></Tabs>);
  expect(html).toContain("Workers");
  expect(html).toContain("Library");
  expect(html).toContain("Routine");
  expect(html.includes("Pull requests")).toBe(hasPullRequests);
  expect(html).not.toMatch(/Threads|Activity|Scheduled tasks/);
});
it("renders real routine name, trigger, status and next/last run", () => {
  const html = renderToStaticMarkup(<ProjectRoutines pending={false} error={null} routines={[{
    id: "routine", name: "Daily checks", status: "paused", trigger: { type: "interval", everyMs: 3_600_000 },
    nextRunAt: null, lastRunAt: 1_800_000_000_000,
  } as ScheduleInfo]} />);
  for (const label of ["Daily checks", "Every hour", "paused", "Next run", "Last run"]) expect(html).toContain(label);
  expect(renderToStaticMarkup(<ProjectRoutines pending={false} error={null} routines={[]} />)).toContain("No routines for this project yet.");
});
it("uses translated Overview labels", () => {
  expect(translate("zh-CN", "project.workers")).toBe("工作代理");
  expect(translate("zh-CN", "project.routine")).toBe("例行任务");
});
