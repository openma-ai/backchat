/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TaskListActivity } from "./TaskListActivity";

describe("TaskListActivity", () => {
  it("keeps a standalone ACP todo plan in the shared activity row slot", () => {
    const html = renderToStaticMarkup(
      <TaskListActivity
        items={[
          { label: "Inspect files", status: "completed" },
          { label: "Ship change", status: "in_progress" },
        ]}
      />,
    );

    expect(html).toContain('data-plan-activity="true"');
    expect(html).toContain("activity-disclosure-row");
    expect(html).toContain("Plan");
    expect(html).toContain("1 / 2");
    expect(html).not.toContain("border-l-2");
  });

  it("renders a cancelled adapter task as terminal rather than pending", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(
      <TaskListActivity
        items={[
          { label: "Keep this task", status: "in_progress" },
          { label: "Drop obsolete task", status: "cancelled" },
        ]}
      />,
    ));
    // The task list mounts when the plan is expanded.
    act(() => host.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click());

    expect(host.innerHTML).toContain('data-task-status="cancelled"');
    expect(host.innerHTML).toContain("lucide-circle-slash");
    act(() => root.unmount());
  });
});
