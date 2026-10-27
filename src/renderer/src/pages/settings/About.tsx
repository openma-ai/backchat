import { type ReactNode } from "react";
import { PageScaffold } from "@/components/shell/PageScaffold";
import { Button } from "@/components/ui/button";
import { UpdateProgressBar } from "@/components/ui/update-progress";
import { composerBoxClass } from "@/lib/composer-box";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { useUpgradingAgentId } from "@/lib/agent-upgrade-store";
import {
  appInstallBlockHint,
  appUpdateSubject,
  agentUpdateSubject,
  updateStatusKey,
  useAgentsList,
  useAgentUpdateState,
  useAppUpdateState,
  type UpdateStatusLabel,
} from "@/lib/unified-update";
import type { UpdateChannel } from "@shared/app-update";

const channelKey: Record<UpdateChannel, TranslationKey> = {
  preview: "update.channelPreview",
  stable: "update.channelStable",
  dev: "update.channelDev",
};

/**
 * Settings → About.
 *
 * The update flow here is deliberately three separate user actions:
 *
 *   Check → Download → Restart
 *
 * "Check" only discovers a newer build. It never starts a download, so the
 * button cannot turn into a surprise 「正在下载更新…」. The download needs its
 * own click, and the install needs another one.
 *
 * The App and the managed agents share one status vocabulary, so the two
 * rows below read as one product instead of two unrelated update systems.
 */
export function SettingsAbout() {
  const { t } = useI18n();
  const state = useAppUpdateState();
  const agents = useAgentsList();
  const upgradingAgentId = useUpgradingAgentId();
  const agentState = useAgentUpdateState(agents, upgradingAgentId);

  const app = appUpdateSubject(state, t);
  const agent = agentUpdateSubject(agentState, t);
  const blockHint = appInstallBlockHint(state, t);

  const busy = app.busy;
  const canDownload = state?.status === "available" && state.canInstall;
  const canRestart = state?.status === "ready" && state.canInstall;
  const percent = state?.progress?.percent ?? 0;

  return (
    <PageScaffold title={t("settings.about")}>
      <dl className={composerBoxClass({ className: "overflow-hidden text-xs" })}>
        <Row label={t("about.version")}>
          <span data-testid="about-version">Backchat {state?.version ?? "…"}</span>
          {state ? (
            <span className="mt-0.5 block font-mono text-[11px] text-fg-muted">
              {identityLine(state, t)}
            </span>
          ) : null}
        </Row>
        <Row label={t("about.engine")}>Electron 42 · React 19 · TanStack Router</Row>
        <Row label={t("about.protocol")}>Agent Client Protocol 0.23</Row>
        <Row label={t("about.config")}>
          <span className="font-mono">~/.oma/config.toml</span>
        </Row>
      </dl>

      <dl
        data-testid="update-status-rows"
        className={composerBoxClass({ className: "overflow-hidden text-xs" })}
      >
        <StatusRow
          testId="update-app-row"
          label="Backchat"
          status={app.status}
          detail={app.detail}
        />
        <StatusRow
          testId="update-agents-row"
          label={t("update.agents.label")}
          status={agent.status}
          detail={agent.detail}
        />
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="update-check-button"
          disabled={busy}
          onClick={() => {
            // Check only. The download is a separate action below.
            void window.backchat.updateCheck().catch(() => undefined);
          }}
        >
          {state?.status === "checking" ? t("update.checking") : t("update.check")}
        </Button>
        {canDownload ? (
          <Button
            type="button"
            size="sm"
            data-testid="update-download-button"
            disabled={busy}
            onClick={() => {
              void window.backchat.updateDownload().catch(() => undefined);
            }}
          >
            {t("update.download")}
          </Button>
        ) : null}
        {canRestart ? (
          <Button
            type="button"
            size="sm"
            data-testid="update-restart-button"
            disabled={busy}
            onClick={() => {
              void window.backchat.updateInstall().catch(() => undefined);
            }}
          >
            {t("update.restart")}
          </Button>
        ) : null}
      </div>

      {state?.status === "downloading" ? (
        <div className="max-w-2xl space-y-1.5">
          <div className="flex items-center gap-2">
            <UpdateProgressBar
              percent={percent}
              label={t("update.progressLabel", { percent })}
              className="flex-1"
            />
            <span className="shrink-0 text-[11px] tabular-nums text-fg-muted">
              {percent}%
            </span>
          </div>
        </div>
      ) : null}

      <p data-testid="update-status" className="max-w-2xl text-[11px] leading-5 text-fg-muted">
        {statusMessage(state, t)}
      </p>
      {blockHint ? (
        <p data-testid="update-block-hint" className="max-w-2xl text-[11px] leading-5 text-fg-muted">
          {blockHint}
        </p>
      ) : null}
      <p className="max-w-2xl text-[11px] leading-5 text-fg-muted">
        {t("about.summary")}
      </p>
    </PageScaffold>
  );
}

function identityLine(
  state: { channel: UpdateChannel; build: number; commit: string },
  t: (key: TranslationKey, values?: Record<string, string | number>) => string,
): string {
  const parts = [t(channelKey[state.channel])];
  if (state.build > 0) parts.push(t("update.build", { build: state.build }));
  if (state.commit) parts.push(state.commit.slice(0, 7));
  return parts.join(" · ");
}

function StatusRow({
  detail,
  label,
  status,
  testId,
}: {
  detail: string | null;
  label: string;
  status: UpdateStatusLabel;
  testId: string;
}) {
  const { t } = useI18n();
  return (
    <div
      data-testid={testId}
      data-update-status={status}
      className="grid min-h-9 grid-cols-[120px_1fr] items-center gap-3 border-b border-border/35 px-3 py-2 last:border-b-0"
    >
      <dt className="text-fg-muted">{label}</dt>
      <dd className="flex min-w-0 items-baseline justify-between gap-3">
        <span className="truncate text-fg">{t(updateStatusKey(status))}</span>
        {detail ? (
          <span className="truncate font-mono text-[11px] tabular-nums text-fg-muted">
            {detail}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

function statusMessage(
  state: ReturnType<typeof useAppUpdateState>,
  t: (key: TranslationKey, values?: Record<string, string | number>) => string,
): string {
  if (!state) return t("update.idle");
  const version = state.available?.version ?? state.version;
  switch (state.status) {
    case "checking":
      return t("update.checking");
    case "downloading":
      return t("update.downloading");
    case "upToDate":
      return t("update.upToDate");
    case "available":
      return t("update.available", { version });
    case "ready":
      return t("update.ready", { version });
    case "installing":
      return t("update.restarting");
    case "error":
      return state.errorCode === "checksum"
        ? t("update.errorChecksum")
        : state.errorCode === "manifest"
          ? t("update.errorManifest")
          : state.errorCode === "install"
            ? t("update.errorInstall")
            : t("update.errorNetwork");
    default:
      return t("update.idle");
  }
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-10 grid-cols-[120px_1fr] items-center gap-3 border-b border-border/35 px-3 py-2 last:border-b-0">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-fg">{children}</dd>
    </div>
  );
}
