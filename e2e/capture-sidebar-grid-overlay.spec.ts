import { mkdir } from "node:fs/promises";
import { expect, test } from "./fixtures";
import { enableAgent, launchApp } from "./helpers";
import { TestBridge } from "./test-bridge";

const artifactDir = "/opt/cursor/artifacts/screenshots";

test("capture sidebar grid overlay (zh)", async () => {
  test.setTimeout(120_000);
  await mkdir(artifactDir, { recursive: true });

  const { page, cleanup } = await launchApp({
    language: "zh-CN",
    env: { BACKCHAT_E2E_VISIBLE: "1" },
  });
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await enableAgent(page, "codex-acp");
    const bridge = new TestBridge(page);
    for (let index = 0; index < 20; index += 1) {
      await bridge.injectSessionRow({
        session_id: `grid-overlay-${index}`,
        agent_id: "codex-acp",
        cwd: "",
      });
    }

    const sidebarViewport = page.locator(
      '[data-sidebar-scroll-area="true"] [data-slot="scroll-area-viewport"]',
    );
    await sidebarViewport.evaluate((el) => {
      el.scrollTop = Math.floor(el.scrollHeight / 4);
    });

    await page.locator(".sidebar-host-chrome").hover();
    await page.locator(".sidebar-section-header").filter({
      has: page.getByRole("button", { name: "对话", exact: true }),
    }).hover();

    await page.addStyleTag({
      content: `
        .sidebar-navigation .sidebar-grid-row {
          outline: 1px dashed oklch(0.55 0.12 30 / 0.85);
          outline-offset: -1px;
        }
        .sidebar-navigation [data-sidebar-grid="icon"] {
          background: oklch(0.62 0.08 30 / 0.18);
        }
        .sidebar-navigation [data-sidebar-grid="label"] {
          background: oklch(0.55 0.06 250 / 0.1);
        }
        .sidebar-navigation [data-sidebar-grid="trailing"] {
          background: oklch(0.7 0.1 145 / 0.14);
        }
        .sidebar-navigation [data-sidebar-grid="trailing"] {
          background-image: linear-gradient(
            to right,
            transparent calc(50% - 0.5px),
            oklch(0.45 0.1 30 / 0.55) calc(50% - 0.5px),
            oklch(0.45 0.1 30 / 0.55) calc(50% + 0.5px),
            transparent calc(50% + 0.5px)
          );
        }
        .sidebar-navigation [data-sidebar-grid="icon"]::after,
        .sidebar-navigation [data-sidebar-grid-action="penultimate"]::after,
        .sidebar-navigation [data-sidebar-grid-action="last"]::after {
          content: "";
          position: absolute;
          top: 0;
          bottom: 0;
          left: 50%;
          width: 1px;
          transform: translateX(-50%);
          background: oklch(0.45 0.1 30 / 0.75);
          pointer-events: none;
        }
        .sidebar-navigation [data-sidebar-grid="icon"],
        .sidebar-navigation [data-sidebar-grid-action="penultimate"],
        .sidebar-navigation [data-sidebar-grid-action="last"] {
          position: relative;
        }
      `,
    });

    const sidebar = page.locator(".sidebar-navigation");
    await expect(sidebar).toBeVisible();
    await page.waitForTimeout(150);

    await sidebar.screenshot({
      path: `${artifactDir}/sidebar-grid-overlay-zh.png`,
    });
  } finally {
    await cleanup();
  }
});
