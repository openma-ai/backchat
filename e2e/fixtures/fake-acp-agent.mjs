#!/usr/bin/env node
import {
  AgentSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
} from "../../packages/acp/node_modules/@agentclientprotocol/sdk/dist/acp.js";
import { Readable, Writable } from "node:stream";

class FakeAcpAgent {
  constructor(connection) {
    this.connection = connection;
    this.sessions = new Set();
  }

  async initialize() {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: {
        name: "fake-acp-agent",
        title: "Fake ACP Agent",
        version: "0.0.0-e2e",
      },
      agentCapabilities: {
        loadSession: true,
      },
    };
  }

  async newSession() {
    const sessionId = `fake-acp-${Date.now().toString(36)}`;
    this.sessions.add(sessionId);
    return { sessionId };
  }

  async loadSession(params) {
    this.sessions.add(params.sessionId);
    return {};
  }

  async prompt(params) {
    if (!this.sessions.has(params.sessionId)) {
      throw new Error(`unknown fake session: ${params.sessionId}`);
    }
    const promptText = params.prompt
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n");
    if (promptText === "fail-after-accept-e2e") {
      throw new Error("Fake accepted prompt then failed");
    }
    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: `Fake response saved for ${promptText}.`,
        },
      },
    });
    return { stopReason: "end_turn" };
  }

  async authenticate() {
    return {};
  }

  async setSessionMode() {
    return {};
  }

  async cancel() {
    return;
  }
}

const input = Writable.toWeb(process.stdout);
const output = Readable.toWeb(process.stdin);
const stream = ndJsonStream(input, output);

new AgentSideConnection((connection) => new FakeAcpAgent(connection), stream);
