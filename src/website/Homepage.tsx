import {
  ArrowRight,
  Blocks,
  Check,
  ChevronRight,
  Download,
  FolderGit2,
  Globe,
  GitFork,
  Laptop,
  Puzzle,
  TerminalSquare,
  UsersRound,
} from "lucide-react";
import homeScreenshotUrl from "../../artifacts/theme-system/default-spec-v1.png";
import activityScreenshotUrl from "../../artifacts/activity-states/06-complete-expanded.png";
import pipScreenshotUrl from "../../artifacts/interactive-containers/03-picture-in-picture.png";
import { BrandLockup } from "./BrandLockup";
import { homepageCopy } from "./homepage-copy";
import { alternateLocale, localePath, type SiteLocale } from "./site";

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

export function Homepage({ locale = "en" }: { locale?: SiteLocale }) {
  const copy = homepageCopy[locale];
  const homeUrl = localePath(locale, "/");
  const deepSeekUrl = localePath(locale, "/deepseek/");
  const languageUrl = localePath(alternateLocale(locale), "/");

  return (
    <div className="site-shell" id="top">
      <a className="skip-link" href="#main-content">
        {copy.skip}
      </a>

      <header className="site-header">
        <div className="site-header-inner">
          <a className="brand-link" href={homeUrl} aria-label={copy.homeLabel}>
            <BrandLockup />
          </a>
          <nav className="primary-nav" aria-label={copy.navLabel}>
            <a href="#product">{copy.nav.product}</a>
            <a href="#agents">{copy.nav.agents}</a>
            <a href="#download">{copy.nav.download}</a>
            <a className="language-link" href={languageUrl} hrefLang={alternateLocale(locale)}>
              {copy.nav.language}
            </a>
            <a className="nav-github" href={githubUrl} target="_blank" rel="noreferrer" aria-label="Backchat on GitHub">
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
            href={deepSeekUrl}
          >
            <span>{copy.announcementBadge}</span>
            {copy.announcement}
            <ChevronRight aria-hidden="true" size={14} />
          </a>

          <div className="hero-copy">
            <p className="eyebrow">{copy.eyebrow}</p>
            <h1 id="hero-title" aria-label={copy.heroTitle}>
              {copy.heroTitleLines.map((line) => (
                <span className="hero-title-line" key={line}>{line}</span>
              ))}
            </h1>
            <p className="hero-lede">{copy.heroLede}</p>
            <div className="hero-actions">
              <a className="button button-primary" href={macBuildsUrl}>
                <Download aria-hidden="true" size={17} />
                <span>{copy.downloadMac}</span>
              </a>
              <a className="button button-secondary" href={githubUrl}>
                <span>{copy.viewGithub}</span>
                <ArrowRight aria-hidden="true" size={16} />
              </a>
            </div>
            <p className="hero-meta">
              {copy.heroMeta.map((item, index) => (
                <span key={item}>{index > 0 && <span aria-hidden="true">· </span>}{item}</span>
              ))}
            </p>
          </div>

          <div className="hero-product" aria-label={copy.heroPreviewLabel}>
            <ProductFrame
              src={homeScreenshotUrl}
              alt={copy.heroImageAlt}
              label="Backchat / New chat"
              className="product-frame-hero"
            />
            <p className="image-caption">
              {copy.heroCaption}
            </p>
          </div>
        </section>

        <section className="agent-cloud section-wrap" aria-labelledby="agent-cloud-title">
          <p id="agent-cloud-title">{copy.agentCloud}</p>
          <ul aria-label="Supported agent harnesses">
            {agents.map((agent) => (
              <li key={agent.name}>{agent.name}</li>
            ))}
          </ul>
        </section>

        <section className="product-section section-wrap" id="product" aria-labelledby="product-title">
          <div className="section-intro">
            <p className="section-kicker">{copy.productKicker}</p>
            <h2 id="product-title">{copy.productTitle}</h2>
            <p>{copy.productLede}</p>
          </div>

          <article className="story-row">
            <div className="story-copy">
              <span className="story-index">01</span>
              <h3>{copy.storyOneTitle}</h3>
              <p>{copy.storyOneBody}</p>
              <ul className="check-list">
                {copy.storyOneChecks.map((item) => (
                  <li key={item}><Check aria-hidden="true" size={15} /><span>{item}</span></li>
                ))}
              </ul>
            </div>
            <ProductFrame
              src={activityScreenshotUrl}
              alt={copy.storyOneAlt}
              label="Backchat / Activity"
            />
          </article>

          <article className="story-row story-row-reverse">
            <div className="story-copy">
              <span className="story-index">02</span>
              <h3>{copy.storyTwoTitle}</h3>
              <p>{copy.storyTwoBody}</p>
              <div className="capability-list" aria-label={copy.capabilitiesLabel}>
                <span><UsersRound aria-hidden="true" size={16} /><span>{copy.capabilities[0]}</span></span>
                <span><Globe aria-hidden="true" size={16} /><span>{copy.capabilities[1]}</span></span>
                <span><FolderGit2 aria-hidden="true" size={16} /><span>{copy.capabilities[2]}</span></span>
                <span><TerminalSquare aria-hidden="true" size={16} /><span>{copy.capabilities[3]}</span></span>
                <span><Blocks aria-hidden="true" size={16} /><span>{copy.capabilities[4]}</span></span>
                <span><Puzzle aria-hidden="true" size={16} /><span>{copy.capabilities[5]}</span></span>
              </div>
            </div>
            <ProductFrame
              src={pipScreenshotUrl}
              alt={copy.storyTwoAlt}
              label="Backchat / Outputs"
              className="product-frame-dark"
            />
          </article>
        </section>

        <section className="truth-section section-wrap" aria-labelledby="truth-title">
          <div className="truth-copy">
            <p className="section-kicker">{copy.truthKicker}</p>
            <h2 id="truth-title">{copy.truthTitle}</h2>
            <p>{copy.truthBody}</p>
          </div>
          <div className="truth-terminal" aria-label={copy.truthLabel}>
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
            <p className="section-kicker">{copy.agentsKicker}</p>
            <h2 id="agents-title">{copy.agentsTitle}</h2>
            <p>{copy.agentsBody}</p>
          </div>
          <div className="agent-table" role="table" aria-label={copy.agentsTableLabel}>
            <div className="agent-table-head" role="row">
              {copy.columns.map((column) => <span role="columnheader" key={column}>{column}</span>)}
            </div>
            {agents.map((agent, index) => (
              <div className="agent-table-row" role="row" key={agent.name}>
                <strong role="cell">
                  {agent.name === "DeepSeek Harness" ? <a href={deepSeekUrl}>{agent.name}</a> : agent.name}
                </strong>
                <code role="cell">{agent.entry}</code>
                <span role="cell">{copy.agentDetails[index]}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="local-section section-wrap" aria-labelledby="native-title">
          <div className="local-mark" aria-hidden="true">
            <Blocks size={24} />
          </div>
          <div>
            <p className="section-kicker">{copy.nativeKicker}</p>
            <h2 id="native-title">{copy.nativeTitle}</h2>
          </div>
          <p>{copy.nativeBody}</p>
          <div className="local-paths" aria-label={copy.nativeItemsLabel}>
            {copy.nativeItems.map((item) => <span key={item}>{item}</span>)}
          </div>
        </section>

        <section className="download-section section-wrap" id="download" aria-labelledby="download-title">
          <div className="download-icon" aria-hidden="true">
            <Laptop size={27} />
          </div>
          <p className="section-kicker">{copy.downloadKicker}</p>
          <h2 id="download-title">{copy.downloadTitle}</h2>
          <p>{copy.downloadBody}</p>
          <div className="download-actions">
            <a className="button button-primary" href={macBuildsUrl}>
              <Download aria-hidden="true" size={17} />
              <span>{copy.downloadLatest}</span>
            </a>
            <a className="text-link" href={`${githubUrl}#quick-start`}>
              <span>{copy.buildSource}</span><ArrowRight aria-hidden="true" size={15} />
            </a>
          </div>
          <p className="download-meta">macOS · Apple Silicon · v0.0.3</p>

          <div className="build-runbooks" id="build-runbooks" aria-labelledby="build-runbooks-title">
            <div className="runbook-intro">
              <div>
                <p className="section-kicker">{copy.runbookKicker}</p>
                <h3 id="build-runbooks-title">{copy.runbookTitle}</h3>
              </div>
              <p>{copy.runbookBody}</p>
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
                      <div><strong>{copy.prepare}</strong><p>{runbook.platform === "Windows" ? copy.windowsRequirements : copy.linuxRequirements}</p></div>
                    </li>
                    <li>
                      <span>02</span>
                      <div><strong>{copy.build}</strong><p>{copy.buildInstruction}</p></div>
                    </li>
                    <li>
                      <span>03</span>
                      <div><strong>{copy.collect}</strong><p><code>{runbook.output}</code></p></div>
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
              {copy.runbookNote}
            </p>
          </div>
        </section>
      </main>

      <footer className="site-footer section-wrap">
        <BrandLockup />
        <p>{copy.footer}</p>
        <div className="footer-links">
          <a href={deepSeekUrl}>{copy.deepSeekGuide}</a>
          <a href={githubUrl}>GitHub</a>
          <a href="https://agentclientprotocol.com/">Agent Client Protocol</a>
          <a href={`${githubUrl}/issues`}>Issues</a>
        </div>
      </footer>
    </div>
  );
}
