import { expect, test } from "./fixtures";

test("sidebar edge resizes above, beside, and below its scroll area", async ({ page, bridge }) => {
  await page.setViewportSize({ width: 1200, height: 700 });
  for (let index = 0; index < 24; index += 1) {
    await bridge.injectSessionRow({
      session_id: `sidebar-resize-${index}`,
      agent_id: "codex-acp",
      cwd: "",
    });
  }

  const handle = page.getByRole("separator", { name: "Resize sidebar", exact: true });
  const sidebar = page.locator("aside").filter({ has: handle });
  const scrollArea = sidebar.locator('[data-sidebar-scroll-area="true"]');
  const viewport = scrollArea.locator('[data-slot="scroll-area-viewport"]');
  const footer = sidebar.locator('[data-sidebar-footer-actions="true"]');
  await expect(viewport).toHaveCount(1);

  for (const region of ["header", "scroll-area", "footer"] as const) {
    const sidebarBox = (await sidebar.boundingBox())!;
    const contentBox = (await (region === "footer" ? footer : scrollArea).boundingBox())!;
    const x = sidebarBox.x + sidebarBox.width - 1;
    const y = region === "header"
      ? sidebarBox.y + 70
      : region === "scroll-area"
        ? contentBox.y + contentBox.height - 20
        : contentBox.y + contentBox.height / 2;
    await page.mouse.move(x, y);
    const hitTarget = await page.evaluate(({ x, y }) =>
      document.elementFromPoint(x, y)?.closest('[role="separator"]')?.getAttribute("aria-label"),
    { x, y });
    expect(hitTarget, `${region} edge must reach the resize handle`).toBe("Resize sidebar");
    await page.mouse.down();
    await page.mouse.move(x + 40, y, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await sidebar.boundingBox())!.width)
      .toBeCloseTo(sidebarBox.width + 40, 0);
  }

  await viewport.evaluate((element) => {
    element.scrollTop = 0;
    element.scrollTop = Math.min(240, element.scrollHeight);
  });
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});
