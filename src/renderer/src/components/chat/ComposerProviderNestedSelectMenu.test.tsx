import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ComposerSearchableSelectMenu } from "./ComposerSearchableSelectMenu";

describe("ComposerSearchableSelectMenu (grouped command)", () => {
  it("renders provider command groups for large multi-provider lists", () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      value: `model-${index}`,
      label: `Model ${index}`,
      groupName: index % 2 === 0 ? "anthropic-proxy" : "openai-codex",
    }));
    const html = renderToStaticMarkup(
      <ComposerSearchableSelectMenu
        items={items}
        activeValue="model-3"
        onSelect={() => {}}
        searchPlaceholder="Search"
        emptyMessage="None"
      />,
    );
    expect(html).toContain('data-slot="command-group"');
    expect(html).toContain("anthropic-proxy");
    expect(html).toContain("openai-codex");
    expect(html).toContain("Model 0");
  });
});
