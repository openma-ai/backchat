import { describe, expect, it } from "vitest";
import {
  extractCodexFileCitations,
  extractToolOutputFiles,
} from "./session-artifacts";

describe("extractToolOutputFiles", () => {
  it("uses explicit ACP locations and file resources but ignores diff paths", () => {
    expect(extractToolOutputFiles({
      locations: [{ path: "/work/report.csv" }],
      content: [
        { type: "diff", path: "/work/app.ts", newText: "export {}" },
        {
          type: "content",
          content: { type: "resource_link", uri: "file:///work/chart.png" },
        },
      ],
    })).toEqual([
      "/work/report.csv",
      "/work/chart.png",
    ]);
  });
});

describe("extractCodexFileCitations", () => {
  it("separates explicit output and source directives and defaults to output", () => {
    expect(extractCodexFileCitations(`
      :codex-file-citation{path="/work/deck.pptx" purpose="output"}
      ::codex-file-citation{path='/work/input.csv' purpose='source'}
      :codex-file-citation{path="/work/report.pdf"}
    `)).toEqual({
      outputs: ["/work/deck.pptx", "/work/report.pdf"],
      sources: ["/work/input.csv"],
    });
  });

  it("ignores malformed directives and non-deliverable outputs", () => {
    expect(extractCodexFileCitations(`
      :codex-file-citation{purpose="output"}
      :codex-file-citation{path="/work/app.tsx" purpose="output"}
      :codex-file-citation{path="/work/reference.tsx" purpose="source"}
    `)).toEqual({
      outputs: [],
      sources: ["/work/reference.tsx"],
    });
  });
});
