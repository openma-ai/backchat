/**
 * @vitest-environment happy-dom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ShimmerText } from "./ShimmerText";

const styles = readFileSync(resolve(__dirname, "../../styles/index.css"), "utf8");

describe("ShimmerText", () => {
  it("renders the shimmer-text utility class", () => {
    const html = renderToStaticMarkup(<ShimmerText>Checking Codex…</ShimmerText>);
    expect(html).toContain('class="shimmer-text"');
    expect(html).toContain("Checking Codex…");
  });

  it("defines a repeating sweep animation in global styles", () => {
    expect(styles).toContain("@keyframes shimmer-text-sweep");
    expect(styles).toContain(".shimmer-text");
    expect(styles).toContain("composer-harness-probe-placeholder");
  });
});
