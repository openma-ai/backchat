import { describe, expect, it } from "vitest";
import { OpenManagedCloudRuntimeClient } from "./openmanaged-cloud-runtime";
import { OpenmaTaskFiles } from "./openma-task-files";
describe("OpenMA task files", () => {
  it("lists and reads only files belonging to the selected remote task using SDK authentication", async () => {
    const requested: string[] = [];
    const client = new OpenManagedCloudRuntimeClient({ baseUrl: "https://example.com", apiKey: "key", workspaceId: "team", fetchImpl: async (url, init) => {
      const request = new Request(url, init); const path = new URL(request.url).pathname; requested.push(path);
      expect(request.headers.get("x-active-tenant")).toBe("team");
      if (path.endsWith("/outputs")) return Response.json({ data: [{ filename: "result.txt", size_bytes: 6, media_type: "text/plain" }] });
      if (path.endsWith("/resources")) return Response.json({ data: [{ type: "file", id: "resource", file_id: "file", mount_path: "/remote/input.txt" }] });
      if (path.endsWith("result.txt") || path === "/v1/files/file/content") return new Response("remote", { headers: { "content-type": "text/plain" } });
      throw new Error("unexpected path");
    } });
    const files = new OpenmaTaskFiles(client, "session");
    expect(await files.list()).toMatchObject([{ id: "output:result.txt" }, { id: "file:file", path: "/remote/input.txt" }]);
    expect(await files.preview("output:result.txt")).toMatchObject({ text: "remote" });
    expect(await files.preview("file:file")).toMatchObject({ text: "remote" });
    await expect(files.preview("/Users/person/private.txt")).rejects.toThrow(/available/i);
    expect(requested.some((path) => path.includes("Users"))).toBe(false);
  });
});
