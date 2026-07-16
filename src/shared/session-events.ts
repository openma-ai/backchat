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
  /** Provide an existing ACP-side session id to resume conversation history
   *  via `session/load`. Falls back to `session/new` when the agent doesn't
   *  advertise the loadSession capability. */
  resume?: { acp_session_id: string };
  /** Seed this session by forking an existing ACP-side session. This is the
   *  SDK's unstable `session/fork` path and should be treated as a context
   *  inheritance mechanism, not as the whole subagent communication model. */
  fork?: { acp_session_id: string };
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
   *  ~/.openma/sessions/<session_id>/ via the usual auto-allocator. */
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

export interface SessionPromptParams {
  session_id: string;
  /** Stable per-turn id. Used to route `session.event` and `session.complete`
   *  back to the right turn in the UI. */
  turn_id: string;
  text: string;
  attachments?: PromptAttachment[];
  annotations?: PromptAnnotation[];
  /** Running-time submission semantics. ACP v1 only standardizes
   *  turn-level prompts, so requested_* captures product intent while
   *  effective_* captures what this transport can honestly deliver. */
  prompt_intent?: AgentMessageIntent;
  requested_delivery?: AgentMessageDelivery;
  effective_delivery?: AgentMessageDelivery;
  delivery_degraded?: boolean;
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

/** Outbound (main → renderer) wire shapes. The renderer subscribes via
 *  `window.backchat.onSessionEvent(handler)` (preload). */
export type SessionEventOut =
  | {
      type: "session.ready";
      session_id: string;
      acp_session_id: string;
      agent_id: string;
      cwd: string;
      /** ACP `NewSessionResponse.configOptions` /
       *  `LoadSessionResponse.configOptions`, if the agent supports
       *  runtime session configuration. Kept as unknown at the shared
       *  IPC boundary; the renderer narrows to its display shape. */
      config_options?: readonly unknown[];
      /** Whether the agent advertised the unstable `session/fork`
       *  capability on initialize. The renderer uses this only to seed
       *  GUI-created side chats / forks with inherited context; native
       *  subagent communication state is tracked separately. */
      supports_session_fork?: boolean;
    }
  | {
      type: "session.event";
      session_id: string;
      turn_id: string;
      /** Raw ACP `SessionUpdate` (8 main variants) or a host-side synthetic
       *  like `{ type: "requestPermission", … }`. The renderer's reducer
       *  branches on the discriminator. */
      event: unknown;
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
  | { type: "session.complete"; session_id: string; turn_id: string }
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
    }
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
  | { type: "session.disposed"; session_id: string };
