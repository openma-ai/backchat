import { test, expect } from "./fixtures";
test("project popup shares the command palette anchor and keeps actions reachable when content grows", async ({
  page,
  app,
}) => {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!;
    w.webContents.setZoomFactor(1);
    w.setContentSize(1000, 700);
  });
  await page.keyboard.press("Meta+k");
  const palette = page.getByRole("dialog", {
    name: "Command palette",
    exact: true,
  });
  await expect(palette).toBeVisible();
  const reference = await palette.boundingBox();
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const form = page.getByRole("dialog", { name: "New project", exact: true });
  const initial = await form.boundingBox();
  expect(Math.abs(initial!.y - reference!.y)).toBeLessThan(2);
  expect(Math.abs(initial!.width - reference!.width)).toBeLessThan(2);
  await form.getByText("Add context", { exact: false }).click();
  const expanded = await form.boundingBox();
  expect(expanded!.y).toBe(initial!.y);
  await expect(
    form.getByRole("button", { name: "Create project", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await form.screenshot({
    path: "artifacts/projects-work/basic-popup.png",
    scale: "css",
  });
  await page.keyboard.press("Escape");
  await expect(form).toBeHidden();
});
