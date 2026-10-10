import { test, expect } from "./fixtures";
import { enableAgent, persistSessionFixture } from "./helpers";

test("sidebar navigation scrolls together while new chat and search stay fixed", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 700 });
  await enableAgent(page, "codex-acp");
  for (let i = 0; i < 35; i++) await persistSessionFixture(page, { sessionId: `density-${i}`, title: `Density task ${i}`, cwd: "", events: [] });
  await page.reload();
  const viewport = page.locator('[data-sidebar-scroll-area] [data-slot="scroll-area-viewport"]');
  const hostRow = page.locator(".sidebar-host-chrome .sidebar-grid-row").first();
  const heading = page.getByTestId("sidebar-local-runtime-row");
  await expect(heading).toHaveClass(/sidebar-grid-row/);
  await expect(heading).toBeVisible();
  const hostIconLeft = await hostRow.locator('[data-sidebar-grid="icon"]').evaluate((cell) => cell.getBoundingClientRect().left);
  const localIconLeft = await heading.locator('[data-sidebar-grid="icon"]').evaluate((cell) => cell.getBoundingClientRect().left);
  expect(Math.abs(hostIconLeft - localIconLeft)).toBeLessThanOrEqual(0.75);
  const search = page.getByRole("button", { name: "Search", exact: true });
  const searchTop = (await search.boundingBox())!.y;
  const headingTop = (await heading.boundingBox())!.y;
  const newChat = page.getByTestId("new-chat-button");
  const newChatTop = (await newChat.boundingBox())!.y;
  await viewport.evaluate(el => { el.scrollTop = 300; });
  await expect.poll(async () => Math.round(headingTop - (await heading.boundingBox())!.y)).toBe(300);
  expect((await newChat.boundingBox())!.y).toBe(newChatTop);
  expect(newChatTop).toBe(searchTop);
  expect((await search.boundingBox())!.x).toBeGreaterThan((await newChat.boundingBox())!.x);
  expect((await search.boundingBox())!.y).toBe(searchTop);
  await search.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await viewport.evaluate(el => { el.scrollTop = 0; });
  const nav = page.locator('[data-sidebar-scroll-area] nav');
  const projects = nav.getByRole("button", { name: "Projects", exact: true });
  const chats = nav.getByRole("button", { name: "Chats", exact: true });
  for (const section of [projects, chats]) {
    if (await section.getAttribute("aria-expanded") === "true") await section.click();
  }
  await expect.poll(async () => {
    const previous = (await projects.boundingBox())!;
    const next = (await chats.boundingBox())!;
    return Math.round(next.y - previous.y - previous.height);
  }).toBe(1);
});
