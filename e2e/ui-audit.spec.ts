import { test, expect } from "./fixtures";

test("audit desktop shells at standard and minimum widths", async ({ page, app }) => {
  const results: unknown[] = [];
  for (const width of [1280, 720]) {
    await app.evaluate(({ BrowserWindow }, width) => { BrowserWindow.getAllWindows()[0]!.setSize(width, 800); }, width);
    for (const dark of [false, true]) {
      await page.evaluate(async dark => {
        const settings = await window.backchat.settingsGet();
        await window.backchat.settingsPatch({ appearance: { ...settings.appearance, theme: dark ? "dark" : "light" } });
      }, dark);
      await expect(page.locator("html")).toHaveAttribute("data-theme-mode", dark ? "dark" : "light");
      await page.getByRole("link", { name: "Settings", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();

      results.push(await page.evaluate(({ width, dark }) => {
        const visible = (el: Element) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
        return { width, dark, viewport: innerWidth, main: document.querySelector('main')?.getBoundingClientRect().toJSON(), clippedControls: [...document.querySelectorAll('button, input, textarea')].filter(visible).filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => ({ text: el.textContent?.trim().slice(0,60), label: el.getAttribute('aria-label'), right: el.getBoundingClientRect().right })), documentOverflow: document.documentElement.scrollWidth > innerWidth,
          unnamedButtons: [...document.querySelectorAll('button')].filter(visible).filter(el => !el.textContent?.trim() && !el.getAttribute('aria-label') && !el.getAttribute('title')).map(el => el.outerHTML.slice(0, 200)),
          textColors: [...document.querySelectorAll('h1, p')].filter(visible).slice(0, 6).map(el => ({ text: el.textContent?.slice(0, 50), color: getComputedStyle(el).color, size: getComputedStyle(el).fontSize })),
        };
      }, { width, dark }));
      await page.getByRole("button", { name: "Back to app", exact: true }).click();

    }
  }
  console.log(JSON.stringify(results));
});
