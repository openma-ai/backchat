import { afterEach, describe, expect, it, vi } from "vitest";
const { remote } = vi.hoisted(() => ({ remote: { id: "remote", openma: {} } }));
vi.mock("./session-store", () => ({ sessionStore: { active: () => remote, openSideTab: vi.fn() } }));
vi.mock("./settings-store", () => ({ getSettings: () => undefined }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
import { previewLocalFile } from "./file-preview";
import { openBrowserAwareUrl } from "./browser-open";
import { sessionStore } from "./session-store";
afterEach(() => vi.unstubAllGlobals());
describe("remote task resource routing", () => {
  it("never sends a remote file path to the local filesystem", async () => {
    const uiFsResolvePreview = vi.fn();
    const openmaTaskFiles = vi.fn(async () => []);
    vi.stubGlobal("window", { backchat: { uiFsResolvePreview, openmaTaskFiles } });
    await previewLocalFile("/Users/person/private.txt");
    expect(openmaTaskFiles).toHaveBeenCalledWith("remote");
    expect(uiFsResolvePreview).not.toHaveBeenCalled();
  });
  it("does not resolve a remote loopback URL on the user's computer", () => {
    const open = vi.fn(); vi.stubGlobal("window", { open });
    openBrowserAwareUrl("http://127.0.0.1:3000");
    expect(open).not.toHaveBeenCalled();
    expect(sessionStore.openSideTab).not.toHaveBeenCalled();
    openBrowserAwareUrl("https://example.com/report");
    expect(open).toHaveBeenCalledWith("https://example.com/report", "_blank", "noopener,noreferrer");
  });
});
