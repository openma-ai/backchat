import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  ExternalLink,
  KeyRound,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import { BrandLockup } from "./BrandLockup";
import { deepSeekCopy } from "./deepseek-copy";
import { alternateLocale, localePath, type SiteLocale } from "./site";

const githubUrl = "https://github.com/openma-ai/backchat";
const adapterUrl = "https://github.com/openma-ai/deepseek-harness-acp";
const macBuildsUrl = `${githubUrl}/releases/download/preview/Backchat-preview-arm64.dmg`;
const standaloneCommands = `node --version
npm install -g @openma/deepseek-harness-acp
dsh-acp login`;
const profileCommands = `npm install -g @deepseek-ai/dsh
dsh web
dsh plugin --profile acp add -w @openma/deepseek-harness-acp`;

function CommandBlock({ label, children }: { label: string; children: string }) {
  return (
    <div className="guide-command-wrap">
      <span><TerminalSquare aria-hidden="true" size={13} /><span>{label}</span></span>
      <pre tabIndex={0}><code>{children}</code></pre>
    </div>
  );
}

export function DeepSeekGuide({ locale = "en" }: { locale?: SiteLocale }) {
  const copy = deepSeekCopy[locale];
  const homeUrl = localePath(locale, "/");
  const guideUrl = localePath(locale, "/deepseek/");
  const languageUrl = localePath(alternateLocale(locale), "/deepseek/");
  const sectionLinks = ["#install", "#authentication", "#profile", "#troubleshooting"];

  return (
    <div className="site-shell guide-page" id="top">
      <a className="skip-link" href="#guide-content">{copy.skip}</a>
      <header className="site-header">
        <div className="site-header-inner">
          <a className="brand-link" href={homeUrl} aria-label={copy.homeLabel}><BrandLockup /></a>
          <nav className="primary-nav" aria-label={copy.navLabel}>
            {copy.nav.map((label, index) => <a key={label} href={sectionLinks[index]}>{label}</a>)}
            <a className="language-link" href={languageUrl} hrefLang={alternateLocale(locale)}>{copy.language}</a>
            <a className="nav-github" href={adapterUrl} target="_blank" rel="noreferrer" aria-label="DeepSeek Harness on GitHub">
              <ExternalLink aria-hidden="true" size={15} /><span>GitHub</span>
            </a>
          </nav>
        </div>
      </header>

      <main id="guide-content">
        <section className="guide-hero section-wrap" aria-labelledby="guide-title">
          <nav className="guide-breadcrumb" aria-label="Breadcrumb">
            <a href={homeUrl}>{copy.breadcrumb[0]}</a><span>/</span><span>{copy.breadcrumb[1]}</span><span>/</span><span>{copy.breadcrumb[2]}</span>
          </nav>
          <p className="eyebrow">{copy.kicker}</p>
          <h1 id="guide-title">{copy.title}</h1>
          <p className="guide-lede">{copy.lede}</p>
          <div className="hero-actions">
            <a className="button button-primary" href={macBuildsUrl}><Download aria-hidden="true" size={17} /><span>{copy.openBackchat}</span></a>
            <a className="button button-secondary" href={adapterUrl} target="_blank" rel="noreferrer"><span>{copy.viewSource}</span><ExternalLink aria-hidden="true" size={15} /></a>
          </div>
          <ul className="guide-meta" aria-label="Guide requirements">
            {copy.meta.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>

        <div className="guide-layout section-wrap">
          <aside className="guide-toc" aria-label={copy.tocTitle}>
            <span>{copy.tocTitle}</span>
            {copy.nav.map((label, index) => <a key={label} href={sectionLinks[index]}>{label}</a>)}
          </aside>

          <article className="guide-content">
            <section className="guide-section" id="install" aria-labelledby="install-title">
              <p className="section-kicker">{copy.fastKicker}</p>
              <h2 id="install-title">{copy.fastTitle}</h2>
              <p className="guide-section-lede">{copy.fastIntro}</p>
              <ol className="guide-steps">
                {copy.fastSteps.map(([title, body], index) => (
                  <li key={title}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div><h3>{title}</h3><p>{body}</p></div>
                  </li>
                ))}
              </ol>
              <div className="guide-callout"><KeyRound aria-hidden="true" size={19} /><p>{copy.managedNote}</p></div>
            </section>

            <section className="guide-section" aria-labelledby="manual-title">
              <p className="section-kicker">{copy.manualKicker}</p>
              <h2 id="manual-title">{copy.manualTitle}</h2>
              <p className="guide-section-lede">{copy.manualBody}</p>
              <CommandBlock label={copy.commandLabel}>{standaloneCommands}</CommandBlock>
            </section>

            <section className="guide-section" id="authentication" aria-labelledby="auth-title">
              <p className="section-kicker">{copy.authKicker}</p>
              <h2 id="auth-title">{copy.authTitle}</h2>
              <p className="guide-section-lede">{copy.authBody}</p>
              <div className="guide-callout"><ShieldCheck aria-hidden="true" size={19} /><p>{copy.authFallback}</p></div>
            </section>

            <section className="guide-section" id="profile" aria-labelledby="profile-title">
              <p className="section-kicker">{copy.profileKicker}</p>
              <h2 id="profile-title">{copy.profileTitle}</h2>
              <p className="guide-section-lede">{copy.profileBody}</p>
              <CommandBlock label={copy.commandLabel}>{profileCommands}</CommandBlock>
              <h3 className="guide-subtitle">{copy.customAgentTitle}</h3>
              <dl className="guide-fields">
                {copy.customFields.map(([term, value]) => <div key={term}><dt>{term}</dt><dd><code>{value}</code></dd></div>)}
              </dl>
            </section>

            <section className="guide-section" aria-labelledby="verify-title">
              <p className="section-kicker">{copy.verifyKicker}</p>
              <h2 id="verify-title">{copy.verifyTitle}</h2>
              <ul className="guide-checks">
                {copy.features.map((item) => <li key={item}><Check aria-hidden="true" size={16} /><span>{item}</span></li>)}
              </ul>
              <p className="guide-permission-note">{copy.permissionNote}</p>
            </section>

            <section className="guide-section" id="troubleshooting" aria-labelledby="trouble-title">
              <p className="section-kicker">{copy.troubleKicker}</p>
              <h2 id="trouble-title">{copy.troubleTitle}</h2>
              <dl className="guide-trouble">
                {copy.trouble.map(([term, description]) => <div key={term}><dt>{term}</dt><dd>{description}</dd></div>)}
              </dl>
              <a className="text-link guide-help-link" href={`${adapterUrl}/issues`} target="_blank" rel="noreferrer"><span>{copy.repoHelp}</span><ArrowRight aria-hidden="true" size={15} /></a>
            </section>
          </article>
        </div>

        <section className="guide-cta section-wrap">
          <h2>{copy.ctaTitle}</h2><p>{copy.ctaBody}</p>
          <div className="hero-actions">
            <a className="button button-primary" href={macBuildsUrl}><Download aria-hidden="true" size={17} /><span>{copy.openBackchat}</span></a>
            <a className="text-link" href={homeUrl}><ArrowLeft aria-hidden="true" size={15} /><span>{copy.backHome}</span></a>
          </div>
        </section>
      </main>

      <footer className="site-footer section-wrap">
        <BrandLockup /><p>{copy.footer}</p>
        <div className="footer-links"><a href={homeUrl}>{copy.backHome}</a><a href={adapterUrl}>GitHub</a><a href="https://agentclientprotocol.com/">ACP</a></div>
      </footer>
    </div>
  );
}
