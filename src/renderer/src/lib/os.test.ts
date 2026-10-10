import { describe, expect, it } from "vitest";

import { applyRendererOs, detectRendererOs } from "./os";

describe("detectRendererOs", () => {
  it("tags Windows before any other token", () => {
    expect(detectRendererOs("Mozilla/5.0 (Windows NT 10.0)")).toBe("windows");
    expect(detectRendererOs("Windows Macintosh")).toBe("windows");
  });

  it("tags Macintosh and the older Mac OS X token", () => {
    expect(detectRendererOs("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")).toBe("mac");
    expect(detectRendererOs("Mac OS X")).toBe("mac");
  });

  it("tags everything else, including Linux and an empty agent, as linux", () => {
    expect(detectRendererOs("X11; Linux x86_64")).toBe("linux");
    expect(detectRendererOs("")).toBe("linux");
  });
});

describe("applyRendererOs", () => {
  it("writes the detected os onto the document element", () => {
    const root = { dataset: {} as { os?: string } };
    expect(applyRendererOs(root, "Macintosh")).toBe("mac");
    expect(root.dataset.os).toBe("mac");
    applyRendererOs(root, "X11; Linux");
    expect(root.dataset.os).toBe("linux");
  });
});
