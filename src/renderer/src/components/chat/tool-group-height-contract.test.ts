import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** An expanded tool group (Running / Ran … with dozens of rows) must not push
 *  the answer off-screen: its panel is height-capped and scrolls inside. The
 *  group markup comes from @openma/common, so the cap lives in app CSS keyed
 *  on the group's stable data attribute. */
describe("expanded tool group height cap", () => {
  const styles = readFileSync(resolve(__dirname, "../../styles/index.css"), "utf8");
  const rule = (selector: string) => {
    const start = styles.indexOf(`${selector} {`);
    expect(start, `missing rule ${selector}`).toBeGreaterThan(-1);
    return styles.slice(start, styles.indexOf("}", start));
  };

  it("caps the group panel and scrolls it", () => {
    const panel = rule("[data-tool-group-size] > [aria-controls] + [id]");
    expect(panel).toMatch(/max-height:\s*var\(--tool-group-max-h\)/);
    expect(panel).toMatch(/overflow-y:\s*auto/);
    expect(panel).toMatch(/overscroll-behavior:\s*contain/);
    expect(styles).toMatch(/--tool-group-max-h:\s*min\(\d+px,\s*\d+vh\)/);
  });
});

/** Turns come from @openma/common with a mount-time `reveal-in` fade. A turn
 *  remounts when it is sent and again when its first token lands, so the fade
 *  replays and the whole turn (prompt bubble included) blinks. */
describe("transcript turns do not replay the reveal fade", () => {
  const styles = readFileSync(resolve(__dirname, "../../styles/index.css"), "utf8");
  it("disables reveal-in on transcript turn articles", () => {
    const start = styles.indexOf("article.reveal-in[data-turn-id] {");
    expect(start).toBeGreaterThan(-1);
    expect(styles.slice(start, styles.indexOf("}", start))).toMatch(/animation:\s*none/);
  });
});
