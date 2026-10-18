import { describe, expect, it } from "vitest";
import {
  fileIconName,
  fileIconUrl,
  folderIconName,
  folderIconUrl,
} from "./file-icons";

describe("file icons (material-icon-theme manifest)", () => {
  it("resolves by exact file name before extension", () => {
    expect(fileIconName("package.json")).toBe("nodejs");
    expect(fileIconName("tsconfig.json")).toBe("tsconfig");
    expect(fileIconName("pnpm-lock.yaml")).toBe("pnpm");
  });

  it("matches file names case-insensitively", () => {
    expect(fileIconName("PACKAGE.JSON")).toBe("nodejs");
  });

  it("prefers the longest compound extension", () => {
    expect(fileIconName("index.ts")).toBe("typescript");
    expect(fileIconName("App.tsx")).toBe("react_ts");
    expect(fileIconName("types.d.ts")).not.toBe("typescript");
  });

  it("falls back to the language table and then the generic file icon", () => {
    expect(fileIconName("data.json")).toBe("json");
    expect(fileIconName("no-extension-here")).toBe("file");
  });

  it("picks named and open/closed folder icons", () => {
    expect(folderIconName("src", false)).toBe("folder-src");
    expect(folderIconName("src", true)).toBe("folder-src-open");
    expect(folderIconName("whatever-dir", false)).toBe("folder");
    expect(folderIconName("whatever-dir", true)).toBe("folder-open");
  });

  it("returns an asset url for every resolved icon", () => {
    // Vite may inline small SVGs as data: URLs, so assert presence and
    // distinctness rather than a file path.
    const ts = fileIconUrl("index.ts");
    const generic = fileIconUrl("zzz.unknownext");
    expect(ts).toBeTruthy();
    expect(generic).toBeTruthy();
    expect(ts).not.toBe(generic);
    expect(folderIconUrl("src", true)).not.toBe(folderIconUrl("src", false));
  });
});
