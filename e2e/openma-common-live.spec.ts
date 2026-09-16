import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launchAppWithHome } from './helpers';

// Opt-in: requires a real local OpenMA API and a running shared-kernel worker.
// The token belongs to the isolated local acceptance workspace only.
const baseUrl = process.env.OPENMA_LIVE_BASE_URL;
const sessionId = process.env.OPENMA_LIVE_SESSION_ID;
const token = process.env.OPENMA_LIVE_TEST_TOKEN;
test('continues a real shared-kernel Work session in Backchat and preserves canonical history', async ({}, testInfo) => {
  test.skip(!baseUrl || !sessionId || !token, 'Requires the local Work acceptance service');
  test.setTimeout(120_000);
  const home = await mkdtemp(join(tmpdir(), 'backchat-common-live-'));
  const dir = join(home, 'backchat', 'openma');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'account.json'), JSON.stringify({ version: 2, base_url: baseUrl,
    user: { id: 'user-live', email: 'integration@localhost.test', name: 'Local Integration' }, active_tenant_id: 'tenant-live',
    tenants: { 'tenant-live': { name: 'Local Integration', role: 'owner', token, key_id: 'key-live', created_at: new Date().toISOString() } },
  }), { mode: 0o600 });
  let launched = await launchAppWithHome(home);
  const apiEvents = async () => {
    const response = await fetch(`${baseUrl}/v1/sessions/${sessionId}/events`, { headers: { 'x-api-key': token!, 'anthropic-beta': 'managed-agents-2026-04-01' } });
    expect(response.ok).toBe(true);
    return (await response.json()).data as Array<{ type: string; content?: Array<{ text?: string }> }>;
  };
  const marker = `BACKCHAT_COMMON_${Date.now()}_OK`;
  const text = `Reply exactly ${marker}. Do not use tools.`;
  try {
    const tasks = await launched.page.evaluate(() => window.backchat.openmaTasksRefresh());
    const task = tasks.find(task => task.sessionId === sessionId);
    expect(task).toBeDefined();
    // Give this session a unique label; previous acceptance runs may coexist.
    await launched.page.evaluate(({ id, title }) => window.backchat.openmaTaskUpdate(id, { title }), { id: task!.id, title: marker });
    await launched.page.reload();
    const group = launched.page.getByRole('button', { name: 'Local Integration', exact: true });
    await expect(group).toHaveAttribute('aria-expanded', 'false');
    await group.click();
    await launched.page.getByText(marker, { exact: true }).first().click();
    await expect(launched.page.getByText(/COMMON_KERNEL_FIRST_OK/).last()).toBeVisible();
    await launched.page.locator('textarea').fill(text);
    await launched.page.locator('textarea').press('Enter');
    await expect.poll(async () => (await apiEvents()).filter(event => event.type === 'agent.message').some(event => event.content?.some(part => part.text?.includes(marker))), { timeout: 75_000 }).toBe(true);
    await expect(launched.page.getByText(marker, { exact: true }).last()).toBeVisible();
    await expect.poll(async () => {
      const snapshot = await launched.page.evaluate(id => window.backchat.openmaTaskOpen(id, 'live-assertion'), task!.id);
      return snapshot.events.some(event => event.type === 'agent.message' && JSON.stringify(event.content).includes(marker));
    }).toBe(true);
    const events = await apiEvents();
    expect(events.filter(event => event.type === 'user.message' && event.content?.some(part => part.text === text))).toHaveLength(1);
    await launched.page.screenshot({ path: testInfo.outputPath('common-desktop.png') });
    await launched.app.close();
    launched = await launchAppWithHome(home);
    await launched.page.getByRole('button', { name: 'Local Integration', exact: true }).click();
    await launched.page.getByText(marker, { exact: true }).first().click();
    await expect(launched.page.getByText(marker, { exact: true }).last()).toBeVisible();
    expect((await apiEvents()).filter(event => event.type === 'user.message' && event.content?.some(part => part.text === text))).toHaveLength(1);
    await writeFile(testInfo.outputPath('common-acceptance.json'), JSON.stringify({ sessionId, marker, home, events, restored: true }, null, 2));
  } finally { await launched.app.close().catch(() => {}); }
});
