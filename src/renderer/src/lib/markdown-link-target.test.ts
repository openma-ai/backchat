import { describe, expect, it } from "vitest";

import {
  markdownFileLabel,
  markdownFileUrl,
  resolveMarkdownLinkTarget,
} from "./markdown-link-target";

describe("resolveMarkdownLinkTarget", () => {
  it("keeps HTTP links external and file URLs as filesystem targets", () => {
    expect(resolveMarkdownLinkTarget("https://example.test/docs", null)).toEqual({
      kind: "http",
      url: "https://example.test/docs",
    });
    expect(resolveMarkdownLinkTarget("file:///tmp/report.html", null)).toEqual({
      kind: "file",
      path: "/tmp/report.html",
    });
  });

  it("recognizes POSIX, Windows drive, and UNC absolute paths", () => {
    expect(resolveMarkdownLinkTarget("/tmp/report.md", "/workspace")).toEqual({
      kind: "file",
      path: "/tmp/report.md",
    });
    expect(resolveMarkdownLinkTarget(
      "C:\\Users\\mini\\report.md",
      "C:\\workspace",
    )).toEqual({
      kind: "file",
      path: "C:\\Users\\mini\\report.md",
    });
    expect(resolveMarkdownLinkTarget(
      "\\\\server\\share\\report.md",
      "C:\\workspace",
    )).toEqual({
      kind: "file",
      path: "\\\\server\\share\\report.md",
    });
  });

  it("decodes the percent-encoded href emitted by the browser for Unicode paths", () => {
    expect(resolveMarkdownLinkTarget(
      "/tmp/%E6%9C%AA%E5%91%BD%E5%90%8D%E6%96%87%E6%A1%A3.docx",
      "/workspace",
    )).toEqual({
      kind: "file",
      path: "/tmp/未命名文档.docx",
    });
  });

  it("resolves relative paths with the cwd platform separator", () => {
    expect(resolveMarkdownLinkTarget(
      "./out/report.html",
      "/Users/mini/project/",
    )).toEqual({
      kind: "file",
      path: "/Users/mini/project/out/report.html",
    });
    expect(resolveMarkdownLinkTarget(
      ".\\out\\report.html",
      "C:\\Users\\mini\\project\\",
    )).toEqual({
      kind: "file",
      path: "C:\\Users\\mini\\project\\out\\report.html",
    });
  });

  it("leaves fragments, queries, mail links, and cwd-less relatives inert", () => {
    for (const url of ["", "#details", "?tab=one", "mailto:user@example.test"]) {
      expect(resolveMarkdownLinkTarget(url, "/workspace")).toEqual({
        kind: "inert",
      });
    }
    expect(resolveMarkdownLinkTarget("report.md", null)).toEqual({
      kind: "inert",
    });
  });

  it("builds valid file URLs and labels for POSIX and Windows HTML paths", () => {
    expect(markdownFileUrl("/Users/mini/project/report.html")).toBe(
      "file:///Users/mini/project/report.html",
    );
    expect(markdownFileUrl("C:\\Users\\mini\\project\\report.html")).toBe(
      "file:///C:/Users/mini/project/report.html",
    );
    expect(markdownFileUrl("\\\\server\\share\\report.html")).toBe(
      "file://server/share/report.html",
    );
    expect(markdownFileLabel("/Users/mini/project/report.html")).toBe(
      "report.html",
    );
    expect(markdownFileLabel("C:\\Users\\mini\\project\\report.html")).toBe(
      "report.html",
    );
  });
});
