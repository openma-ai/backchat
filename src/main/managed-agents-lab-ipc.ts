import { ipcMain, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { InvokeChannel, PushChannel } from "../shared/ipc-channels.js";
import type {
  ManagedAgentsLabConnectionInput,
  ManagedAgentsLabEvent,
  ManagedAgentsLabModelOption,
  ManagedAgentsLabStartInput,
} from "../shared/managed-agents-lab.js";
import { OpenManagedCloudRuntimeClient } from "./openmanaged-cloud-runtime.js";
import { runManagedAgentsLab } from "./managed-agents-lab.js";

interface ActiveRun {
  ownerId: number;
  controller: AbortController;
  runtime: OpenManagedCloudRuntimeClient;
  sessionId?: string;
}

type WithoutEnvelope<T> = T extends unknown ? Omit<T, "runId" | "at"> : never;
type ManagedAgentsLabEventPayload = WithoutEnvelope<ManagedAgentsLabEvent>;

const activeRuns = new Map<string, ActiveRun>();

function normalizeConnection(
  input: ManagedAgentsLabConnectionInput,
): ManagedAgentsLabConnectionInput {
  const baseUrl = input.baseUrl.trim().replace(/\/$/, "");
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Managed Agents endpoint must use HTTP or HTTPS");
  }
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error("API key is required");
  return { baseUrl, apiKey };
}

function normalizeInput(input: ManagedAgentsLabStartInput): ManagedAgentsLabStartInput {
  const { baseUrl, apiKey } = normalizeConnection(input);
  const model = input.model.trim();
  const prompt = input.prompt.trim();
  if (!model) throw new Error("Model is required");
  if (!prompt) throw new Error("Task is required");
  return { baseUrl, apiKey, model, prompt };
}

function push(sender: WebContents, event: ManagedAgentsLabEvent): void {
  if (!sender.isDestroyed()) sender.send(PushChannel.ManagedAgentsLabEvent, event);
}

ipcMain.handle(
  InvokeChannel.ManagedAgentsLabModels,
  async (
    _ipcEvent,
    rawInput: ManagedAgentsLabConnectionInput,
  ): Promise<ManagedAgentsLabModelOption[]> => {
    const input = normalizeConnection(rawInput);
    const runtime = new OpenManagedCloudRuntimeClient({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
    });
    return runtime.listModels();
  },
);

ipcMain.handle(
  InvokeChannel.ManagedAgentsLabStart,
  (ipcEvent, rawInput: ManagedAgentsLabStartInput): { runId: string } => {
    const input = normalizeInput(rawInput);
    const runId = randomUUID();
    const controller = new AbortController();
    const sender = ipcEvent.sender;
    const emit = (event: ManagedAgentsLabEventPayload) => {
      push(sender, { ...event, runId, at: Date.now() } as ManagedAgentsLabEvent);
    };
    const tracedFetch: typeof fetch = async (requestInput, init) => {
      const request = new Request(requestInput, init);
      const url = new URL(request.url);
      const startedAt = performance.now();
      try {
        const response = await fetch(requestInput, init);
        emit({
          kind: "http",
          method: request.method,
          path: `${url.pathname}${url.search}`,
          status: response.status,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        });
        return response;
      } catch (error) {
        emit({
          kind: "http",
          method: request.method,
          path: `${url.pathname}${url.search}`,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        });
        throw error;
      }
    };
    const runtime = new OpenManagedCloudRuntimeClient({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      fetchImpl: tracedFetch,
    });
    const active: ActiveRun = {
      ownerId: sender.id,
      controller,
      runtime,
    };
    activeRuns.set(runId, active);

    setTimeout(() => {
      emit({ kind: "status", type: "connecting" });
      void runManagedAgentsLab(
        runtime,
        { model: input.model, prompt: input.prompt },
        (event) => {
          if (event.kind === "status" && event.type === "streaming") {
            const sessionId = event.data?.sessionId;
            if (typeof sessionId === "string") active.sessionId = sessionId;
          }
          emit(event as ManagedAgentsLabEventPayload);
        },
        { signal: controller.signal },
      ).then((result) => {
        emit({ kind: "completed", result });
      }).catch((error) => {
        if (controller.signal.aborted) {
          emit({ kind: "status", type: "cancelled" });
        } else {
          emit({
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }).finally(() => {
        activeRuns.delete(runId);
      });
    }, 0);

    return { runId };
  },
);

ipcMain.handle(
  InvokeChannel.ManagedAgentsLabCancel,
  async (ipcEvent, input: { runId: string }): Promise<void> => {
    const active = activeRuns.get(input.runId);
    if (!active || active.ownerId !== ipcEvent.sender.id) return;
    if (active.sessionId) {
      try {
        await active.runtime.interrupt(active.sessionId);
      } catch {
        // Abort below still closes the SDK stream and lets cleanup proceed.
      }
    }
    active.controller.abort();
  },
);
