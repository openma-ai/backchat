import { describe, expect, it } from "vitest";

import { listAcpRegistryCatalog } from "./installer.js";

describe("ACP registry installer", () => {
  it("lists installable registry agents with platform args and env", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      agents: [
        {
          id: "gemini",
          name: "Gemini",
          version: "1.2.3",
          website: "https://example.test/gemini",
          distribution: {
            npx: {
              package: "@google/gemini-cli@1.2.3",
              args: ["--acp"],
              env: { GEMINI_MODE: "1" },
            },
          },
        },
      ],
    })) as never;

    await expect(listAcpRegistryCatalog({ fetchImpl })).resolves.toEqual([
      {
        id: "gemini",
        name: "Gemini",
        version: "1.2.3",
        homepage: "https://example.test/gemini",
        installable: true,
        args: ["--acp"],
        env: { GEMINI_MODE: "1" },
      },
    ]);
  });
});
