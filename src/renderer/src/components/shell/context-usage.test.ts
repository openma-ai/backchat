import { describe, expect, test } from "vitest";

import { contextUsagePresentation } from "./context-usage";

describe("contextUsagePresentation", () => {
  test("computes compact usage text and semantic thresholds", () => {
    expect(
      contextUsagePresentation({ used: 72_000, size: 258_400 }),
    ).toMatchObject({ label: "Context 28%", tone: "muted" });
    expect(
      contextUsagePresentation({ used: 206_720, size: 258_400 }),
    ).toMatchObject({ label: "Context 80%", tone: "warning" });
    expect(
      contextUsagePresentation({ used: 95, size: 100 }),
    ).toMatchObject({ label: "Context 95%", tone: "danger" });
  });

  test("includes exact usage and optional cost in the accessible title", () => {
    expect(
      contextUsagePresentation({
        used: 12_345,
        size: 100_000,
        cost: { amount: 0.42, currency: "USD" },
      }).title,
    ).toBe("Context · 12,345 / 100,000 tokens · 0.42 USD");
  });
});
