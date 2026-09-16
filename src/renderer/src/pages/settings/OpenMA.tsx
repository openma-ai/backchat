import { useEffect, useState } from "react";
import { PageScaffold } from "@/components/shell/PageScaffold";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useOpenmaAccount, useOpenmaRunner } from "@/lib/openma-account";
import { useI18n } from "@/lib/i18n";
import { OpenMAProjects } from "./OpenMAProjects";

export function SettingsOpenMA() {
  const { t } = useI18n();
  const { data: account, error: loadError } = useOpenmaAccount();
  const { data: runner } = useOpenmaRunner();
  const [server, setServer] = useState("https://app.openma.dev");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [runnerIntent, setRunnerIntent] = useState<boolean | null>(null);
  useEffect(() => { if (account?.baseUrl) setServer(account.baseUrl); }, [account?.baseUrl]);
  const run = async (operation: () => Promise<void>) => {
    setError(""); setBusy(true);
    try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const signingIn = account?.status === "signing_in";
  return (
    <PageScaffold title={t("settings.openma")}>
      <div className="max-w-xl space-y-5 text-sm">
        <p className="text-fg-muted">{t("openma.description")}</p>
        <label className="block space-y-2">
          <span>{t("openma.server")}</span>
          <Input value={server} disabled={busy || signingIn} onChange={(e) => setServer(e.target.value)} />
        </label>
        {account?.user && <div><div>{account.user.name}</div><div className="text-fg-muted">{account.user.email}</div></div>}
        {account?.status === "expired" && <p role="status">{t("openma.expired")}</p>}
        {!!account?.workspaces.length && (
          <label className="block space-y-2">
            <span>{t("openma.workspace")}</span>
            <select className="block h-9 w-full rounded-md border border-border bg-bg px-3" disabled={busy || signingIn}
              value={account.activeWorkspaceId ?? ""} onChange={(e) => void run(() => window.backchat.openmaSelectWorkspace(e.target.value))}>
              <option value="" disabled>{t("openma.chooseWorkspace")}</option>
              {account.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name || workspace.id}</option>)}
            </select>
          </label>
        )}
        <div className="flex gap-2">
          {signingIn ? <Button variant="outline" onClick={() => void window.backchat.openmaCancelLogin()}>{t("common.cancel")}</Button>
            : <Button disabled={busy} onClick={() => void run(() => window.backchat.openmaLogin(server))}>{t(account?.status === "signed_in" ? "openma.signInAgain" : "openma.signIn")}</Button>}
          {account?.user && <Button variant="outline" disabled={busy} onClick={() => void run(() => window.backchat.openmaLogout())}>{t("openma.signOut")}</Button>}
        </div>
        {signingIn && <p role="status" className="text-fg-muted">{t("openma.waiting")}</p>}
        {account?.status === "signed_in" && (
          <div className="space-y-2 border-t border-border pt-4">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={runnerIntent ?? runner?.enabled ?? false} disabled={busy || !account.activeWorkspaceId}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  setRunnerIntent(enabled);
                  void run(() => enabled ? window.backchat.openmaRunnerEnable() : window.backchat.openmaRunnerDisable()).finally(() => setRunnerIntent(null));
                }} />
              <span>{t(runner?.hosting === "external" ? "openma.useExistingRunner" : "openma.connectRunner")}</span>
            </label>
            <p className="text-xs text-fg-muted">{t("openma.runnerDescription")}</p>
            {runner?.hosting && <p className="text-xs text-fg-muted">{t(`openma.runnerHosting.${runner.hosting}`)}</p>}
            {runner && <p role="status" className="text-xs text-fg-muted">{t(`openma.runner.${runner.status}`)}</p>}
            {runner?.message && <p className="text-xs text-fg-muted">{runner.message}</p>}
            {runner?.status === "registering" && <Button variant="outline" onClick={() => void window.backchat.openmaRunnerDisable()}>{t("common.cancel")}</Button>}
          </div>
        )}
        {(error || loadError) && <p role="alert" className="text-red-500">{error || loadError?.message}</p>}
        {account?.status === "signed_in" && account.activeWorkspaceId && <OpenMAProjects key={`${account.baseUrl}/${account.user?.id}/${account.activeWorkspaceId}`} />}
      </div>
    </PageScaffold>
  );
}
