import { expect, test } from "./fixtures";

/** Does the focused control's ring survive on all four sides? */
async function ringSides(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const button = document.querySelector<HTMLElement>(
      'button[aria-label="Attach files"]',
    );
    if (!button) return null;
    button.focus();
    const parent = button.parentElement!;
    const parentBox = parent.getBoundingClientRect();
    const box = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    const reach =
      parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
    // Room for the ring means the clip box extends past the control by at
    // least the distance the ring is drawn at, on every side.
    return {
      focusVisible: button.matches(":focus-visible"),
      reach: Math.round(reach * 100) / 100,
      top: Math.round((box.top - parentBox.top) * 100) / 100,
      left: Math.round((box.left - parentBox.left) * 100) / 100,
      bottom: Math.round((parentBox.bottom - box.bottom) * 100) / 100,
      clipped: getComputedStyle(parent).overflowX,
    };
  });
}

test("a focused composer control keeps its whole focus ring", async ({
  page,
}) => {
  // The control row clips its content so a long chip truncates. It used to be
  // exactly as tall as its controls, so the outline drawn outside a focused
  // button lost three of its four sides and the surviving edge read as a stray
  // background behind the button.
  const sides = await ringSides(page);
  expect(sides).not.toBeNull();
  expect(sides!.focusVisible).toBe(true);
  expect(sides!.clipped).toBe("hidden");
  expect(sides!.reach).toBeGreaterThan(0);
  expect(sides!.top).toBeGreaterThanOrEqual(sides!.reach);
  expect(sides!.bottom).toBeGreaterThanOrEqual(sides!.reach);
  expect(sides!.left).toBeGreaterThanOrEqual(sides!.reach);
});
