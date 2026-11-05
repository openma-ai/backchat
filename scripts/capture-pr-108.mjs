/**
 * Evidence capture for PR #108 — Codex terminal provider errors in feed,
 * soft reconnect notice-only, clear sticky error after later success.
 * Locale: zh-CN, theme: light. Branch: fix/codex-provider-error-fail-turn.
 */
import { _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const repoRoot = "/workspace/bc-fix-codex-provider-err";
const outDir = "/workspace/pr-evidence/pr-108";
const mainJs = join(repoRoot, "out/main/index.js");

const AUTH_MSG =
  "auth_unavailable: no auth available (providers=devin, model=devin/gpt-6-1-sol)";
const SOFT_MSG = "upstream connect timeout, retrying";

function oma(partial) {
  return {
    schema: "oma.event.v1",
    occurred_at: new Date().toISOString(),
    source: { kind: "harness", harness: "codex-acp", adapter: "codex" },
    ...partial,
  };
}

async function waitReady(page) {
  await page.waitForFunction(
    () => typeof window.backchat?.settingsGet === "function",
    undefined,
    { timeout: 60_000 },
  );
  await page.getByTestId("new-chat-button").waitFor({ timeout: 20_000 });
  await page.evaluate(async () => {
    const current = await window.backchat.settingsGet();
    await window.backchat.settingsPatch({
      appearance: { ...current.appearance, language: "zh-CN", theme: "light" },
    });
  });
}

async function enableAgent(page) {
  await page.evaluate(async () => {
    const current = await window.backchat.settingsGet();
    await window.backchat.settingsPatch({
      agents: [{ id: "codex-acp", enabled: true, env: [] }],
      default: { ...current.default, agent_id: "codex-acp" },
    });
  });
}

async function closeOverlays(page) {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(100);
  // Auth setup / dialog close
  const closeBtn = page.getByRole("button", { name: /^(关闭|Close)$/ });
  if (await closeBtn.first().isVisible().catch(() => false)) {
    await closeBtn.first().click().catch(() => {});
    await page.waitForTimeout(150);
  }
  await page.keyboard.press("Escape").catch(() => {});
}

async function openSession(page, sessionId, agentId = "codex-acp", cwd = "") {
  await closeOverlays(page);
  const expand = page.getByRole("button", { name: /Expand sidebar|展开侧栏/ });
  if (await expand.isVisible().catch(() => false)) {
    await expand.click();
    await page.waitForTimeout(300);
  }
  const label = `${agentId} · ${sessionId.slice(0, 6)}`;
  let sessionButton = page.getByRole("button", { name: label });
  if (!(await sessionButton.isVisible().catch(() => false))) {
    // Expand project group for this cwd basename when known
    if (cwd) {
      const base = cwd.split("/").filter(Boolean).pop();
      const projectButton = page
        .getByRole("complementary")
        .locator("[data-sidebar-project]")
        .filter({ hasText: base })
        .locator("button[aria-expanded]")
        .first();
      if (await projectButton.count()) {
        if ((await projectButton.getAttribute("aria-expanded")) !== "true") {
          await projectButton.click().catch(() => {});
          await page.waitForTimeout(200);
        }
      }
    }
    // Expand any remaining collapsed project groups
    const projects = page.locator("[data-sidebar-project] button[aria-expanded]");
    const n = await projects.count();
    for (let i = 0; i < n; i++) {
      const btn = projects.nth(i);
      if ((await btn.getAttribute("aria-expanded")) !== "true") {
        await btn.click().catch(() => {});
      }
    }
    await page.waitForTimeout(200);
  }
  await closeOverlays(page);
  sessionButton = page.getByRole("button", { name: label });
  if (!(await sessionButton.isVisible().catch(() => false))) {
    // Last resort: any button whose accessible name contains the id prefix
    sessionButton = page.getByRole("button", { name: new RegExp(sessionId.slice(0, 6)) });
  }
  await sessionButton.first().click({ timeout: 15_000, force: true });
  await page.waitForTimeout(500);
  await closeOverlays(page);
}

async function startTurn(page, sessionId, turnId, promptText) {
  await page.evaluate(
    async ({ sessionId, turnId, promptText }) => {
      await window.__backchatTest.injectSessionEvent({
        type: "session.prompt",
        session_id: sessionId,
        turn_id: turnId,
        text: promptText,
      });
      await window.__backchatTest.injectSessionEvent({
        type: "session.queue_update",
        session_id: sessionId,
        mode: "single",
        active_turn_id: turnId,
        queued: [],
      });
      await window.__backchatTest.injectSessionEvent({
        type: "session.event",
        session_id: sessionId,
        turn_id: turnId,
        event: {
          sessionUpdate: "agent_thought_chunk",
          messageId: `${turnId}-thought`,
          content: { type: "text", text: "思考中…" },
        },
      });
    },
    { sessionId, turnId, promptText },
  );
}

async function redBox(page, selector, id = "ev-108-redbox") {
  await page.evaluate(
    ({ selector, id }) => {
      document.getElementById(id)?.remove();
      const el = document.querySelector(selector);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const box = document.createElement("div");
      box.id = id;
      Object.assign(box.style, {
        position: "fixed",
        left: `${r.left - 4}px`,
        top: `${r.top - 4}px`,
        width: `${r.width + 8}px`,
        height: `${r.height + 8}px`,
        border: "2px solid #e11",
        borderRadius: "6px",
        pointerEvents: "none",
        zIndex: "99999",
      });
      document.body.appendChild(box);
    },
    { selector, id },
  );
}

async function clearRedBox(page, id = "ev-108-redbox") {
  await page.evaluate((id) => document.getElementById(id)?.remove(), id);
}

async function labelBadge(page, text) {
  await page.evaluate((text) => {
    document.getElementById("ev-108-badge")?.remove();
    const badge = document.createElement("div");
    badge.id = "ev-108-badge";
    Object.assign(badge.style, {
      position: "fixed",
      top: "10px",
      right: "12px",
      zIndex: "100000",
      background: "#111",
      color: "#fff",
      font: "12px/1.3 ui-sans-serif, system-ui, sans-serif",
      padding: "6px 10px",
      borderRadius: "6px",
      maxWidth: "360px",
    });
    badge.textContent = text;
    document.body.appendChild(badge);
  }, text);
}

async function dumpDiag(page, tag) {
  const diag = await page.evaluate(() => {
    const err = document.querySelector(
      '[data-session-turn-status-message="error"], [data-turn-error-fallback="true"]',
    );
    const notice = document.querySelector('[data-testid="composer-notice"]');
    const thinking = document.querySelector('[data-thinking-fallback="true"]');
    return {
      errText: err?.textContent?.slice(0, 200) ?? null,
      errAttrs: err
        ? {
            status: err.getAttribute("data-session-turn-status-message"),
            fallback: err.getAttribute("data-turn-error-fallback"),
            tone: err.getAttribute("data-tone"),
            appearance: err.getAttribute("data-appearance"),
          }
        : null,
      noticeText: notice?.textContent?.slice(0, 200) ?? null,
      thinking: Boolean(thinking),
      bodySnippet: document.body?.innerText?.slice(0, 400) ?? "",
    };
  });
  console.log(`[diag ${tag}]`, JSON.stringify(diag, null, 2));
  return diag;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const home = await mkdtemp(join(tmpdir(), "bc-ev-108-"));
  const app = await electron.launch({
    args: [
      "--no-sandbox",
      "--disable-gpu",
      "--ozone-platform=x11",
      mainJs,
      `--user-data-dir=${join(home, "electron-user-data")}`,
    ],
    env: {
      ...process.env,
      BACKCHAT_HOME: home,
      BACKCHAT_TEST_HOOKS: "1",
      BACKCHAT_E2E_VISIBLE: "1",
      BACKCHAT_E2E_SKIP_AGENT_WARMUP: "1",
      NODE_ENV: "test",
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    },
  });

  const notes = [];
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 800 });
    await waitReady(page);
    await enableAgent(page);

    // ========== Shot 1: terminal feed error ==========
    {
      const sessionId = "term108a";
      const turnId = "turn-k9zrwrcu";
      await page.evaluate(async ({ sessionId }) => {
        await window.__backchatTest.injectSessionRow({
          session_id: sessionId,
          agent_id: "codex-acp",
          cwd: "/tmp/term108a",
        });
      }, { sessionId });
      await openSession(page, sessionId, "codex-acp", "/tmp/term108a");
      await startTurn(page, sessionId, turnId, "查一下额度为什么挂了");

      // Canonical session.error as main would emit after inspectCodexProviderError
      // on a sess-yof701gi-shaped session_info_update (willRetry + auth_unavailable).
      await page.evaluate(
        async ({ sessionId, AUTH_MSG }) => {
          await window.__backchatTest.injectSessionEvent({
            type: "session.event",
            session_id: sessionId,
            turn_id: "",
            event: { sessionUpdate: "session_info_update" },
            openma_event: {
              schema: "oma.event.v1",
              occurred_at: new Date().toISOString(),
              source: { kind: "harness", harness: "codex-acp", adapter: "codex" },
              event_id: "codex-provider-failure",
              type: "session.error",
              session_id: sessionId,
              turn_id: "",
              data: {
                message: AUTH_MSG,
                code: "auth_required",
                provider_error: {
                  message: "Reconnecting... 2/5",
                  willRetry: true,
                },
              },
            },
          });
        },
        { sessionId, AUTH_MSG },
      );

      const errSel =
        `[data-turn-id="${turnId}"] [data-turn-error-fallback="true"],` +
        `[data-turn-id="${turnId}"] [data-session-turn-status-message="error"]`;
      await page.locator(errSel).first().waitFor({ state: "visible", timeout: 15_000 });
      await closeOverlays(page);
      await page.waitForTimeout(300);
      // Ensure error row still visible after closing auth setup
      await page.locator(errSel).first().waitFor({ state: "visible", timeout: 5_000 });
      await dumpDiag(page, "terminal");
      await labelBadge(
        page,
        "① terminal: feed 红条（非卡住「思考中」、非 toast-only）",
      );
      await redBox(page, errSel.split(",")[0].trim());
      await page.screenshot({
        path: join(outDir, "108-terminal-feed-error.png"),
        fullPage: false,
      });
      notes.push("108-terminal-feed-error.png OK");
      await clearRedBox(page);
    }

    // ========== Shot 2: soft reconnect — notice only ==========
    {
      const sessionId = "soft108b";
      const turnId = "turn-soft-retry";
      await page.evaluate(async ({ sessionId }) => {
        await window.__backchatTest.injectSessionRow({
          session_id: sessionId,
          agent_id: "codex-acp",
          cwd: "/tmp/soft108b",
        });
      }, { sessionId });
      await closeOverlays(page);
      await openSession(page, sessionId, "codex-acp", "/tmp/soft108b");
      await startTurn(page, sessionId, turnId, "软重连场景：继续跑");

      await page.evaluate(
        async ({ sessionId, SOFT_MSG }) => {
          await window.__backchatTest.injectSessionEvent({
            type: "session.event",
            session_id: sessionId,
            turn_id: "",
            event: { sessionUpdate: "session_info_update" },
            openma_event: {
              schema: "oma.event.v1",
              schema_version: "oma.event.v1",
              occurred_at: new Date().toISOString(),
              source: { kind: "harness", harness: "codex-acp", adapter: "codex" },
              event_id: "codex-soft-retry",
              type: "session.running",
              session_id: sessionId,
              turn_id: "",
              data: {
                retrying: true,
                message: SOFT_MSG,
                provider_error: {
                  message: "Reconnecting... 1/5",
                  willRetry: true,
                },
              },
            },
          });
        },
        { sessionId, SOFT_MSG },
      );

      // Belt-and-suspenders: system.notice uses the same #showNotice path
      await page.evaluate(
        async ({ sessionId, SOFT_MSG }) => {
          await window.__backchatTest.injectSessionEvent({
            type: "session.event",
            session_id: sessionId,
            turn_id: "",
            event: { sessionUpdate: "session_info_update" },
            openma_event: {
              schema: "oma.event.v1",
              schema_version: "oma.event.v1",
              occurred_at: new Date().toISOString(),
              source: { kind: "harness", harness: "codex-acp", adapter: "codex" },
              event_id: "codex-soft-notice",
              type: "system.notice",
              session_id: sessionId,
              turn_id: "",
              data: { message: SOFT_MSG },
            },
          });
        },
        { sessionId, SOFT_MSG },
      );

      // Prefer composer-notice; fall back to any StatusNotice with the soft copy.
      const softAppeared = await page.waitForFunction(
        (msg) => {
          const notice = document.querySelector('[data-testid="composer-notice"]');
          if (notice && (notice.textContent || "").includes(msg)) return "composer-notice";
          const nodes = [...document.querySelectorAll("[data-slot=status-notice], [data-tone]")];
          const hit = nodes.find((n) => (n.textContent || "").includes(msg));
          return hit ? "status-notice" : null;
        },
        SOFT_MSG,
        { timeout: 10_000 },
      ).catch(async (err) => {
        const store = await page.evaluate((sessionId) => {
          // Best-effort: expose nothing; scrape DOM + text
          return {
            body: document.body?.innerText?.slice(0, 800),
            notices: [...document.querySelectorAll("[data-testid], [data-slot]")].slice(0, 40).map((el) => ({
              testid: el.getAttribute("data-testid"),
              slot: el.getAttribute("data-slot"),
              tone: el.getAttribute("data-tone"),
              text: (el.textContent || "").slice(0, 120),
            })),
          };
        }, sessionId);
        console.log("[soft miss]", JSON.stringify(store, null, 2));
        throw err;
      });
      console.log("[soft appeared via]", softAppeared);
      await page.waitForTimeout(400);

      // Assert no sticky feed error on this turn
      const stickyCount = await page
        .locator(
          `[data-turn-id="${turnId}"] [data-turn-error-fallback="true"],` +
            `[data-turn-id="${turnId}"] [data-session-turn-status-message="error"]`,
        )
        .count();
      if (stickyCount !== 0) {
        throw new Error(`soft reconnect unexpectedly has sticky feed error count=${stickyCount}`);
      }
      await dumpDiag(page, "soft");
      await page.evaluate(() => document.getElementById("ev-108-badge")?.remove());
      await labelBadge(
        page,
        "② soft reconnect: 仅 composer notice，无 sticky feed 红条",
      );
      await redBox(page, '[data-testid="composer-notice"]');
      await page.screenshot({
        path: join(outDir, "108-soft-reconnect-notice.png"),
        fullPage: false,
      });
      notes.push("108-soft-reconnect-notice.png OK");
      await clearRedBox(page);
    }

    // ========== Shot 3: cleared after later success ==========
    {
      const sessionId = "clear108c";
      const failTurn = "turn-sticky";
      const okTurn = "turn-retry-ok";
      await page.evaluate(async ({ sessionId }) => {
        await window.__backchatTest.injectSessionRow({
          session_id: sessionId,
          agent_id: "codex-acp",
          cwd: "/tmp/clear108c",
        });
      }, { sessionId });
      await closeOverlays(page);
      await openSession(page, sessionId, "codex-acp", "/tmp/clear108c");
      await startTurn(page, sessionId, failTurn, "第一轮：会失败");

      await page.evaluate(
        async ({ sessionId, failTurn, AUTH_MSG }) => {
          await window.__backchatTest.injectSessionEvent({
            type: "session.error",
            session_id: sessionId,
            turn_id: failTurn,
            message: AUTH_MSG,
            code: "auth_required",
            agent_id: "codex-acp",
          });
        },
        { sessionId, failTurn, AUTH_MSG },
      );

      await page
        .locator(
          `[data-turn-id="${failTurn}"] [data-turn-error-fallback="true"],` +
            `[data-turn-id="${failTurn}"] [data-session-turn-status-message="error"]`,
        )
        .first()
        .waitFor({ state: "visible", timeout: 15_000 });

      // Later successful turn
      await startTurn(page, sessionId, okTurn, "第二轮：成功");
      await page.evaluate(
        async ({ sessionId, okTurn }) => {
          await window.__backchatTest.injectSessionEvent({
            type: "session.event",
            session_id: sessionId,
            turn_id: okTurn,
            event: {
              sessionUpdate: "agent_message_chunk",
              messageId: `${okTurn}-msg`,
              content: { type: "text", text: "搞定了，额度已恢复。" },
            },
          });
          await window.__backchatTest.injectSessionEvent({
            type: "session.complete",
            session_id: sessionId,
            turn_id: okTurn,
          });
        },
        { sessionId, okTurn },
      );

      // Cleared sticky shell must leave the feed entirely (no empty husk).
      await page.waitForFunction(
        ({ failTurn, okTurn }) => {
          const failRoot = document.querySelector(`[data-turn-id="${failTurn}"]`);
          const okRoot = document.querySelector(`[data-turn-id="${okTurn}"]`);
          return !failRoot && !!okRoot;
        },
        { failTurn, okTurn },
        { timeout: 15_000 },
      );
      await closeOverlays(page);
      await page.waitForTimeout(300);
      await dumpDiag(page, "cleared");
      const leftover = await page.locator(`[data-turn-id="${failTurn}"]`).count();
      if (leftover !== 0) {
        throw new Error(`cleared sticky shell still mounted count=${leftover}`);
      }
      await page.evaluate(() => document.getElementById("ev-108-badge")?.remove());
      await labelBadge(
        page,
        "③ 后续成功后：sticky 红条与空 husk 均已让出空间",
      );
      // Highlight the remaining success turn — failed shell must be gone.
      await page.evaluate((okTurn) => {
        document.getElementById("ev-108-redbox")?.remove();
        const root = document.querySelector(`[data-turn-id="${okTurn}"]`);
        if (!root) return;
        const r = root.getBoundingClientRect();
        const box = document.createElement("div");
        box.id = "ev-108-redbox";
        Object.assign(box.style, {
          position: "fixed",
          left: `${r.left - 4}px`,
          top: `${r.top - 4}px`,
          width: `${r.width + 8}px`,
          height: `${Math.min(r.height, 280) + 8}px`,
          border: "2px solid #16a34a",
          borderRadius: "6px",
          pointerEvents: "none",
          zIndex: "99999",
        });
        document.body.appendChild(box);
      }, okTurn);
      await page.screenshot({
        path: join(outDir, "108-cleared-after-success.png"),
        fullPage: false,
      });
      notes.push("108-cleared-after-success.png OK");
      await clearRedBox(page);
    }

    await writeFile(join(outDir, "NOTES.txt"), notes.join("\n") + "\n", "utf8");
    console.log("DONE", notes);
  } finally {
    await app.close().catch(() => {});
    await rm(home, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
