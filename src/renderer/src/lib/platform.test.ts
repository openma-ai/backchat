import { describe, expect, it } from "vitest";

import { translate } from "./i18n";
import { detectHostPlatform, fileManagerName, hostPlatform } from "./platform";

describe("host platform", () => {
  it("reads the OS from Electron's user agent", () => {
    expect(detectHostPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Electron/42")).toBe("mac");
    expect(detectHostPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/42")).toBe("windows");
    expect(detectHostPlatform("Mozilla/5.0 (X11; Linux x86_64) Electron/42")).toBe("linux");
  });

  it("names the file manager the way each OS does", () => {
    expect(fileManagerName("en", "mac")).toBe("Finder");
    expect(fileManagerName("zh-CN", "mac")).toBe("访达");
    expect(fileManagerName("en", "windows")).toBe("File Explorer");
    expect(fileManagerName("zh-CN", "windows")).toBe("资源管理器");
    expect(fileManagerName("zh-CN", "linux")).toBe("文件管理器");
  });

  it("fills {fileManager} in every reveal label for the current host", () => {
    for (const key of ["sidebar.revealProject", "workspace.reveal", "file.reveal"] as const) {
      expect(translate("en", key)).toContain(fileManagerName("en", hostPlatform));
      expect(translate("zh-CN", key)).toContain(fileManagerName("zh-CN", hostPlatform));
      expect(translate("en", key)).not.toContain("{");
    }
  });
});
