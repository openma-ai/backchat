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
    // ::placeholder never animates in Chromium; the sweep must target a real element.
    expect(styles).not.toContain("::placeholder {\n  background-image");
  });

  it("forwards status semantics to the span", () => {
    const html = renderToStaticMarkup(
      <ShimmerText role="status" data-composer-harness-probe="true">Checking</ShimmerText>,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('data-composer-harness-probe="true"');
  });
});
