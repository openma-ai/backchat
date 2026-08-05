import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { writeTextFile } from "./brokers";

describe("filesystem broker project roots", () => {
  let root = "";

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("allows writes inside a project's secondary ACP workspace roots", async () => {
    root = await mkdtemp(join(tmpdir(), "openma-broker-roots-"));
    const primary = join(root, "app");
    const secondary = join(root, "docs");
    const target = join(secondary, "guide.md");

    await writeTextFile("sess-multi-root", [primary, secondary], {
      path: target,
      content: "# Guide",
    });

    await expect(readFile(target, "utf8")).resolves.toBe("# Guide");
  });
});
