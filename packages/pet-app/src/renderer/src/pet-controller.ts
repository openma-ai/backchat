import {
  createPetRuntime,
  createQuietProactivityPolicy,
  defaultPetHooks,
  type PetAction,
  type PetIntensity,
  type PetMotion,
  type PetPriority,
  type PetSignal,
} from "@open-managed-agents-desktop/pet-runtime";
import { createPetHarnessRegistry, type PetHarnessEvent, type PetHarnessRegistry } from "./pet-harness";

export type PetMood = "calm" | "awake" | "focused" | "asking" | "worried" | "proud" | "sleepy";

export interface PetViewState {
  motion: PetMotion;
  mood: PetMood;
  intensity: "low" | "medium" | "high";
  priority: "low" | "normal" | "high" | "urgent";
  label: string;
  sessionId?: string;
  turnId?: string;
  navigationUrl?: string;
  proactive: boolean;
  updatedAt: number;
}

export interface StandalonePetController {
  dispatchSignal(signal: PetSignal): PetViewState[];
  dispatchHarnessEvent(event: PetHarnessEvent): PetViewState[];
  dispatchEvent(name: StandalonePetEventName, options?: StandalonePetEventOptions): PetViewState[];
  idleTick(id?: string): PetViewState[];
}

export type StandalonePetEventName =
  | "pet.clicked"
  | "pet.hovered"
  | "pet.dragged"
  | "pet.edge.peek"
  | "pet.wake"
  | "pet.sleep"
  | "user.returned"
  | "workspace.idle"
  | "workspace.active"
  | "session.started"
  | "session.completed"
  | "session.failed"
  | "permission.requested"
  | "review.started"
  | "tool.read"
  | "tool.edit"
  | "tool.run"
  | "tool.search"
  | "tool.fetch"
  | "tests.started"
  | "tests.passed"
  | "tests.failed"
  | "handoff.waiting"
  | "handoff.completed";

export interface StandalonePetEventOptions {
  label?: string;
  sessionId?: string;
  turnId?: string;
  agentId?: string;
  source?: string;
  payload?: unknown;
}

export function createStandalonePetController(
  options: { now?: () => number; harnessRegistry?: PetHarnessRegistry } = {},
): StandalonePetController {
  const harnessRegistry = options.harnessRegistry ?? createPetHarnessRegistry();
  const runtime = createPetRuntime({
    now: options.now,
    hooks: [
      ...defaultPetHooks(),
      {
        id: "pet-life-idle",
        when: (signal) => signal.source === "pet-life" && signal.name === "idle.tick",
        run: (signal): PetAction => ({
          type: "motion",
          motion: "nudge",
          intensity: "low",
          priority: "low",
          source: signal.source,
          reason: "pet-life:idle",
          label: signal.labels?.["title"],
          proactive: true,
        }),
      },
      ...standalonePetHooks(),
    ],
    proactive: createQuietProactivityPolicy({
      minIntervalMs: 5 * 60_000,
      windowMs: 60 * 60_000,
      maxPerWindow: 3,
    }),
  });

  const toStates = (actions: PetAction[]) =>
    actions
      .map((action) => petActionToViewState(action, harnessRegistry))
      .filter((state): state is PetViewState => state !== null);

  return {
    dispatchSignal(signal) {
      return toStates(runtime.dispatch(signal));
    },
    dispatchHarnessEvent(event) {
      return toStates(harnessRegistry.normalize(event).flatMap((signal) => runtime.dispatch(signal)));
    },
    dispatchEvent(name, eventOptions = {}) {
      return toStates(runtime.dispatch(signalFromEvent(name, eventOptions)));
    },
    idleTick(id = `idle:${Date.now()}`) {
      return toStates(
        runtime.dispatch({
          id,
          source: "pet-life",
          name: "idle.tick",
          labels: { title: "still here" },
        }),
      );
    },
  };
}

export function signalFromEvent(
  name: StandalonePetEventName,
  options: StandalonePetEventOptions = {},
): PetSignal {
  return {
    id: `${options.source ?? "pet-app"}:${name}:${Date.now()}`,
    source: options.source ?? sourceForEvent(name),
    name,
    sessionId: options.sessionId,
    turnId: options.turnId,
    agentId: options.agentId,
    labels: options.label ? { title: options.label } : undefined,
    payload: options.payload,
  };
}

function standalonePetHooks() {
  return [
    hook("pet-clicked", ["pet.clicked"], "idle", "low", "low", "hi"),
    hook("pet-hovered", ["pet.hovered"], "waving", "low", "low", "hi"),
    hook("user-returned", ["user.returned"], "waving", "low", "normal", "hi"),
    hook("pet-dragged", ["pet.dragged"], "running-right", "low", "low", "moving"),
    hook("pet-edge-peek", ["pet.edge.peek"], "review", "low", "low", "peek"),
    hook("pet-wake", ["pet.wake", "workspace.active", "session.started"], "wake", "medium", "normal", "hello"),
    hook("pet-sleep", ["pet.sleep"], "sleep", "low", "low", "resting"),
    hook("workspace-idle", ["workspace.idle"], "nudge", "low", "low", "still here", true),
    hook("session-complete", ["session.completed", "handoff.completed", "tests.passed"], "celebrate", "medium", "normal", "nice"),
    hook("session-failed", ["session.failed", "tests.failed"], "warn", "high", "urgent", "needs attention"),
    hook("permission-requested", ["permission.requested"], "ask", "high", "urgent", "needs you"),
    hook("review-started", ["review.started", "tests.started"], "review", "medium", "normal", "checking"),
    hook("tool-read", ["tool.read"], "tool-read", "medium", "normal", "reading"),
    hook("tool-edit", ["tool.edit"], "tool-edit", "medium", "normal", "editing"),
    hook("tool-run", ["tool.run"], "tool-run", "medium", "normal", "running"),
    hook("tool-search", ["tool.search"], "tool-search", "medium", "normal", "searching"),
    hook("tool-fetch", ["tool.fetch"], "tool-fetch", "medium", "normal", "fetching"),
    hook("handoff-waiting", ["handoff.waiting"], "handoff", "medium", "normal", "waiting"),
  ];
}

function hook(
  id: string,
  names: StandalonePetEventName[],
  motion: PetMotion,
  intensity: PetIntensity,
  priority: PetPriority,
  fallbackLabel: string,
  proactive = false,
) {
  return {
    id,
    priority: priority === "urgent" ? 30 : 0,
    when: (signal: PetSignal) => names.includes(signal.name as StandalonePetEventName),
    run: (signal: PetSignal): PetAction => ({
      type: "motion",
      motion,
      intensity,
      priority,
      source: signal.source,
      reason: signal.name,
      sessionId: signal.sessionId,
      turnId: signal.turnId,
      label: signal.labels?.["title"] ?? fallbackLabel,
      proactive,
    }),
  };
}

export function petActionToViewState(
  action: PetAction,
  harnessRegistry: PetHarnessRegistry = createPetHarnessRegistry(),
): PetViewState | null {
  if (action.type === "emit") return null;
  const now = Date.now();
  if (action.type === "speech") {
    return {
      motion: "speak",
      mood: "awake",
      intensity: "low",
      priority: action.priority,
      label: action.text,
      sessionId: action.sessionId,
      turnId: action.turnId,
      navigationUrl: harnessRegistry.navigationUrlForAction(action),
      proactive: action.proactive === true,
      updatedAt: now,
    };
  }
  return {
    motion: action.motion,
    mood: moodForMotion(action.motion),
    intensity: action.intensity,
    priority: action.priority,
    label: action.label ?? labelForMotion(action.motion),
    sessionId: action.sessionId,
    turnId: action.turnId,
    navigationUrl: harnessRegistry.navigationUrlForAction(action),
    proactive: action.proactive === true,
    updatedAt: now,
  };
}

function moodForMotion(motion: PetMotion): PetMood {
  switch (motion) {
    case "wake":
    case "listen":
    case "speak":
    case "nudge":
    case "waving":
      return "awake";
    case "think":
    case "review":
    case "running":
    case "tool-read":
    case "tool-edit":
    case "tool-run":
    case "tool-search":
    case "tool-fetch":
    case "tool-other":
      return "focused";
    case "ask":
    case "wait":
    case "handoff":
    case "waiting":
      return "asking";
    case "warn":
    case "failed":
      return "worried";
    case "celebrate":
    case "jumping":
      return "proud";
    case "sleep":
      return "sleepy";
    default:
      return "calm";
  }
}

function labelForMotion(motion: PetMotion): string {
  switch (motion) {
    case "nudge":
      return "checking in";
    case "ask":
      return "needs you";
    case "think":
      return "thinking";
    case "celebrate":
      return "nice";
    case "warn":
      return "attention needed";
    default:
      return "Mote";
  }
}

function sourceForEvent(name: StandalonePetEventName): string {
  if (name.startsWith("tool.") || name.startsWith("tests.") || name.startsWith("permission.")) {
    return "sidecar.work";
  }
  if (name.startsWith("session.") || name.startsWith("handoff.") || name.startsWith("review.")) {
    return "sidecar.session";
  }
  if (name.startsWith("workspace.")) return "pet-life";
  return "pet-app";
}
