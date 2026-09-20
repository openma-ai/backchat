import { useState } from "react";
import { PlugIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useOpenmaAccount } from "@/lib/openma-account";
import type { AgentConnectionProvider } from "@shared/openma";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusNotice } from "@/components/ui/status-notice";
import {
  SettingsCard,
  SettingsField,
  SettingsListRow,
  SettingsSection,
  SETTINGS_SELECT_CLASS,
} from "./SettingsPrimitives";

const PROVIDERS: Array<{ value: AgentConnectionProvider; label: string; baseUrl: string }> = [
  { value: "openma", label: "OpenMA", baseUrl: "https://app.openma.ai" },
  { value: "claude-managed", label: "Claude Managed Agents", baseUrl: "https://api.anthropic.com" },
  { value: "openai-agents", label: "OpenAI Agents API", baseUrl: "https://api.openai.com/v1" },
];

const FIELD_CLASS = "h-8 text-xs";

export function DirectAgentConnections() {
  const { locale } = useI18n();
  const zh = locale === "zh-CN";
  const { data: account } = useOpenmaAccount();
  const [provider, setProvider] = useState<AgentConnectionProvider>("openma");
  const [baseUrl, setBaseUrl] = useState(PROVIDERS[0]!.baseUrl);
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
  const direct = account?.workspaces.filter((w) => w.provider) ?? [];
  const title = zh ? "Agent 服务连接" : "Agent connections";
  return (
    <SettingsSection
      title={title}
      icon={<PlugIcon className="size-3.5" />}
      description={zh
        ? "每个连接作为独立租户显示在侧栏，与 OpenMA 租户并存。"
        : "Each connection appears as a separate tenant in the sidebar, alongside your OpenMA workspaces."}
    >
      <div className="space-y-2">
        <SettingsCard>
          <form onSubmit={connect} className="space-y-3" aria-label={title}>
            <SettingsField label={zh ? "协议" : "Protocol"}>
              <select
                aria-label={zh ? "协议" : "Protocol"}
                value={provider}
                disabled={busy}
                className={SETTINGS_SELECT_CLASS}
                onChange={(e) => {
                  const next = e.target.value as AgentConnectionProvider;
                  setProvider(next);
                  setBaseUrl(PROVIDERS.find((p) => p.value === next)?.baseUrl ?? "");
                }}
              >
                {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </SettingsField>
            <SettingsField label={zh ? "租户名称（选填）" : "Tenant name (optional)"}>
              <Input className={FIELD_CLASS} value={name} maxLength={200} disabled={busy} onChange={(e) => setName(e.target.value)} placeholder={zh ? "我的 Agent 服务" : "My agent service"} />
            </SettingsField>
            <SettingsField
              label={zh ? "服务地址" : "Base URL"}
              hint={provider === "openai-agents"
                ? (zh ? "填写 SDK base URL，含 /v1；OpenMA 兼容入口为 /openai/v1。" : "Use the SDK base URL including /v1; OpenMA's compatibility endpoint is /openai/v1.")
                : (zh ? "填写服务根地址，不含 /v1。" : "Use the service root without /v1.")}
            >
              <Input className={FIELD_CLASS} required type="url" value={baseUrl} disabled={busy} onChange={(e) => setBaseUrl(e.target.value)} />
            </SettingsField>
            <SettingsField label="API Key">
              <Input className={FIELD_CLASS} required type="password" autoComplete="off" value={apiKey} disabled={busy} onChange={(e) => setApiKey(e.target.value)} />
            </SettingsField>
            <div className="flex items-center gap-3 pt-1">
              <Button type="submit" size="sm" disabled={busy}>
                {busy ? (zh ? "保存中…" : "Saving…") : (zh ? "添加租户" : "Add tenant")}
              </Button>
              {saved && (
                <span role="status" className="text-[11px] text-fg-muted">
                  {zh ? "已保存。可从侧栏打开该租户；首次加载会验证连接。" : "Saved. Open the tenant in the sidebar; its first load verifies the connection."}
                </span>
              )}
            </div>
          </form>
          {error && <StatusNotice tone="danger" appearance="quiet">{error}</StatusNotice>}
        </SettingsCard>
        {direct.map((workspace) => (
          <SettingsListRow
            key={workspace.id}
            title={workspace.name}
            description={`${workspace.provider === "claude-managed" ? "Claude Managed Agents" : workspace.provider === "openai-agents" ? "OpenAI Agents API" : "OpenMA"} · ${workspace.baseUrl}`}
            actions={(
              <>
                <Button type="button" variant="outline" size="xs" onClick={() => void window.backchat.openmaSelectWorkspace(workspace.id).catch((e) => setError(String(e)))}>{zh ? "选择" : "Select"}</Button>
                <Button type="button" variant="ghost" size="xs" onClick={() => void window.backchat.openmaRemoveDirect(workspace.id).catch((e) => setError(String(e)))}>{zh ? "移除" : "Remove"}</Button>
              </>
            )}
          />
        ))}
      </div>
    </SettingsSection>
  );
}
