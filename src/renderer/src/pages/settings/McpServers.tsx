import { useState } from "react";
import { EyeIcon, EyeOffIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useSettings, patchSettings } from "@/lib/settings-store";
import type { SettingsMcpServer } from "@shared/settings.js";

/**
 * Settings → MCP Servers — Phase 8 full editor.
 *
 * Supports all three ACP McpServer variants (http / sse / stdio) with
 * type-aware fields, dynamic header / env / args rows, mask-by-default
 * for secret values, and inline edit of existing servers.
 */
export function SettingsMcpServers() {
  const settings = useSettings();
  const [editing, setEditing] = useState<SettingsMcpServer | "new" | null>(null);
  if (!settings) return null;
  const servers = settings.mcp_servers;

  const upsert = async (s: SettingsMcpServer, replaceId?: string) => {
    const list = replaceId
      ? servers.map((x) => (x.id === replaceId ? s : x))
      : [...servers, s];
    await patchSettings({ mcp_servers: list });
    setEditing(null);
  };

  const remove = async (id: string) => {
    await patchSettings({ mcp_servers: servers.filter((s) => s.id !== id) });
  };

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-base font-medium text-fg">MCP Servers</h1>
          <p className="mt-1 text-xs text-fg-muted">
            Tools & data sources every chat session connects to. Forwarded
            verbatim to <span className="font-mono">session/new</span>.
          </p>
        </div>
        {editing === null && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <PlusIcon className="size-3.5" />
            Add server
          </Button>
        )}
      </header>

      {editing !== null && (
        <ServerForm
          initial={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSave={(s) =>
            upsert(s, editing === "new" ? undefined : (editing as SettingsMcpServer).id)
          }
        />
      )}

      {editing === null && servers.length === 0 && (
        <div className="rounded-md bg-bg-surface/50 p-6 text-center text-xs text-fg-muted">
          No MCP servers configured yet.
        </div>
      )}

      {editing === null && servers.length > 0 && (
        <ul className="divide-y divide-border/40 rounded-lg bg-bg-surface/40">
          {servers.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
              <Badge variant="secondary" className="text-[10px] uppercase">
                {s.type}
              </Badge>
              <span className="text-sm font-medium text-fg">{s.name}</span>
              <span className="ml-1 truncate font-mono text-[11px] text-fg-subtle">
                {s.type === "stdio" ? `${s.command} ${s.args.join(" ")}` : s.url}
              </span>
              <div className="ml-auto flex shrink-0 items-center">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-fg-muted hover:text-fg"
                  onClick={() => setEditing(s)}
                  aria-label={`Edit ${s.name}`}
                >
                  <PencilIcon className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-fg-muted hover:text-danger"
                  onClick={() => remove(s.id)}
                  aria-label={`Delete ${s.name}`}
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// -------------------- ServerForm --------------------

type FormState = {
  type: "http" | "sse" | "stdio";
  name: string;
  /** http/sse only */
  url: string;
  /** stdio only */
  command: string;
  /** stdio only — newline-separated */
  argsText: string;
  /** headers (http/sse) or env (stdio) — same UI, different field on save */
  pairs: Array<{ id: string; name: string; value: string; secret?: boolean }>;
};

function initialFromServer(s: SettingsMcpServer | null): FormState {
  if (!s) {
    return {
      type: "http",
      name: "",
      url: "",
      command: "",
      argsText: "",
      pairs: [],
    };
  }
  if (s.type === "stdio") {
    return {
      type: "stdio",
      name: s.name,
      url: "",
      command: s.command,
      argsText: s.args.join("\n"),
      pairs: s.env.map((e, i) => ({
        id: `e-${i}`,
        name: e.name,
        value: e.value,
        secret: /key|token|secret|password/i.test(e.name),
      })),
    };
  }
  return {
    type: s.type,
    name: s.name,
    url: s.url,
    command: "",
    argsText: "",
    pairs: s.headers.map((h, i) => ({
      id: `h-${i}`,
      name: h.name,
      value: h.value,
      secret: /authorization|token|key|secret/i.test(h.name),
    })),
  };
}

function ServerForm({
  initial,
  onCancel,
  onSave,
}: {
  initial: SettingsMcpServer | null;
  onCancel: () => void;
  onSave: (s: SettingsMcpServer) => void | Promise<void>;
}) {
  const [f, setF] = useState<FormState>(() => initialFromServer(initial));
  const isStdio = f.type === "stdio";
  const valid = isStdio ? !!(f.name && f.command) : !!(f.name && f.url);

  const updatePair = (id: string, patch: Partial<FormState["pairs"][number]>) => {
    setF((prev) => ({
      ...prev,
      pairs: prev.pairs.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  };
  const addPair = () =>
    setF((prev) => ({
      ...prev,
      pairs: [
        ...prev.pairs,
        { id: `n-${Math.random().toString(36).slice(2, 6)}`, name: "", value: "" },
      ],
    }));
  const removePair = (id: string) =>
    setF((prev) => ({ ...prev, pairs: prev.pairs.filter((p) => p.id !== id) }));

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const id =
      initial?.id ??
      `mcp-${f.name.toLowerCase().replace(/\s+/g, "-")}-${Math.random()
        .toString(36)
        .slice(2, 6)}`;
    const trimmedPairs = f.pairs
      .map((p) => ({ name: p.name.trim(), value: p.value }))
      .filter((p) => p.name);
    let server: SettingsMcpServer;
    if (isStdio) {
      const args = f.argsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      server = {
        id,
        type: "stdio",
        name: f.name.trim(),
        command: f.command.trim(),
        args,
        env: trimmedPairs,
      };
    } else {
      // `f.type` here is "http" | "sse" | "stdio"; the !isStdio branch
      // narrows runtime but TS doesn't see it (FormState.type is the
      // 3-union, isStdio is a boolean derived from it). Explicit cast
      // to the http|sse subset matches what SettingsMcpServer expects.
      server = {
        id,
        type: f.type as "http" | "sse",
        name: f.name.trim(),
        url: f.url.trim(),
        headers: trimmedPairs,
      };
    }
    void onSave(server);
  };

  const pairLabel = isStdio ? "Environment variable" : "Header";

  return (
    <form onSubmit={save} className="space-y-3 rounded-lg bg-bg-surface/50 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-fg">
          {initial ? `Edit ${initial.name}` : "Add MCP server"}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close form"
          className="text-fg-muted hover:text-fg"
        >
          <XIcon className="size-4" />
        </button>
      </div>

      <Field label="Type">
        <div className="flex gap-1 rounded-md bg-bg p-1">
          {(["http", "sse", "stdio"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setF((p) => ({ ...p, type: t }))}
              className={cn(
                "flex-1 rounded px-2 py-1.5 text-xs uppercase tracking-wider transition-colors",
                f.type === t
                  ? "bg-bg-surface text-fg shadow-[0_1px_2px_-1px_rgb(0_0_0/0.08)]"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Name">
        <input
          autoFocus
          className={inputClass}
          value={f.name}
          onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))}
          placeholder="Linear"
        />
      </Field>

      {!isStdio && (
        <Field label="URL">
          <input
            className={inputClass}
            value={f.url}
            onChange={(e) => setF((p) => ({ ...p, url: e.target.value }))}
            placeholder={
              f.type === "sse"
                ? "https://example.com/mcp/sse"
                : "https://example.com/mcp"
            }
            type="url"
          />
        </Field>
      )}

      {isStdio && (
        <>
          <Field label="Command">
            <input
              className={inputClass}
              value={f.command}
              onChange={(e) => setF((p) => ({ ...p, command: e.target.value }))}
              placeholder="npx"
            />
          </Field>
          <Field label="Args (one per line)">
            <textarea
              className={cn(inputClass, "min-h-[64px] resize-y py-2 font-mono")}
              value={f.argsText}
              onChange={(e) => setF((p) => ({ ...p, argsText: e.target.value }))}
              placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/tmp"}
            />
          </Field>
        </>
      )}

      <div>
        <div className="mb-1 flex items-center justify-between text-[11px]">
          <span className="text-fg-muted">{pairLabel}s</span>
          <button
            type="button"
            onClick={addPair}
            className="inline-flex items-center gap-1 text-fg-muted hover:text-fg"
          >
            <PlusIcon className="size-3" />
            Add
          </button>
        </div>
        {f.pairs.length === 0 ? (
          <p className="rounded-md bg-bg/60 px-2.5 py-2 text-[11px] text-fg-subtle">
            No {pairLabel.toLowerCase()}s configured.
          </p>
        ) : (
          <ul className="space-y-1">
            {f.pairs.map((p) => (
              <li key={p.id} className="flex items-center gap-1.5">
                <input
                  className={cn(inputClass, "w-1/3 font-mono")}
                  value={p.name}
                  onChange={(e) => updatePair(p.id, { name: e.target.value })}
                  placeholder={isStdio ? "ANTHROPIC_API_KEY" : "Authorization"}
                />
                <SecretInput
                  value={p.value}
                  secret={!!p.secret}
                  onValue={(v) => updatePair(p.id, { value: v })}
                  onToggleSecret={() => updatePair(p.id, { secret: !p.secret })}
                />
                <button
                  type="button"
                  onClick={() => removePair(p.id)}
                  className="shrink-0 text-fg-muted hover:text-danger"
                  aria-label="Remove row"
                >
                  <Trash2Icon className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!valid}>
          {initial ? "Save changes" : "Add server"}
        </Button>
      </div>
    </form>
  );
}

function SecretInput({
  value,
  secret,
  onValue,
  onToggleSecret,
}: {
  value: string;
  secret: boolean;
  onValue: (v: string) => void;
  onToggleSecret: () => void;
}) {
  const [reveal, setReveal] = useState(false);
  return (
    <div className="relative flex-1">
      <input
        className={cn(inputClass, "pr-14 font-mono")}
        type={secret && !reveal ? "password" : "text"}
        value={value}
        onChange={(e) => onValue(e.target.value)}
        placeholder="Value"
      />
      <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
        {secret && (
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            className="rounded p-1 text-fg-muted hover:bg-bg hover:text-fg"
            aria-label={reveal ? "Hide value" : "Show value"}
          >
            {reveal ? (
              <EyeOffIcon className="size-3.5" />
            ) : (
              <EyeIcon className="size-3.5" />
            )}
          </button>
        )}
        <button
          type="button"
          onClick={onToggleSecret}
          className={cn(
            "rounded p-1 text-[9px] uppercase tracking-wider",
            secret ? "text-brand" : "text-fg-subtle hover:text-fg-muted",
          )}
          aria-label={secret ? "Mark non-secret" : "Mark secret"}
          title={secret ? "Marked as secret — value masked" : "Mark as secret"}
        >
          KEY
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

const inputClass = cn(
  "h-8 w-full rounded-md bg-bg px-2.5 text-sm text-fg placeholder:text-fg-subtle",
  "focus:outline-none focus:ring-1 focus:ring-brand/40",
);
