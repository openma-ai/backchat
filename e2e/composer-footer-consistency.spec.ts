import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { expect, test } from "./fixtures";

test("footer selects share project picker styling, search, keyboard and focus behavior", async ({ page, home, capture }) => {
  const repo = join(home, "footer-repo");
  await mkdir(repo, { recursive: true });
  execFileSync("git", ["init", "--initial-branch=main", repo]);
  await page.evaluate(async path => {
    localStorage.setItem("backchat:workspace-intro-seen:v1", "1");
    await window.backchat.projectSave({ project_id: "footer", name: "Footer project", source_folders: [path], primary_folder: path });
  }, repo);
  await page.reload();
  await page.getByTestId("new-chat-button").click();
  await page.locator('[data-composer-footer-control="project"]').click();
  await page.getByRole("option", { name: "Footer project", exact: true }).click();
  const styles: unknown[] = [];
  const triggerStyles: unknown[] = [];
  for (const [control, panel, query] of [
    ["project", "composer-project-picker-panel", "Footer project"],
    ["runtime", "composer-host-picker-panel", "Local"],
    ["workspace", "composer-workspace-picker-panel", "Local"],
  ]) {
    const trigger = page.locator(`[data-composer-footer-control="${control}"]`);
    await expect(trigger).toBeVisible();
    await trigger.hover();
    const hoverColor=await trigger.evaluate(el=>getComputedStyle(el).backgroundColor);
    await trigger.click();
    await expect(trigger).toHaveCSS('background-color',hoverColor);
    triggerStyles.push(await trigger.evaluate(async el => {
      await Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => undefined)));
      const css = getComputedStyle(el);
      return { height: css.height, padding: css.padding, gap: css.gap, radius: css.borderRadius, background: css.backgroundColor, font: css.fontSize };
    }));
    const menu = page.getByTestId(panel);
    await expect(menu).toBeVisible();
    const distance=await menu.evaluate(el=>{
      const shell=el.closest('[data-slot="popover-content"]')!;
      const trigger=document.querySelector('[data-composer-footer-control][data-state="open"]')!;
      return trigger.getBoundingClientRect().top-shell.getBoundingClientRect().bottom;
    });
    expect(distance).toBeGreaterThanOrEqual(5);
    await expect(trigger).toHaveCSS('clip-path','none');
    const input = menu.getByRole("combobox");
    await expect(input).toBeFocused();
    await expect(menu).toHaveAttribute("data-menu-density", "comfortable");
    styles.push(await menu.evaluate(el => {
      const command = el.querySelector('[cmdk-root]')!;
      const shell = el.closest('[data-slot="popover-content"]')!;
      const css = getComputedStyle(command);
      const outer = getComputedStyle(shell);
      return { radius: css.borderRadius, padding: css.padding, background: css.backgroundColor, width: outer.width, offset: outer.getPropertyValue('--radix-popover-content-available-height') !== "" };
    }));
    await input.fill("no-such-footer-option");
    await expect(menu.locator("[cmdk-list] [role=option]")).toHaveCount(0);
    await input.fill(query);
    await input.press("ArrowDown");
    await expect(menu.locator('[data-roving-active="true"]')).toHaveCount(1);
    await input.press("Enter");
    await expect(menu).not.toBeVisible();
    await trigger.click();
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-checked="true"]')).toHaveCount(1);
    await input.fill(query);
    await capture(`footer-${control}.png`);
    await input.press("Escape");
    await expect(menu).not.toBeVisible();
    await expect(trigger).toBeFocused();
  }
  expect(styles[1]).toEqual(styles[0]);
  expect(styles[2]).toEqual(styles[0]);
  expect(triggerStyles[1]).toEqual(triggerStyles[0]);
  expect(triggerStyles[2]).toEqual(triggerStyles[0]);
});
