import { EventEmitter } from 'node:events';
import { describe, it, expect, vi } from 'vitest';
import { DesktopPowerManagement } from './power-management.js';

function fixture() {
  const active = new Set<number>();
  let serial = 0;
  const monitor = new EventEmitter();
  const resume = vi.fn();
  const power = new DesktopPowerManagement({
    blocker: {
      start(type) { expect(type).toBe('prevent-app-suspension'); active.add(++serial); return serial; },
      stop(id) { active.delete(id); },
    }, monitor, onResume: resume,
  });
  const queue = (id: string, activeTurn: string | null, steering: string[] = []) => power.handleSessionEvent({
    type: 'session.queue_update', session_id: id, mode: 'single', active_turn_id: activeTurn,
    queued: [], steering_turn_ids: steering,
  });
  return { power, active, monitor, resume, queue };
}

describe('automatic desktop power management', () => {
  it('does not fail local work when the OS refuses a power assertion, and retries on wake', () => {
    const active = new Set<number>();
    const monitor = new EventEmitter();
    let unavailable = true;
    const errors: unknown[] = [];
    const power = new DesktopPowerManagement({
      blocker: { start() { if (unavailable) throw new Error('OS unavailable'); active.add(1); return 1; }, stop(id) { active.delete(id); } },
      monitor, onResume() {}, onError(error) { errors.push(error); },
    });
    expect(() => power.setRunner({ enabled: true, hosting: 'backchat' })).not.toThrow();
    expect(errors).toHaveLength(1);
    unavailable = false; monitor.emit('resume');
    expect(active.size).toBe(1);
    power.dispose();
    expect(active.size).toBe(0);
  });
  it('releases a replaced or closed session and a failed restart, but not a recoverable turn error', () => {
    let exists = true;
    const active = new Set<number>();
    const power = new DesktopPowerManagement({
      blocker: { start() { active.add(1); return 1; }, stop(id) { active.delete(id); } },
      monitor: new EventEmitter(), onResume() {}, sessionExists: () => exists,
    });
    const start = () => power.handleSessionEvent({ type: 'session.queue_update', session_id: 's', mode: 'single', active_turn_id: 't', queued: [] });
    start();
    power.handleSessionEvent({ type: 'session.error', session_id: 's', message: 'recoverable' });
    expect(active.size).toBe(1);
    power.handleSessionEvent({ type: 'session.restarted', session_id: 's' });
    expect(active.size).toBe(0);
    start(); exists = false;
    power.handleSessionEvent({ type: 'session.error', session_id: 's', message: 'restart failed' });
    expect(active.size).toBe(0);
    start();
    power.handleSessionEvent({ type: 'session.event', session_id: 's', turn_id: '', event: {}, openma_event: { type: 'session.terminated' } } as any);
    expect(active.size).toBe(0);
    power.dispose();
  });

  it('holds one assertion until every local turn including steering has settled', () => {
    const f = fixture();
    expect(f.active.size).toBe(0);
    f.queue('a', 'turn'); f.queue('b', null, ['steer']); f.queue('a', 'turn');
    expect(f.active.size).toBe(1);
    // Cancellation is a request, not evidence the native turn ended.
    f.power.handleSessionEvent({ type: 'session.cancel_requested', session_id: 'a', turn_id: 'turn' });
    f.queue('b', null);
    expect(f.active.size).toBe(1);
    f.queue('a', null);
    expect(f.active.size).toBe(0);
    f.power.dispose();
  });
  it('automatically keeps a hosted runner awake through network loss, releases on disable', () => {
    const f = fixture();
    f.power.setRunner({ enabled: true, hosting: 'backchat' });
    f.power.setRunner({ enabled: true, hosting: 'backchat' });
    expect(f.active.size).toBe(1);
    f.queue('local', 'turn');
    f.power.setRunner({ enabled: false, hosting: null });
    expect(f.active.size).toBe(1);
    f.power.handleSessionEvent({ type: 'session.disposed', session_id: 'local' });
    expect(f.active.size).toBe(0);
    f.power.setRunner({ enabled: true, hosting: 'external' });
    expect(f.active.size).toBe(0);
    f.power.dispose();
  });
  it('recovers on wake and releases assertions/listeners at shutdown without reacquiring', () => {
    const f = fixture();
    f.queue('local', 'turn'); f.monitor.emit('resume');
    expect(f.resume).toHaveBeenCalledTimes(1);
    f.power.dispose(); f.power.dispose();
    f.monitor.emit('resume'); f.queue('late', 'turn');
    expect(f.resume).toHaveBeenCalledTimes(1);
    expect(f.active.size).toBe(0);
    expect(f.monitor.listenerCount('resume')).toBe(0);
  });
});
