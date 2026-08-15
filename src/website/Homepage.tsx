import {
  ArrowRight,
  Blocks,
  Check,
  ChevronRight,
  Download,
  FolderGit2,
  GitFork,
  Laptop,
  LockKeyhole,
  PanelRight,
  TerminalSquare,
} from "lucide-react";
import homeScreenshotUrl from "../../artifacts/theme-system/default-spec-v1.png";
import activityScreenshotUrl from "../../artifacts/activity-states/06-complete-expanded.png";
import pipScreenshotUrl from "../../artifacts/interactive-containers/03-picture-in-picture.png";
import backchatLogoUrl from "../../docs/assets/backchat-logo.png";

const githubUrl = "https://github.com/openma-ai/backchat";
const macBuildsUrl = `${githubUrl}/releases/download/preview/Backchat-preview-arm64.dmg`;

const packageRunbooks = [
  {
    platform: "Windows",
    terminal: "PowerShell",
    target: "NSIS installer",
    requirements: "Windows 10/11 · Git · Node.js 20+",
    output: "release/<version>/*.exe",
    commands: `git clone https://github.com/openma-ai/backchat.git
cd backchat
corepack enable
corepack prepare pnpm@10.34.5 --activate
pnpm install --frozen-lockfile
pnpm exec electron-vite build
pnpm exec electron-builder --win nsis --publish never`,
  },
  {
    platform: "Linux",
    terminal: "Shell",
    target: "AppImage",
    requirements: "64-bit Linux · Git · Node.js 20+",
    output: "release/<version>/*.AppImage",
    commands: `git clone https://github.com/openma-ai/backchat.git
cd backchat
corepack enable
corepack prepare pnpm@10.34.5 --activate
pnpm install --frozen-lockfile
pnpm exec electron-vite build
pnpm exec electron-builder --linux AppImage --publish never`,
  },
];

const agents = [
  { name: "Claude Code", entry: "claude-acp", detail: "Official ACP adapter" },
  { name: "Codex CLI", entry: "codex-acp", detail: "Native Codex workflow" },
  { name: "DeepSeek Harness", entry: "dsh-acp", detail: "Standalone or dsh profile" },
  { name: "Gemini CLI", entry: "gemini", detail: "Gemini ACP mode" },
  { name: "OpenCode", entry: "opencode", detail: "OpenCode ACP mode" },
  { name: "Hermes", entry: "hermes", detail: "Hermes ACP entry" },
  { name: "OpenClaw", entry: "openclaw", detail: "OpenClaw ACP entry" },
];

function BrandLockup() {
  return (
    <span className="brand-lockup">
      <img src={backchatLogoUrl} alt="" width="32" height="32" />
      <span>Backchat</span>
    </span>
  );
}

function ProductFrame({
  src,
  alt,
  label,
  className = "",
}: {
  src: string;
  alt: string;
  label: string;
  className?: string;
}) {
  return (
    <figure className={`product-frame ${className}`.trim()}>
      <div className="product-frame-bar" aria-hidden="true">
        <span>{label}</span>
        <span>Local</span>
      </div>
      <img src={src} alt={alt} loading="lazy" />
    </figure>
  );
}

export function Homepage() {
  return (
    <div className="site-shell" id="top">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <header className="site-header">
        <div className="site-header-inner">
          <a className="brand-link" href="#top" aria-label="Backchat home">
            <BrandLockup />
          </a>
          <nav className="primary-nav" aria-label="Primary navigation">
            <a href="#product">Product</a>
            <a href="#agents">Agents</a>
            <a href="#download">Download</a>
            <a className="nav-github" href={githubUrl} target="_blank" rel="noreferrer">
              <GitFork aria-hidden="true" size={16} />
              <span>GitHub</span>
            </a>
          </nav>
        </div>
      </header>

      <main id="main-content">
        <section className="hero section-wrap" aria-labelledby="hero-title">
          <a
            className="announcement"
            href="https://github.com/openma-ai/deepseek-harness-acp"
            target="_blank"
            rel="noreferrer"
          >
            <span>New</span>
            DeepSeek Harness is now supported
            <ChevronRight aria-hidden="true" size={14} />
          </a>

          <div className="hero-copy">
            <p className="eyebrow">LOCAL-FIRST · ACP-NATIVE</p>
            <h1 id="hero-title">One workspace. Every agent.</h1>
            <p className="hero-lede">
              Backchat brings Claude Code, Codex, DeepSeek Harness, and other ACP
              agents into one calm desktop—without taking your work off your machine.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href={macBuildsUrl}>
                <Download aria-hidden="true" size={17} />
                Download for macOS
              </a>
              <a className="button button-secondary" href={githubUrl}>
                View on GitHub
                <ArrowRight aria-hidden="true" size={16} />
              </a>
            </div>
            <p className="hero-meta">
              Apple Silicon preview <span aria-hidden="true">·</span> v0.0.3{" "}
              <span aria-hidden="true">·</span> Open source
            </p>
          </div>

          <div className="hero-product" aria-label="Backchat desktop preview">
            <ProductFrame
              src={homeScreenshotUrl}
              alt="Backchat desktop home"
              label="Backchat / New chat"
              className="product-frame-hero"
            />
            <p className="image-caption">
              Pick a project, pick a harness, and start with the agent's real capabilities.
            </p>
          </div>
        </section>

        <section className="agent-cloud section-wrap" aria-labelledby="agent-cloud-title">
          <p id="agent-cloud-title">A shared desktop for the agents you already use</p>
          <ul aria-label="Supported agent harnesses">
            {agents.map((agent) => (
              <li key={agent.name}>{agent.name}</li>
            ))}
          </ul>
        </section>

        <section className="product-section section-wrap" id="product" aria-labelledby="product-title">
          <div className="section-intro">
            <p className="section-kicker">THE PRODUCT</p>
            <h2 id="product-title">The conversation stays central. The tools stay close.</h2>
            <p>
              Backchat is a desktop client, not another agent dashboard. Files, terminals,
              browser tabs, side chats, and rich outputs appear when the work needs them.
            </p>
          </div>

          <article className="story-row">
            <div className="story-copy">
              <span className="story-index">01</span>
              <h3>See the work, not a wall of logs.</h3>
              <p>
                Thinking and tool calls fold into a readable activity history. Follow the
                current action while it runs; open the details only when you need them.
              </p>
              <ul className="check-list">
                <li><Check aria-hidden="true" size={15} /> Grouped tool activity</li>
                <li><Check aria-hidden="true" size={15} /> Streaming thoughts</li>
                <li><Check aria-hidden="true" size={15} /> Stable conversation timeline</li>
              </ul>
            </div>
            <ProductFrame
              src={activityScreenshotUrl}
              alt="Grouped agent activity in Backchat"
              label="Backchat / Activity"
            />
          </article>

          <article className="story-row story-row-reverse">
            <div className="story-copy">
              <span className="story-index">02</span>
              <h3>Outputs have somewhere to live.</h3>
              <p>
                Open project files, keep a terminal nearby, or let an interactive MCP App
                expand into the side rail and picture-in-picture without leaving the task.
              </p>
              <div className="capability-list" aria-label="Workspace capabilities">
                <span><FolderGit2 aria-hidden="true" size={16} /> Project files</span>
                <span><TerminalSquare aria-hidden="true" size={16} /> Terminal</span>
                <span><PanelRight aria-hidden="true" size={16} /> Side chats</span>
                <span><Blocks aria-hidden="true" size={16} /> MCP Apps</span>
              </div>
            </div>
            <ProductFrame
              src={pipScreenshotUrl}
              alt="Interactive output shown beside a Backchat conversation"
              label="Backchat / Outputs"
              className="product-frame-dark"
            />
          </article>
        </section>

        <section className="truth-section section-wrap" aria-labelledby="truth-title">
          <div className="truth-copy">
            <p className="section-kicker">LIVE TRUTH</p>
            <h2 id="truth-title">Agent-aware, not vendor-shaped.</h2>
            <p>
              Models, commands, modes, permissions, and session controls come from the
              selected harness. Backchat does not invent a generic capability layer and
              pretend every agent works the same way.
            </p>
          </div>
          <div className="truth-terminal" aria-label="Example live harness capabilities">
            <div className="truth-terminal-title">
              <span>session / capabilities</span>
              <span>live</span>
            </div>
            <dl>
              <div><dt>agent</dt><dd>codex-acp</dd></div>
              <div><dt>mode</dt><dd>auto</dd></div>
              <div><dt>model</dt><dd>gpt-5.6</dd></div>
              <div><dt>tools</dt><dd>reported by harness</dd></div>
              <div><dt>storage</dt><dd>local</dd></div>
            </dl>
          </div>
        </section>

        <section className="agents-section section-wrap" id="agents" aria-labelledby="agents-title">
          <div className="section-intro section-intro-compact">
            <p className="section-kicker">YOUR HARNESS, YOUR CHOICE</p>
            <h2 id="agents-title">Bring the agent. Keep its strengths.</h2>
            <p>
              Backchat discovers or installs ACP-compatible harnesses from Settings, then
              keeps their setup separate from the conversation itself.
            </p>
          </div>
          <div className="agent-table" role="table" aria-label="Supported agents">
            <div className="agent-table-head" role="row">
              <span role="columnheader">Agent</span>
              <span role="columnheader">ACP entry</span>
              <span role="columnheader">Connection</span>
            </div>
            {agents.map((agent) => (
              <div className="agent-table-row" role="row" key={agent.name}>
                <strong role="cell">{agent.name}</strong>
                <code role="cell">{agent.entry}</code>
                <span role="cell">{agent.detail}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="local-section section-wrap" aria-labelledby="local-title">
          <div className="local-mark" aria-hidden="true">
            <LockKeyhole size={24} />
          </div>
          <div>
            <p className="section-kicker">LOCAL-FIRST BY DEFAULT</p>
            <h2 id="local-title">Your workspace stays yours.</h2>
          </div>
          <p>
            Prompts, transcripts, projects, schedules, and app state live on your machine.
            The agent you choose remains responsible for its own model connection.
          </p>
          <div className="local-paths" aria-label="Local Backchat files">
            <code>~/.oma/config.toml</code>
            <code>~/.oma/sessions.db</code>
          </div>
        </section>

        <section className="download-section section-wrap" id="download" aria-labelledby="download-title">
          <div className="download-icon" aria-hidden="true">
            <Laptop size={27} />
          </div>
          <p className="section-kicker">DESKTOP PREVIEW</p>
          <h2 id="download-title">Bring your agents into one quiet room.</h2>
          <p>
            Backchat is pre-release and under active development. Download the current
            macOS build, or package a native Windows or Linux build on your own machine.
          </p>
          <div className="download-actions">
            <a className="button button-primary" href={macBuildsUrl}>
              <Download aria-hidden="true" size={17} />
              Download latest build
            </a>
            <a className="text-link" href={`${githubUrl}#quick-start`}>
              Build from source <ArrowRight aria-hidden="true" size={15} />
            </a>
          </div>
          <p className="download-meta">macOS · Apple Silicon · v0.0.3</p>

          <div className="build-runbooks" id="build-runbooks" aria-labelledby="build-runbooks-title">
            <div className="runbook-intro">
              <div>
                <p className="section-kicker">WINDOWS + LINUX</p>
                <h3 id="build-runbooks-title">Package Backchat where you will run it.</h3>
              </div>
              <p>
                Choose the recipe for your operating system. Each one builds Backchat
                from source and creates a native, unsigned installer on that machine.
              </p>
            </div>

            <div className="runbook-grid">
              {packageRunbooks.map((runbook) => (
                <article
                  className="runbook-card"
                  aria-label={`${runbook.platform} packaging runbook`}
                  key={runbook.platform}
                >
                  <header className="runbook-card-header">
                    <div>
                      <span className="runbook-platform">{runbook.platform}</span>
                      <h4>{runbook.target}</h4>
                    </div>
                    <span className="runbook-terminal">{runbook.terminal}</span>
                  </header>

                  <ol className="runbook-steps">
                    <li>
                      <span>01</span>
                      <div><strong>Prepare</strong><p>{runbook.requirements}</p></div>
                    </li>
                    <li>
                      <span>02</span>
                      <div><strong>Build</strong><p>Run the complete command block below.</p></div>
                    </li>
                    <li>
                      <span>03</span>
                      <div><strong>Collect</strong><p><code>{runbook.output}</code></p></div>
                    </li>
                  </ol>

                  <div className="runbook-command-wrap">
                    <span>{runbook.terminal}</span>
                    <pre className="runbook-command" tabIndex={0} aria-label={`${runbook.platform} packaging commands`}>
                      <code>{runbook.commands}</code>
                    </pre>
                  </div>
                </article>
              ))}
            </div>

            <p className="runbook-note">
              Package on the target operating system. If a native dependency falls back
              to compilation, install that platform&apos;s standard C/C++ build tools and retry.
            </p>
          </div>
        </section>
      </main>

      <footer className="site-footer section-wrap">
        <BrandLockup />
        <p>A calm, local-first desktop workspace for ACP agents.</p>
        <div className="footer-links">
          <a href={githubUrl}>GitHub</a>
          <a href="https://agentclientprotocol.com/">Agent Client Protocol</a>
          <a href={`${githubUrl}/issues`}>Issues</a>
        </div>
      </footer>
    </div>
  );
}
