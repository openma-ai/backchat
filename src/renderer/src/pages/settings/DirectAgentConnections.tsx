import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useOpenmaAccount } from "@/lib/openma-account";
import type { AgentConnectionProvider } from "@shared/openma";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function DirectAgentConnections() {
  const { locale } = useI18n();
  const zh = locale === "zh-CN";
  const { data: account } = useOpenmaAccount();
  const [provider, setProvider] = useState<AgentConnectionProvider>("openma");
  const [baseUrl, setBaseUrl] = useState("https://app.openma.dev");
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const connect = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setSaved(false);
    try {
      await window.backchat.openmaConnectDirect({ provider, baseUrl, apiKey, name });
      setApiKey(""); setSaved(true);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <section className="space-y-3 border-b border-border pb-5" aria-label={zh ? "Agent 服务连接" : "Agent connections"}>
    <h2 className="font-medium">{zh ? "Agent 服务连接" : "Agent connections"}</h2>
    <p className="text-fg-muted">{zh ? "每个连接作为独立租户显示在侧栏，与 OpenMA 租户并存。" : "Each connection appears as a separate tenant in the sidebar, alongside your OpenMA workspaces."}</p>
    <form onSubmit={connect} className="space-y-3">
      <label className="block space-y-1"><span>{zh ? "协议" : "Protocol"}</span>
        <select aria-label={zh ? "协议" : "Protocol"} value={provider} disabled={busy} className="block h-9 w-full rounded-md border border-border bg-bg px-3" onChange={e => {
          const next = e.target.value as AgentConnectionProvider; setProvider(next);
          setBaseUrl(next === "openma" ? "https://app.openma.dev" : next === "claude-managed" ? "https://api.anthropic.com" : "https://api.openai.com/v1");
        }}><option value="openma">OpenMA</option><option value="claude-managed">Claude Managed Agents</option><option value="openai-agents">OpenAI Agents API</option></select>
      </label>
      <label className="block space-y-1"><span>{zh ? "租户名称（选填）" : "Tenant name (optional)"}</span><Input value={name} maxLength={200} disabled={busy} onChange={e => setName(e.target.value)} placeholder={zh ? "我的 Agent 服务" : "My agent service"} /></label>
      <label className="block space-y-1"><span>{zh ? "服务地址" : "Base URL"}</span><Input required type="url" value={baseUrl} disabled={busy} onChange={e => setBaseUrl(e.target.value)} /></label>
      <p className="text-xs text-fg-subtle">{provider === "openai-agents" ? (zh ? "填写 SDK base URL，含 /v1；OpenMA 兼容入口为 /openai/v1。" : "Use the SDK base URL including /v1; OpenMA's compatibility endpoint is /openai/v1.") : (zh ? "填写服务根地址，不含 /v1。" : "Use the service root without /v1.")}</p>
      <label className="block space-y-1"><span>API Key</span><Input required type="password" autoComplete="off" value={apiKey} disabled={busy} onChange={e => setApiKey(e.target.value)} /></label>
      <Button type="submit" disabled={busy}>{busy ? (zh ? "保存中…" : "Saving…") : (zh ? "添加租户" : "Add tenant")}</Button>
    </form>
    {saved && <p role="status">{zh ? "已保存。可从侧栏打开该租户；首次加载会验证连接。" : "Saved. Open the tenant in the sidebar; its first load verifies the connection."}</p>}
    {error && <p role="alert" className="text-red-500">{error}</p>}
    {account?.workspaces.filter(w => w.provider).map(workspace => <div key={workspace.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
      <div className="min-w-0"><div>{workspace.name}</div><div className="truncate text-xs text-fg-muted">{workspace.provider === "claude-managed" ? "Claude Managed Agents" : "OpenAI Agents API"} · {workspace.baseUrl}</div></div>
      <Button type="button" variant="outline" size="sm" onClick={() => void window.backchat.openmaSelectWorkspace(workspace.id).catch(e => setError(String(e)))}>{zh ? "选择" : "Select"}</Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => void window.backchat.openmaRemoveDirect(workspace.id).catch(e => setError(String(e)))}>{zh ? "移除" : "Remove"}</Button>
    </div>)}
  </section>;
}
