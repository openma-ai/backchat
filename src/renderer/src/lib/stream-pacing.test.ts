import { afterEach, describe, expect, it, vi } from "vitest";
import { createStreamTextPacer } from "@openma/common/agent-ui/react";

afterEach(() => vi.useRealTimers());
function setup() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const writes: string[] = [];
  const pacer = createStreamTextPacer({
    write: text => { writes.push(text); },
    schedule: (callback, delay) => setTimeout(callback, delay),
    cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  });
  return { pacer, writes };
}
describe("low-latency stream pacing", () => {
  it("renders the first short chunk immediately", () => {
    const { pacer, writes } = setup();
    pacer.enqueue("Hello 世界");
    expect(writes.join("")).toBe("Hello 世界");
    pacer.dispose();
  });
  it("drains a large burst within 800ms with frame batches and intact Unicode", () => {
    const { pacer, writes } = setup();
    const text = "Hello 👩🏽‍💻世界\n".repeat(500);
    pacer.enqueue(text);
    vi.advanceTimersByTime(800);
    expect(writes.join("")).toBe(text);
    expect(writes.length).toBeLessThanOrEqual(50);
    expect(writes.every(chunk => !/[\uD800-\uDBFF]$/.test(chunk))).toBe(true);
    pacer.dispose();
  });
  it("keeps up with continuous input without losing text", () => {
    const { pacer, writes } = setup();
    for (let i = 0; i < 100; i++) {
      pacer.enqueue("x".repeat(100));
      vi.advanceTimersByTime(5);
    }
    vi.advanceTimersByTime(800);
    expect(writes.join("")).toHaveLength(10000);
    expect(writes.length).toBeLessThan(85);
    pacer.dispose();
  });
  it("bounds changes in velocity and acceleration while a burst is queued", () => {
    const { pacer, writes } = setup();
    pacer.enqueue("x".repeat(20000));
    const batches: number[] = [];
    for (let frame = 0; frame < 12; frame++) {
      const before = writes.join("").length;
      vi.advanceTimersByTime(16);
      batches.push(writes.join("").length - before);
    }
    // At 16ms/frame, bound acceleration and jerk, allowing integer rounding.
    const differences = batches.slice(1).map((n, i) => n - batches[i]);
    expect(Math.max(...differences.map(Math.abs))).toBeLessThanOrEqual(66);
    const jerk = differences.slice(1).map((n, i) => n - differences[i]);
    expect(Math.max(...jerk.map(Math.abs))).toBeLessThanOrEqual(13);
    expect(batches.at(-1)).toBeGreaterThan(batches[0]);
    pacer.dispose();
  });

  it("retains acceleration across a second burst instead of restarting or jumping", () => {
    const { pacer, writes } = setup();
    pacer.enqueue("x".repeat(20000));
    const batches: number[] = [];
    for (let frame = 0; frame < 16; frame++) {
      if (frame === 8) pacer.enqueue("y".repeat(20000));
      const before = writes.join("").length;
      vi.advanceTimersByTime(16);
      batches.push(writes.join("").length - before);
    }
    const changes = batches.slice(1).map((n, i) => n - batches[i]);
    expect(Math.max(...changes.map(Math.abs))).toBeLessThanOrEqual(66);
    expect(Math.max(...changes.slice(1).map((n, i) => Math.abs(n - changes[i])))).toBeLessThanOrEqual(13);
    pacer.flush();
    expect(writes.join("")).toBe("x".repeat(20000) + "y".repeat(20000));
    pacer.dispose();
  });

  it("flushes immediately and cancels scheduled writes on disposal", () => {
    const { pacer, writes } = setup();
    pacer.enqueue("a".repeat(1000));
    pacer.flush();
    expect(writes.join("")).toHaveLength(1000);
    pacer.dispose();
    vi.runAllTimers();
    expect(writes.join("")).toHaveLength(1000);
  });
});
