/**
 * Wire types for the renderer ⇄ main session channel.
 *
 * Kept in `src/shared/` so the preload bridge, the main-process SessionManager,
 * and the renderer all import from one source. Tweaks here are protocol
 * changes — tag with a comment explaining the migration when needed.
 */

import type {
  AgentMessageDelivery,
  AgentMessageIntent,
} from "./agent-interaction.js";
import type { OpenMAEvent } from "@openma/common/session-events/openma";

export interface SessionStartParams {
  /** Stable id chosen by the renderer (uuid). Used as map key + spawn cwd
   *  basename. The renderer is free to fire `start` for the same id at the
   *  top of every turn — the manager re-acks idempotently. */
  session_id: string;
  /** Canonical agent id from the registry (claude-acp / codex-acp / ...). */
  agent_id: string;
  /** Override the spawn cwd. When omitted, the manager creates one under
   *  userData/sessions/<session_id>/. Workspaces will pass the workspace's
   *  root_path here in Phase 4. */
  cwd?: string;
  /** Secondary workspace roots. ACP 1.1 keeps these distinct from cwd so
   * relative paths, Git, and project instruction discovery stay anchored to
   * the project's primary folder. */
  additional_directories?: string[];
  /** Durable local project container, independent from ACP provider ids. */
  project_id?: string;
  /** Workspace ownership is explicit for new drafts:
   *  - managed: ignore the settings default and allocate a per-session cwd.
   *  - project: require and use `cwd`.
   *  - inherited: require the parent task's `cwd` for a side chat.
   *  - omitted: resume an existing session at its persisted `cwd`. */
  workspace_mode?: "managed" | "project" | "inherited";
  /** Provide an existing ACP-side session id to resume conversation history.
   *  The runtime tries `session/resume`, then `session/load`, then
   *  `session/new`, according to the agent's advertised capabilities. */
  resume?: { acp_session_id: string };
  /** Seed this session by forking an existing ACP-side session. This is the
   *  SDK's unstable `session/fork` path and should be treated as a context
   *  inheritance mechanism, not as the whole subagent communication model. */
  fork?: { acp_session_id: string };
}

export type SessionStartResult =
  | {
      status: "ready";
      session_id: string;
      acp_session_id: string;
      agent_id: string;
      cwd: string;
      additional_directories?: string[];
      project_id?: string;
      config_options?: SessionConfigOption[];
      modes?: SessionModeState;
      protocol_version?: number;
      agent_info?: unknown;
      agent_capabilities?: unknown;
      initialize_meta?: Record<string, unknown> | null;
      /** Raw adapter metadata returned by the successful session setup
       * response (new/load/resume/fork). */
      session_setup_meta?: Record<string, unknown> | null;
      supports_session_fork?: boolean;
      supports_session_list?: boolean;
      supports_session_delete?: boolean;
      supports_session_resume?: boolean;
      supports_session_close?: boolean;
      supports_additional_directories?: boolean;
      supports_logout?: boolean;
      supports_providers?: boolean;
      supports_nes?: boolean;
      /** Vendor extension capability negotiated through initialize `_meta`. */
      supports_steering?: boolean;
    }
  | {
      status: "error";
      session_id: string;
      message: string;
    }
  | {
      status: "cancelled";
      session_id: string;
    };

export interface SessionRuntimeStatus {
  session_id: string;
  agent_id: string;
  running_version?: string;
  installed_version?: string;
  restart_required: boolean;
  busy: boolean;
  restart_pending: boolean;
}

export type SessionRestartMode = "now" | "after-turn";

export interface SessionRestartResult {
  session_id: string;
  status: "pending" | "restarted";
}

export interface PairStartParams {
  /** Stable pair id chosen by the renderer (uuid). */
  pair_id: string;
  /** One sub-session id per agent. Renderer mints these alongside
   *  pair_id so the column-to-session mapping is deterministic
   *  (grid column N renders sub-session N). */
  members: Array<{ session_id: string; agent_id: string }>;
  /** Optional shared workspace cwd. When set, every member spawns
   *  here (caller accepts that file writes may conflict). When
   *  omitted, each sub-session gets its own
   *  ~/.oma/sessions/<session_id>/ via the usual auto-allocator. */
  workspace_cwd?: string;
}

export interface PairPromptParams {
  pair_id: string;
  /** Shared per-turn id. Each sub-session sees the same turn_id so
   *  the renderer can group their event streams under one "row" in
   *  the grid timeline. */
  turn_id: string;
  text: string;
}

/** A user-selected file/image attachment carried with a prompt.
 *  `data` is base64 and only present for reasonably small images so
 *  the renderer can preview them and image-capable ACP agents can
 *  receive true image blocks. All attachments also carry a `uri`
 *  so they can fall back to ACP's baseline `resource_link` content. */
export interface PromptAttachment {
  id: string;
  name: string;
  path: string;
  uri: string;
  kind: "image" | "file";
  mimeType?: string | null;
  size?: number | null;
  data?: string;
}

/** DOM context captured when the user points at an element in the in-app
 * browser. Field names intentionally use snake_case because this object is
 * serialized verbatim into the agent-facing prompt context. */
export interface BrowserElementAnnotationDetails {
  url: string;
  title: string;
  /** Exact executable selector captured from the runtime page. */
  selector: string;
  /** Human-readable DOM ancestry kept separate from the exact selector. */
  dom_path?: string;
  tag_name: string;
  id?: string;
  class_names: string[];
  role?: string;
  aria_label?: string;
  text?: string;
  attributes: Record<string, string>;
  outer_html?: string;
  /** Small, agent-relevant computed-style snapshot captured at selection time. */
  computed_styles?: Record<string, string>;
  /** User-requested changes relative to `computed_styles`. */
  style_changes?: BrowserElementStyleChange[];
  rect: { x: number; y: number; width: number; height: number };
  viewport: {
    width: number;
    height: number;
    device_pixel_ratio: number;
  };
  screenshot_name: string;
}

export interface BrowserElementStyleChange {
  property: string;
  from: string;
  to: string;
}

export interface BrowserRegionAnnotationDetails {
  url: string;
  title: string;
  rect: { x: number; y: number; width: number; height: number };
  viewport: {
    width: number;
    height: number;
    device_pixel_ratio: number;
  };
  screenshot_name: string;
}

/** A quoted range from an earlier assistant response. The renderer keeps
 *  these separate from the visible composer text; the main process turns
 *  them into the same <response-annotations> context understood by Codex. */
export interface PromptAnnotation {
  id: string;
  /** Omitted on older rows and ordinary assistant-response annotations. */
  kind?: "response" | "browser_element" | "browser_region";
  source_session_id: string;
  source_turn_id: string;
  text: string;
  comment?: string;
  browser?: BrowserElementAnnotationDetails;
  browser_region?: BrowserRegionAnnotationDetails;
}

/** A session selected with the composer's @mention picker. The title is a
 *  display hint; the stable id is what the injected MCP tool uses to read
 *  the referenced transcript. */
export interface PromptSessionReference {
  session_id: string;
  title: string;
}

export interface SessionPromptParams {
  session_id: string;
  /** Stable per-turn id. Used to route `session.event` and `session.complete`
   *  back to the right turn in the UI. */
  turn_id: string;
  text: string;
  attachments?: PromptAttachment[];
  annotations?: PromptAnnotation[];
  session_references?: PromptSessionReference[];
  /** Running-time submission semantics. ACP v1 only standardizes
   *  turn-level prompts, so requested_* captures product intent while
   *  effective_* captures what this transport can honestly deliver. */
  prompt_intent?: AgentMessageIntent;
  requested_delivery?: AgentMessageDelivery;
  effective_delivery?: AgentMessageDelivery;
  delivery_degraded?: boolean;
}

/** Backchat-owned queue controls. ACP v1 defines one prompt turn at a time,
 * so pending-turn management stays at the desktop session boundary instead
 * of being represented as an ACP method or session update. */
export type SessionPromptQueueCommandParams =
  | {
      session_id: string;
      action: "update";
      turn_id: string;
      text: string;
    }
  | {
      session_id: string;
      action: "steer";
      turn_id: string;
    }
  | {
      session_id: string;
      action: "remove";
      turn_id: string;
    }
  | {
      session_id: string;
      action: "reorder";
      turn_ids: string[];
    }
  | {
      session_id: string;
      action: "clear";
    };

/** Invoke an agent-advertised slash command without representing the
 * transport control itself as a user-authored chat message. Agent-specific
 * UI adapters choose the command; the session layer only carries it. */
export interface SessionRunCommandParams {
  session_id: string;
  command: string;
  args?: string;
}

export type SessionConfigSelectValue = {
  value: string;
  name: string;
  description?: string | null;
};

export type SessionConfigSelectGroup = {
  group: string;
  name: string;
  options: SessionConfigSelectValue[];
};

export type SessionConfigOption = (
  | {
      type: "select";
      currentValue: string;
      options: Array<SessionConfigSelectValue | SessionConfigSelectGroup>;
    }
  | {
      type: "boolean";
      currentValue: boolean;
    }
) & {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
};

export interface SessionSetConfigOptionParams {
  session_id: string;
  config_id: string;
  value: string | boolean;
}

export interface SessionMode {
  id: string;
  name: string;
  description?: string | null;
}

/** ACP v1 compatibility state. Session config options are preferred when an
 * agent returns both shapes, but mode-only agents still need a GUI projection. */
export interface SessionModeState {
  currentModeId: string;
  availableModes: SessionMode[];
}

export interface AcpPromptUsage {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens?: number | null;
  cachedReadTokens?: number | null;
  cachedWriteTokens?: number | null;
  _meta?: Record<string, unknown> | null;
}

/** Outbound (main → renderer) wire shapes. The renderer subscribes via
 *  `window.backchat.onSessionEvent(handler)` (preload). */
export type SessionEventOut = (
  | {
      type: "session.ready";
      session_id: string;
      acp_session_id: string;
      agent_id: string;
      cwd: string;
      additional_directories?: string[];
      project_id?: string;
      /** ACP `NewSessionResponse.configOptions` /
       *  `LoadSessionResponse.configOptions`, if the agent supports
       *  runtime session configuration. Kept as unknown at the shared
       *  IPC boundary; the renderer narrows to its display shape. */
      config_options?: readonly unknown[];
      /** ACP `NewSessionResponse.modes` / `LoadSessionResponse.modes` /
       * unstable `ForkSessionResponse.modes`. */
      modes?: SessionModeState;
      /** Complete initialize evidence retained for the OpenMA canonical
       * session event. GUI projections may select capabilities from it but
       * must not reinterpret harness metadata. */
      protocol_version?: number;
      agent_info?: unknown;
      agent_capabilities?: unknown;
      initialize_meta?: Record<string, unknown> | null;
      session_setup_meta?: Record<string, unknown> | null;
      /** Whether the agent advertised the unstable `session/fork`
       *  capability on initialize. The renderer uses this only to seed
       *  GUI-created side chats / forks with inherited context; native
       *  subagent communication state is tracked separately. */
      supports_session_fork?: boolean;
      supports_session_list?: boolean;
      supports_session_delete?: boolean;
      supports_session_resume?: boolean;
      supports_session_close?: boolean;
      /** Whether the agent advertised ACP secondary workspace roots. */
      supports_additional_directories?: boolean;
      supports_logout?: boolean;
      supports_providers?: boolean;
      supports_nes?: boolean;
      /** Whether this session accepts the negotiated `_session/steering`
       * extension while a turn is active. */
      supports_steering?: boolean;
    }
  | {
      type: "session.event";
      session_id: string;
      turn_id: string;
      /** Raw ACP `SessionUpdate` or a non-interactive host diagnostic.
       *  Interactive client callbacks such as requestPermission use their
       *  dedicated broker channel and never enter transcript events. */
      event: unknown;
    }
  | {
      /** User's decision for an ACP permission callback. The request itself
       * remains a broker callback event; this input fact is emitted by the
       * host when the renderer resolves it. */
      type: "session.permission_response";
      session_id: string;
      request_id: string;
      option_id?: string | null;
      outcome: "selected" | "cancelled";
    }
  | {
      /** User's decision for an out-of-workspace ACP filesystem write.
       * The host records the decision before resolving/rejecting the broker
       * so the GUI can retain an auditable callback receipt. */
      type: "session.fs_write_response";
      session_id: string;
      request_id: string;
      path: string;
      outcome: "allowed" | "denied";
    }
  | {
      /** A user selected an advertised command from OpenMA's command palette.
       * ACP transports the invocation as an ordinary prompt; retaining this
       * host-side fact distinguishes the input without inventing an ACP RPC. */
      type: "session.command_invoked";
      session_id: string;
      turn_id: string;
      command: string;
      args?: string;
      text: string;
    }
  | {
      /** User response to an ACP elicitation rendered in OpenMA's
       * existing approval/elicitation slot. */
      type: "session.elicitation_response";
      session_id: string;
      request_id: string;
      action: "accept" | "decline" | "cancel";
      content?: Record<string, string | number | boolean | string[]>;
      mode?: "form" | "url";
      /** Present for URL mode so a later completion notification can retain
       * the ACP correlation identity without interpreting it. */
      elicitation_id?: string;
    }
  | {
      type: "session.native_subagent";
      session_id: string;
      provider: "codex" | "claude";
      /** ACP/native tool call id that created or reported this child. */
      tool_call_id?: string;
      /** Provider-native child id. For Claude this is transcript
       *  `toolUseResult.agentId`, not text scraped from the result. */
      child_id: string;
      task?: string;
      agent_type?: string;
      status?: "running" | "complete" | "error" | "cancelled";
      result?: string;
      error_message?: string;
    }
  | {
      /** OpenMA-observed lifecycle for a command process created through the
       * ACP terminal reverse callback. This is an internal transport shape;
       * `openma_event` remains the GUI-facing semantic contract. */
      type: "session.background_process";
      session_id: string;
      process_id: string;
      /** Monotonic within one process, so repeated identical output chunks
       * remain distinct canonical facts. */
      seq: number;
      phase:
        | "started"
        | "output"
        | "completed"
        | "failed"
        | "killed"
        | "terminated";
      command?: string;
      args?: string[];
      cwd?: string;
      output?: string;
      exit_code?: number | null;
      signal?: string | null;
      error?: string;
      reason?: string;
    }
  | {
      type: "session.complete";
      session_id: string;
      turn_id: string;
      /** ACP PromptResponse terminal evidence. Optional for legacy/local
       * transports that only report a generic completion boundary. */
      stop_reason?: string;
      usage?: AcpPromptUsage;
      meta?: Record<string, unknown>;
    }
  | {
      /** User-initiated Stop command accepted by the host. */
      type: "session.cancel_requested";
      session_id: string;
      turn_id: string;
    }
  | {
      /** ACP-client projection required by the cancellation contract. This is
       *  not an ACP tool status: the v1 wire enum has no `cancelled` value. */
      type: "session.tool_cancelled";
      session_id: string;
      turn_id: string;
      tool_call_id: string;
      reason: "user_stop";
    }
  | {
      /** Terminal acknowledgement after the ACP prompt has unwound. */
      type: "session.cancelled";
      session_id: string;
      turn_id: string;
    }
  | {
      /** Result of delivering a user input through negotiated
       * `_session/steering`. This is an input fact, not a synthetic turn. */
      type: "session.steering";
      session_id: string;
      turn_id: string;
      active_turn_id: string;
      text: string;
      content?: readonly unknown[];
      prompt_intent?: AgentMessageIntent;
      requested_delivery: "llm_boundary";
      effective_delivery: AgentMessageDelivery;
      delivery_degraded?: boolean;
      outcome: "injected" | "promptRequired" | "startedNewTurn" | "failed";
      error?: string;
    }
  | {
      type: "session.queue_update";
      session_id: string;
      mode: "single";
      active_turn_id: string | null;
      queued: Array<{
        turn_id: string;
        text: string;
        created_at: number;
      }>;
      /** Queue items that have been upgraded to run concurrently with the
       *  active turn via the Backchat/Clash-style steer action. */
      steering_turn_ids?: string[];
    }
  | { type: "session.restart_pending"; session_id: string }
  | { type: "session.restarted"; session_id: string }
  | {
      type: "session.error";
      session_id: string;
      turn_id?: string;
      message: string;
      code?: "auth_required";
      agent_id?: string;
      auth?: {
        status: "configured" | "needs-auth" | "unknown";
        message: string;
        methodId?: string;
        methodName?: string;
        methods?: Array<{
          id: string;
          name?: string;
          description?: string;
          type?: string;
          vars?: Array<{
            name: string;
            label?: string;
            secret?: boolean;
            optional?: boolean;
          }>;
          link?: string;
        }>;
      };
    }
  | { type: "session.disposed"; session_id: string }
) & {
  /** Canonical OpenMA event produced at the main-process adapter boundary.
   *  `event` remains the legacy ACP payload during migration; consumers should
   *  prefer this field when they support the canonical vocabulary. */
  openma_event?: OpenMAEvent;
};
