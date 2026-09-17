import { describe, it, expect, vi } from 'vitest';
import { QuitCoordinator } from './quit-coordinator.js';

describe('desktop quit', () => {
  it('cancels without terminating anything, and allows a later confirmed quit', async () => {
    let approved = false;
    const effects: string[] = [];
    const quit = new QuitCoordinator({ needsConfirmation: () => true, confirm: async () => approved,
      dispose: async () => { effects.push('disposed'); }, quit: () => { effects.push('quit'); } });
    expect(quit.request()).toBe(false);
    await vi.waitFor(() => expect(quit.pending).toBe(false));
    expect(effects).toEqual([]);
    approved = true; quit.request();
    await vi.waitFor(() => expect(effects).toEqual(['disposed', 'quit']));
    expect(quit.request()).toBe(true);
  });
  it('deduplicates repeated quit requests while asking and while shutting down', async () => {
    let answer!: (approved: boolean) => void;
    let disposed!: () => void;
    const effects: string[] = [];
    const quit = new QuitCoordinator({ needsConfirmation: () => true,
      confirm: () => { effects.push('ask'); return new Promise(resolve => { answer = resolve; }); },
      dispose: () => { effects.push('dispose'); return new Promise(resolve => { disposed = resolve; }); },
      quit: () => { effects.push('quit'); } });
    quit.request(); quit.request();
    expect(effects).toEqual(['ask']);
    answer(true); await vi.waitFor(() => expect(effects).toEqual(['ask', 'dispose']));
    expect(quit.request()).toBe(false);
    disposed(); await vi.waitFor(() => expect(effects).toEqual(['ask', 'dispose', 'quit']));
  });
  it('exits without a dialog when no local host exists, even if cleanup fails', async () => {
    const effects: string[] = [];
    const quit = new QuitCoordinator({ needsConfirmation: () => false,
      confirm: async () => { throw new Error('unexpected dialog'); },
      dispose: async () => { effects.push('dispose'); throw new Error('already closed'); },
      quit: () => { effects.push('quit'); } });
    quit.request();
    await vi.waitFor(() => expect(effects).toEqual(['dispose', 'quit']));
  });
});
