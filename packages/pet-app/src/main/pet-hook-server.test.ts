import { afterEach, describe, expect, it } from "vitest";
import { startPetHookServer, PET_HOOK_PORT } from "./pet-hook-server";

const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("pet hook server", () => {
  it("accepts structured harness events without deeplinks", async () => {
    const received: unknown[] = [];
    const server = await startPetHookServer({
      port: 0,
      onEvent: (event) => received.push(event),
    });
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}/hook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        harness: "backchat",
        event: "tool.run",
        sessionId: "sess-1",
        turnId: "turn-1",
        label: "Run tests",
      }),
    });

    expect(response.status).toBe(204);
    expect(received).toEqual([
      {
        harness: "backchat",
        event: "tool.run",
        sessionId: "sess-1",
        turnId: "turn-1",
        label: "Run tests",
      },
    ]);
  });

  it("uses a stable localhost default port", () => {
    expect(PET_HOOK_PORT).toBe(47632);
  });
});
