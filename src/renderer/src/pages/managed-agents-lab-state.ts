import type {
  ManagedAgentsLabEvent,
  ManagedAgentsLabResult,
} from "@shared/managed-agents-lab";

type HttpEvent = Extract<ManagedAgentsLabEvent, { kind: "http" }>;
type SdkEvent = Extract<ManagedAgentsLabEvent, { kind: "sdk_event" }>;

export interface ManagedAgentsLabViewState {
  runId: string | null;
  status: string;
  answer: string;
  http: HttpEvent[];
  sdkEvents: SdkEvent[];
  error: string | null;
  result: ManagedAgentsLabResult | null;
}

export const initialManagedAgentsLabState: ManagedAgentsLabViewState = {
  runId: null,
  status: "idle",
  answer: "",
  http: [],
  sdkEvents: [],
  error: null,
  result: null,
};

export function reduceManagedAgentsLabEvent(
  state: ManagedAgentsLabViewState,
  event: ManagedAgentsLabEvent,
): ManagedAgentsLabViewState {
  if (state.runId && state.runId !== event.runId) return state;
  const base = state.runId ? state : { ...state, runId: event.runId };

  if (event.kind === "http") {
    return { ...base, http: [...base.http, event] };
  }
  if (event.kind === "status") {
    return { ...base, status: event.type };
  }
  if (event.kind === "error") {
    return { ...base, status: "error", error: event.message };
  }
  if (event.kind === "completed") {
    return { ...base, status: "completed", result: event.result };
  }

  const content = (event.data.delta as { content?: unknown } | undefined)?.content;
  const deltaText =
    content && typeof content === "object" &&
    (content as { type?: unknown }).type === "text" &&
    typeof (content as { text?: unknown }).text === "string"
      ? (content as { text: string }).text
      : "";
  let answer = `${base.answer}${deltaText}`;
  if (!answer && event.type === "agent.message") {
    const blocks = Array.isArray(event.data.content) ? event.data.content : [];
    answer = blocks
      .filter((block): block is { type: "text"; text: string } =>
        !!block && typeof block === "object" &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string")
      .map((block) => block.text)
      .join("");
  }
  return {
    ...base,
    answer,
    sdkEvents: [...base.sdkEvents, event],
  };
}
