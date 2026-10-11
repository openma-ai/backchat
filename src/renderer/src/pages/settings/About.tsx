import { useEffect, useState, type ReactNode } from "react";
import { PageScaffold } from "@/components/shell/PageScaffold";
import { Button } from "@/components/ui/button";
import { composerBoxClass } from "@/lib/composer-box";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import type { AppUpdateState, UpdateChannel } from "@shared/app-update";

const channelKey: Record<UpdateChannel, TranslationKey> = {
  preview: "update.channelPreview",
  stable: "update.channelStable",
  dev: "update.channelDev",
};

/**
 * Settings → About. The version comes from app.getVersion() and the build
 * metadata. "Restart and update" asks electron-updater to quit through the
 * normal shutdown barrier; Squirrel.Mac then replaces the signed app.
 */
export function SettingsAbout() {
  const { t } = useI18n();
  const [state, setState] = useState<AppUpdateState | null>(null);
  useEffect(() => {
    let live = true;
    void window.backchat.updateGetState().then((next) => {
      if (live) setState(next);
    }).catch(() => undefined);
    const unsubscribe = window.backchat.onUpdateState((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);

  const busy = state?.status === "checking"
    || state?.status === "downloading"
    || state?.status === "installing";
  const version = state?.version ?? "…";
  const detail = state ? identityLine(state, t) : "";

  return (
    <PageScaffold title={t("settings.about")}>
      <dl className={composerBoxClass({ className: "overflow-hidden text-xs" })}>
        <Row label={t("about.version")}>
          <span data-testid="about-version">Backchat {version}</span>
          {detail ? (
            <span className="mt-0.5 block font-mono text-[11px] text-fg-muted">{detail}</span>
          ) : null}
        </Row>
        <Row label={t("about.engine")}>Electron 42 · React 19 · TanStack Router</Row>
        <Row label={t("about.protocol")}>Agent Client Protocol 0.23</Row>
        <Row label={t("about.config")}>
          <span className="font-mono">~/.oma/config.toml</span>
        </Row>
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => {
            void window.backchat.updateCheck().then(setState).catch(() => undefined);
          }}
        >
          {state?.status === "checking" ? t("update.checking") : t("update.check")}
        </Button>
        {state?.status === "ready" && state.canInstall ? (
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => {
              void window.backchat.updateInstall().then(setState).catch(() => undefined);
            }}
          >
            {t("update.restart")}
          </Button>
        ) : null}
      </div>
      <p data-testid="update-status" className="max-w-2xl text-[11px] leading-5 text-fg-muted">
        {statusMessage(state, t)}
      </p>
      <p className="max-w-2xl text-[11px] leading-5 text-fg-muted">
        {t("about.summary")}
      </p>
    </PageScaffold>
  );
}

function identityLine(
  state: AppUpdateState,
  t: (key: TranslationKey, values?: Record<string, string | number>) => string,
): string {
  const parts = [t(channelKey[state.channel])];
  if (state.build > 0) parts.push(t("update.build", { build: state.build }));
  if (state.commit) parts.push(state.commit.slice(0, 7));
  return parts.join(" · ");
}

function statusMessage(
  state: AppUpdateState | null,
  t: (key: TranslationKey, values?: Record<string, string | number>) => string,
): string {
  if (!state) return t("update.idle");
  if (state.installBlock === "dev") return t("update.devBlocked");
  if (state.installBlock === "platform") return t("update.platformBlocked");
  const version = state.available?.version ?? state.version;
  let main: string;
  switch (state.status) {
    case "checking":
      main = t("update.checking");
      break;
    case "downloading":
      main = t("update.downloading");
      break;
    case "upToDate":
      main = t("update.upToDate");
      break;
    case "available":
      main = t("update.available", { version });
      break;
    case "ready":
      main = t("update.ready", { version });
      break;
    case "installing":
      main = t("update.restarting");
      break;
    case "error":
      main = state.errorCode === "checksum"
        ? t("update.errorChecksum")
        : state.errorCode === "manifest"
          ? t("update.errorManifest")
          : state.errorCode === "install"
            ? t("update.errorInstall")
            : t("update.errorNetwork");
      break;
    default:
      main = t("update.idle");
  }
  if (state.installBlock === "unsigned") return `${main} ${t("update.unsignedBlocked")}`;
  if (state.installBlock === "location") return `${main} ${t("update.locationBlocked")}`;
  return main;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-10 grid-cols-[120px_1fr] items-center gap-3 border-b border-border/35 px-3 py-2 last:border-b-0">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-fg">{children}</dd>
    </div>
  );
}
