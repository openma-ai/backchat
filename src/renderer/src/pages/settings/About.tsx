/**
 * Settings → About. Static metadata + links. Phase 9 adds a "Check for
 * updates" button hooked to electron-updater.
 */
export function SettingsAbout() {
  return (
    <div className="space-y-5 text-xs">
      <header>
        <h1 className="text-sm font-medium text-fg">About</h1>
      </header>
      <dl className="overflow-hidden rounded-xl border border-border/45 bg-bg/70 text-xs shadow-card-soft">
        <Row label="App">Backchat 0.0.1</Row>
        <Row label="Engine">Electron 42 · React 19 · TanStack Router</Row>
        <Row label="Protocol">Agent Client Protocol 0.23</Row>
        <Row label="Config file">
          <span className="font-mono">~/.openma/config.toml</span>
        </Row>
      </dl>
      <p className="max-w-2xl text-[11px] leading-5 text-fg-muted">
        Backchat is a local-first ACP client. Conversations and tool
        invocations stay on your machine. The configured agents talk to
        their own model providers — review their docs for what leaves the
        machine.
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-10 grid-cols-[120px_1fr] items-center gap-3 border-b border-border/35 px-3 py-2 last:border-b-0">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-fg">{children}</dd>
    </div>
  );
}
