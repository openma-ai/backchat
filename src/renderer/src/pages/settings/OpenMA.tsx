import { DirectAgentConnections } from "./DirectAgentConnections";
import { useEffect, useState } from "react";
import { CloudIcon, ServerIcon } from "lucide-react";
import { PageScaffold } from "@/components/shell/PageScaffold";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusNotice } from "@/components/ui/status-notice";
import { useOpenmaAccount, useOpenmaRunner } from "@/lib/openma-account";
import { useI18n } from "@/lib/i18n";
import { OpenMAProjects } from "./OpenMAProjects";
import { SettingsCard, SettingsField, SettingsSection, SETTINGS_SELECT_CLASS } from "./SettingsPrimitives";

const FIELD_CLASS = "h-8 text-xs";

export function SettingsOpenMA() {
  const { t } = useI18n();
  const { data: account, error: loadError } = useOpenmaAccount();
  const { data: runner } = useOpenmaRunner();
  const [server, setServer] = useState("https://app.openma.ai");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [runnerIntent, setRunnerIntent] = useState<boolean | null>(null);
  useEffect(() => { if (account?.baseUrl) setServer(account.baseUrl); }, [account?.baseUrl]);
  const run = async (operation: () => Promise<void>) => {
    setError(""); setBusy(true);
    try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const hasOpenmaAccount = account?.workspaces.some(workspace => !workspace.provider);
  const signingIn = account?.status === "signing_in";
  const signedIn = account?.status === "signed_in";
  const showRunner = signedIn && !account.provider && account.canManageRuntimes !== false;
  const errorText = error || loadError?.message;
  return (
    <PageScaffold title={t("settings.openma")}>
      <div className="space-y-6">
        <DirectAgentConnections />

        <SettingsSection
          title={t("settings.openma")}
          icon={<CloudIcon className="size-3.5" />}
          description={t("openma.description")}
        >
          <SettingsCard>
            {hasOpenmaAccount && account?.user && (
              <div className="flex items-center justify-between gap-3 rounded-md bg-bg-surface/70 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-fg">{account.user.name}</div>
                  <div className="truncate text-[11px] text-fg-muted">{account.user.email}</div>
                </div>
                <span className="shrink-0 text-[11px] text-fg-subtle">
                  {t(signedIn ? "openma.signedIn" : account?.status === "expired" ? "openma.expiredShort" : "openma.signIn")}
                </span>
              </div>
            )}
            <SettingsField label={t("openma.server")}>
              <Input className={FIELD_CLASS} value={server} disabled={busy || signingIn} onChange={(e) => setServer(e.target.value)} />
            </SettingsField>
            {!!account?.workspaces.length && (
              <SettingsField label={t("openma.workspace")}>
                <select
                  className={SETTINGS_SELECT_CLASS}
                  disabled={busy || signingIn}
                  value={account.activeWorkspaceId ?? ""}
                  onChange={(e) => void run(() => window.backchat.openmaSelectWorkspace(e.target.value))}
                >
                  <option value="" disabled>{t("openma.chooseWorkspace")}</option>
                  {account.workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>{workspace.name || workspace.id}</option>
                  ))}
                </select>
              </SettingsField>
            )}
            {account?.status === "expired" && (
              <StatusNotice tone="warning" appearance="quiet">{t("openma.expired")}</StatusNotice>
            )}
            <div className="flex items-center gap-2 pt-1">
              {signingIn ? (
                <Button size="sm" variant="outline" onClick={() => void window.backchat.openmaCancelLogin()}>{t("common.cancel")}</Button>
              ) : (
                <Button size="sm" disabled={busy} onClick={() => void run(() => window.backchat.openmaLogin(server))}>
                  {t(hasOpenmaAccount && signedIn ? "openma.signInAgain" : "openma.signIn")}
                </Button>
              )}
              {hasOpenmaAccount && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => window.backchat.openmaLogout())}>{t("openma.signOut")}</Button>
              )}
              {signingIn && <span role="status" className="text-[11px] text-fg-muted">{t("openma.waiting")}</span>}
            </div>
            {errorText && <StatusNotice tone="danger" appearance="quiet">{errorText}</StatusNotice>}
          </SettingsCard>
        </SettingsSection>

        {showRunner && (
          <SettingsSection title={t("openma.runnerSection")} icon={<ServerIcon className="size-3.5" />}>
            <SettingsCard>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-0.5 size-3.5 shrink-0 accent-fg"
                  checked={runnerIntent ?? runner?.enabled ?? false}
                  disabled={busy || !account.activeWorkspaceId}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setRunnerIntent(enabled);
                    void run(() => enabled ? window.backchat.openmaRunnerEnable() : window.backchat.openmaRunnerDisable()).finally(() => setRunnerIntent(null));
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-fg">
                    {t(runner?.hosting === "external" ? "openma.useExistingRunner" : "openma.connectRunner")}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-fg-muted">{t("openma.runnerDescription")}</span>
                </span>
              </label>
              {runner && (
                <div className="space-y-0.5 text-[11px] text-fg-subtle">
                  {runner.hosting && <p>{t(`openma.runnerHosting.${runner.hosting}`)}</p>}
                  <p role="status">{t(`openma.runner.${runner.status}`)}</p>
                  {runner.message && <p>{runner.message}</p>}
                </div>
              )}
              {runner?.status === "registering" && (
                <Button size="sm" variant="outline" onClick={() => void window.backchat.openmaRunnerDisable()}>{t("common.cancel")}</Button>
              )}
            </SettingsCard>
          </SettingsSection>
        )}

        {signedIn && !account.provider && account.activeWorkspaceId && (
          <OpenMAProjects key={`${account.baseUrl}/${account.user?.id}/${account.activeWorkspaceId}`} />
        )}
      </div>
    </PageScaffold>
  );
}
