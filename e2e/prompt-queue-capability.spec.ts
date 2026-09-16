import { expect, test } from './fixtures';
import { injectEvent, injectSession } from './helpers';

for (const supportsSteering of [false, true]) {
  test(`global queue off keeps pending rows visible (steering=${supportsSteering})`, async ({ page }) => {
    const sessionId = await injectSession(page, { agentId: 'claude-acp', supportsSteering });
    await injectEvent(page, {
      type: 'session.queue_update', session_id: sessionId, mode: 'single',
      active_turn_id: 'turn-active',
      queued: [{ turn_id: 'turn-pending', text: 'Keep this pending message visible', created_at: 1 }],
    });
    const row = page.locator('[data-queued-turn-id="turn-pending"]');
    await expect(row).toBeVisible();
    await page.evaluate(async () => {
      const current = await window.backchat.settingsGet();
      await window.backchat.settingsPatch({ default: { ...current.default, prompt_queue_enabled: false } });
    });
    await expect.poll(() => page.evaluate(async () => (await window.backchat.settingsGet()).default.prompt_queue_enabled)).toBe(false);
    await expect(row).toBeVisible();
    await expect(row).toContainText('Keep this pending message visible');
    if (supportsSteering) await expect(row.locator('[data-queue-steer="true"]')).toBeVisible();
    else await expect(row.locator('[data-queue-steer="true"]')).toHaveCount(0);
  });
}
