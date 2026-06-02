import { useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useSettings, patchSettings } from "@/lib/settings-store";
import type { SettingsMcpServer } from "@shared/settings.js";

/**
 * Settings → MCP Servers. Phase-8 polish covers per-agent disables and the
 * full add/edit dialog with secret masking. This first pass ships:
 *
 *   - List view with type/name/url
 *   - Add (http only — stdio + sse follow once the form complexity is worth
 *     a dedicated dialog)
 *   - Delete
 *
 * Servers are passed verbatim into every `session/new` (see ipc.ts). Agents
 * connect to all of them; per-agent disables ship in Phase 8.
 */
export function SettingsMcpServers() {
  const settings = useSettings();
  const [adding, setAdding] = useState(false);
  if (!settings) return null;
  const servers = settings.mcp_servers;

  const remove = async (id: string) => {
    await patchSettings({
      mcp_servers: servers.filter((s) => s.id !== id),
    });
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
        <Button size="sm" onClick={() => setAdding(true)}>
          <PlusIcon className="size-3.5" />
          Add server
        </Button>
      </header>

      {servers.length === 0 ? (
        <div className="rounded-md bg-bg-surface/50 p-6 text-center text-xs text-fg-muted">
          No MCP servers configured yet.
        </div>
      ) : (
        <ul className="divide-y divide-border/40 rounded-lg bg-bg-surface/40">
          {servers.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
              <Badge variant="secondary" className="text-[10px] uppercase">
                {s.type}
              </Badge>
              <span className="font-medium text-sm text-fg">{s.name}</span>
              <span className="ml-1 truncate font-mono text-[11px] text-fg-subtle">
                {s.type === "stdio" ? `${s.command} ${s.args.join(" ")}` : s.url}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto size-7 text-fg-muted hover:text-danger"
                onClick={() => remove(s.id)}
                aria-label={`Delete ${s.name}`}
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <AddServerForm
          onCancel={() => setAdding(false)}
          onSave={async (server) => {
            await patchSettings({ mcp_servers: [...servers, server] });
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

/** Inline add-server form. Inline (vs modal) for a settings tab — lets the
 *  user keep the existing list visible while filling fields. Phase 8 adds
 *  validation / type-switching / secret masking. */
function AddServerForm({
  onCancel,
  onSave,
}: {
  onCancel: () => void;
  onSave: (s: SettingsMcpServer) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");

  const canSave = name.trim() && url.trim();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    const id = `mcp-${name.toLowerCase().replace(/\s+/g, "-")}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    void onSave({
      id,
      type: "http",
      name: name.trim(),
      url: url.trim(),
      headers: token.trim()
        ? [{ name: "Authorization", value: `Bearer ${token.trim()}` }]
        : [],
    });
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-lg bg-bg-surface/50 p-4"
    >
      <h2 className="text-sm font-medium text-fg">Add HTTP MCP server</h2>
      <Field label="Name">
        <input
          autoFocus
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Linear"
        />
      </Field>
      <Field label="URL">
        <input
          className={inputClass}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/mcp"
        />
      </Field>
      <Field label="Bearer token (optional)">
        <input
          type="password"
          className={inputClass}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Stored as Authorization header"
        />
      </Field>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!canSave}>
          Save
        </Button>
      </div>
    </form>
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
