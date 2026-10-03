import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parseUpdateManifest } from "../shared/app-update.js";
import { AppUpdateController, type UpdateHost } from "./app-update-controller.js";
import { downloadVerifiedFile, sha256File } from "./app-update-io.js";

const commit = "0123456789abcdef0123456789abcdef01234567";

async function serve(files: Record<string, Buffer | string>): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const name = request.url?.split("?")[0] ?? "/";
    const body = files[name];
    if (body == null) {
      response.writeHead(404);
      response.end();
      return;
    }
    const payload = typeof body === "string" ? Buffer.from(body) : body;
    response.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": String(payload.byteLength),
    });
    response.end(payload);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe("sha256 verification", () => {
  it("deletes the download when the hash does not match", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-update-hash-"));
    const destination = join(root, "update.zip");
    const payload = Buffer.from("not the promised bytes");
    const hosted = await serve({ "/Backchat-preview-arm64.zip": payload });
    try {
      await expect(downloadVerifiedFile({
        url: `${hosted.url}/Backchat-preview-arm64.zip`,
        sha256: "ab".repeat(32),
        size: payload.byteLength,
        destination,
      })).rejects.toThrow(/sha256/);
      await expect(stat(destination)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(`${destination}.partial`)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await hosted.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps a download whose size and hash match", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-update-ok-"));
    const destination = join(root, "nested", "update.zip");
    const payload = Buffer.from("zip bytes");
    const hosted = await serve({ "/file.zip": payload });
    try {
      await downloadVerifiedFile({
        url: `${hosted.url}/file.zip`,
        sha256: createHash("sha256").update(payload).digest("hex"),
        size: payload.byteLength,
        destination,
      });
      expect(await sha256File(destination)).toBe(createHash("sha256").update(payload).digest("hex"));
    } finally {
      await hosted.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("update controller", () => {
  it("downloads a newer preview build and shuts down only after the helper starts", async () => {
    const payload = Buffer.from("new app zip");
    const sha256 = createHash("sha256").update(payload).digest("hex");
    const body = JSON.stringify({
      schema: 1,
      channel: "preview",
      version: "0.0.12",
      build: 2001,
      commit,
      zipName: "Backchat-preview-arm64.zip",
      sha256,
      size: payload.byteLength,
    });
    const hosted = await serve({
      "/Backchat-mac-arm64-update.json": body,
      "/Backchat-preview-arm64.zip": payload,
    });
    const root = await mkdtemp(join(tmpdir(), "backchat-update-controller-"));
    const events: string[] = [];
    try {
      const controller = new AppUpdateController({
        identity: { version: "0.0.12", channel: "preview", build: 1000, commit },
        platform: "darwin",
        packaged: true,
        appBundlePath: "/Applications/Backchat.app",
        userDataPath: root,
        env: { BACKCHAT_UPDATE_MANIFEST_URL: `${hosted.url}/Backchat-mac-arm64-update.json` },
        now: () => new Date("2026-10-03T00:00:00.000Z"),
      });
      const ready = await controller.check();
      expect(ready.status).toBe("ready");
      expect(ready.available).toMatchObject({ version: "0.0.12", build: 2001 });
      expect(await sha256File(join(root, "updates", "Backchat-preview-arm64.zip"))).toBe(sha256);

      const host: UpdateHost = {
        confirm: async () => {
          events.push("confirm");
          return true;
        },
        quitInProgress: () => false,
        spawn: (request) => {
          events.push("spawn");
          expect(AppUpdateController.helperArgs(request)[0]).toBe("/tmp/apply-mac-update.sh");
          expect(request.pid).toBe(7);
          expect(request.relaunch).toBe("open");
        },
        shutdown: () => {
          events.push("shutdown");
        },
        scriptPath: "/tmp/apply-mac-update.sh",
        pid: 7,
        backupPath: join(root, "Backchat.app.previous"),
        logPath: join(root, "apply.log"),
      };
      await controller.install(host);
      expect(events).toEqual(["confirm", "spawn", "shutdown"]);
    } finally {
      await hosted.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not download or replace when the app is outside /Applications", async () => {
    const body = JSON.stringify({
      schema: 1,
      channel: "stable",
      version: "0.0.13",
      build: 1,
      commit,
      zipName: "Backchat-0.0.13-arm64.zip",
      sha256: "ab".repeat(32),
      size: 4,
    });
    const hosted = await serve({ "/Backchat-mac-arm64-update.json": body });
    try {
      const controller = new AppUpdateController({
        identity: { version: "0.0.12", channel: "stable", build: 1, commit },
        platform: "darwin",
        packaged: true,
        appBundlePath: "/Users/me/Desktop/Backchat.app",
        userDataPath: "/tmp/unused",
        env: { BACKCHAT_UPDATE_MANIFEST_URL: `${hosted.url}/Backchat-mac-arm64-update.json` },
      });
      const state = await controller.check();
      expect(state.status).toBe("available");
      expect(state.canInstall).toBe(false);
      expect(state.installBlock).toBe("location");
      await expect(controller.install({
        confirm: async () => true,
        quitInProgress: () => false,
        spawn: () => { throw new Error("should not spawn"); },
        shutdown: () => { throw new Error("should not shut down"); },
        scriptPath: "/tmp/apply.sh",
        pid: 1,
        backupPath: "/tmp/backup",
        logPath: "/tmp/log",
      })).rejects.toThrow(/not ready/);
    } finally {
      await hosted.close();
    }
  });

  it("leaves the app running when the user declines", async () => {
    const payload = Buffer.from("zip");
    const sha256 = createHash("sha256").update(payload).digest("hex");
    const hosted = await serve({
      "/Backchat-mac-arm64-update.json": JSON.stringify({
        schema: 1,
        channel: "preview",
        version: "0.0.12",
        build: 5,
        commit,
        zipName: "Backchat-preview-arm64.zip",
        sha256,
        size: payload.byteLength,
      }),
      "/Backchat-preview-arm64.zip": payload,
    });
    const root = await mkdtemp(join(tmpdir(), "backchat-update-decline-"));
    try {
      const controller = new AppUpdateController({
        identity: { version: "0.0.12", channel: "preview", build: 1, commit },
        platform: "darwin",
        packaged: true,
        appBundlePath: "/Applications/Backchat.app",
        userDataPath: root,
        env: { BACKCHAT_UPDATE_MANIFEST_URL: `${hosted.url}/Backchat-mac-arm64-update.json` },
      });
      await controller.check();
      const events: string[] = [];
      const state = await controller.install({
        confirm: async () => false,
        quitInProgress: () => false,
        spawn: () => { events.push("spawn"); },
        shutdown: () => { events.push("shutdown"); },
        scriptPath: "/tmp/apply.sh",
        pid: 1,
        backupPath: join(root, "backup"),
        logPath: join(root, "apply.log"),
      });
      expect(state.status).toBe("ready");
      expect(events).toEqual([]);
    } finally {
      await hosted.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a manifest from the other channel", async () => {
    const hosted = await serve({
      "/Backchat-mac-arm64-update.json": JSON.stringify({
        schema: 1,
        channel: "stable",
        version: "9.0.0",
        build: 1,
        commit,
        zipName: "Backchat-9.0.0-arm64.zip",
        sha256: "ab".repeat(32),
        size: 4,
      }),
    });
    try {
      const controller = new AppUpdateController({
        identity: { version: "0.0.12", channel: "preview", build: 1, commit },
        platform: "darwin",
        packaged: true,
        appBundlePath: "/Applications/Backchat.app",
        userDataPath: "/tmp/unused",
        env: { BACKCHAT_UPDATE_MANIFEST_URL: `${hosted.url}/Backchat-mac-arm64-update.json` },
      });
      const state = await controller.check();
      expect(state.status).toBe("error");
      expect(state.errorCode).toBe("manifest");
    } finally {
      await hosted.close();
    }
  });
});

describe("release manifest", () => {
  it("parses the manifest written by the release script", async () => {
    const root = await mkdtemp(join(tmpdir(), "backchat-manifest-"));
    const appResources = join(root, "mac-arm64", "Backchat.app", "Contents", "Resources");
    await mkdir(appResources, { recursive: true });
    await writeFile(join(appResources, "update-metadata.json"), JSON.stringify({
      schema: 1,
      channel: "preview",
      version: "0.0.12",
      build: 42001,
      commit,
    }));
    const zipSource = join(root, "mac-arm64", "Backchat-0.0.12-mac.zip");
    await writeFile(zipSource, "preview zip bytes");
    const script = join(process.cwd(), "scripts", "write-update-manifest.mjs");
    const child = spawnSync(process.execPath, [script, root, "--expect", "preview"], { encoding: "utf8" });
    try {
      expect(child.status, child.stderr).toBe(0);
      const raw = JSON.parse(await readFile(join(root, "Backchat-mac-arm64-update.json"), "utf8")) as unknown;
      const parsed = parseUpdateManifest(raw);
      expect(parsed).toMatchObject({
        channel: "preview",
        version: "0.0.12",
        build: 42001,
        zipName: "Backchat-preview-arm64.zip",
      });
      expect(parsed.sha256).toBe(createHash("sha256").update("preview zip bytes").digest("hex"));
      expect(parsed.size).toBe(Buffer.byteLength("preview zip bytes"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
