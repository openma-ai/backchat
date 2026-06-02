/**
 * Settings → About. Static metadata + links. Phase 9 adds a "Check for
 * updates" button hooked to electron-updater.
 */
export function SettingsAbout() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-base font-medium text-fg">About</h1>
      </header>
      <dl className="space-y-3 text-sm">
        <Row label="App">openma desktop 0.0.1</Row>
        <Row label="Engine">Electron 42 · React 19 · TanStack Router</Row>
        <Row label="Protocol">Agent Client Protocol 0.23</Row>
        <Row label="Config file">
          <span className="font-mono">~/.openma-desktop/config.toml</span>
        </Row>
      </dl>
      <p className="text-xs text-fg-muted">
        openma desktop is a local-first ACP client. Conversations and tool
        invocations stay on your machine. The configured agents talk to
        their own model providers — review their docs for what leaves the
        machine.
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-fg">{children}</dd>
    </div>
  );
}
