import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StreamingThoughtProjection } from "./StreamingThoughtProjection";

describe("StreamingThoughtProjection", () => {
  it("keeps one ellipsized header row for each explicit thinking line", () => {
    const html = renderToStaticMarkup(
      <StreamingThoughtProjection
        turnId="turn-thinking-header"
        prefixSkip={0}
        fallback={
          "A very long first line that must not wrap into the next visual row.\n"
          + "A second explicit line.\n\nA third paragraph."
        }
        mode="body"
      />,
    );

    expect(html.match(/data-thought-projection-line="true"/g)).toHaveLength(3);
    expect(html.match(/class="[^"]*truncate[^"]*"/g)).toHaveLength(3);
    expect(html).toContain("A very long first line");
    expect(html).toContain("A second explicit line.");
    expect(html).toContain("A third paragraph.");
  });
});
