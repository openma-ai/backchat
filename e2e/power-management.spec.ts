import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { expect, test } from './fixtures';

test('local native turns prevent idle sleep and release it after cancellation', async ({ app, page, home }) => {
  test.skip(process.platform !== 'darwin', 'Uses native macOS power assertions');
  const held = () => execFileSync('/usr/bin/pmset', ['-g', 'assertions'], { encoding: 'utf8' })
    .split('\n').some(line => line.includes(`pid ${app.process().pid}(`) && /PreventUserIdleSystemSleep|NoIdleSleepAssertion/.test(line));
  await expect.poll(held).toBe(false);
  const id = randomUUID();
  const result = await page.evaluate(async ({ node, agent, id, cwd }) => {
    await window.backchat.settingsPatch({ agents: [{ id: 'codex-acp', enabled: true, command_override: node, args_override: [agent], env: [] }] });
    return window.backchat.sessionStart({ session_id: id, agent_id: 'codex-acp', cwd });
  }, { node: process.execPath, agent: resolve('e2e/fixtures/fake-acp-agent.mjs'), id, cwd: home });
  expect(result.status).toBe('ready');
  await page.evaluate((id) => {
    void window.backchat.sessionPrompt({ session_id: id, turn_id: 'power-turn', text: 'stall-until-cancelled-e2e' });
  }, id);
  await expect.poll(held).toBe(true);
  await page.evaluate((id) => window.backchat.sessionCancel({ session_id: id, turn_id: 'power-turn' }), id);
  await expect.poll(held).toBe(false);
});
