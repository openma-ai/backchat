import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { expect, test } from './fixtures';

test('cancelling quit keeps a local agent alive; confirming quit stops the app', async ({ app, page, home }) => {
  const proc = app.process();
  const id = randomUUID();
  const ready = await page.evaluate(async ({ id, cwd, node, agent }) => {
    await window.backchat.settingsPatch({ agents: [{ id: 'codex-acp', enabled: true, command_override: node, args_override: [agent], env: [] }] });
    return window.backchat.sessionStart({ session_id: id, agent_id: 'codex-acp', cwd });
  }, { id, cwd: home, node: process.execPath, agent: resolve('e2e/fixtures/fake-acp-agent.mjs') });
  expect(ready.status).toBe('ready');
  await page.evaluate((id) => { void window.backchat.sessionPrompt({ session_id: id, turn_id: 'running', text: 'stall-until-cancelled-e2e' }); }, id);
  await expect.poll(() => page.evaluate((id) => window.backchat.sessionRuntimeStatus({ session_id: id }), id)).toMatchObject({ busy: true });
  await app.evaluate(({ app, dialog }) => {
    dialog.showMessageBox = async (options: any) => {
      (globalThis as any).quitDialog = options;
      return { response: 0, checkboxChecked: false };
    };
    app.quit();
  });
  await expect.poll(() => app.evaluate(() => (globalThis as any).quitDialog)).toMatchObject({
    defaultId: 0, cancelId: 0, buttons: ['Keep running', 'Stop tasks and quit'],
  });
  await expect.poll(() => page.evaluate((id) => window.backchat.sessionRuntimeStatus({ session_id: id }), id)).toMatchObject({ busy: true });
  await page.evaluate((id) => window.backchat.sessionCancel({ session_id: id, turn_id: 'running' }), id);
  // The native agent still handles input after the cancelled quit.
  await page.evaluate((id) => window.backchat.sessionPrompt({ session_id: id, turn_id: 'after-cancelled-quit', text: 'hello' }), id);
  expect(app.process().exitCode).toBeNull();
  const exited = app.waitForEvent('close');
  await app.evaluate(({ app, dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    setTimeout(() => app.quit(), 0);
  });
  await exited;
  await expect.poll(() => proc.exitCode).toBe(0);
});
