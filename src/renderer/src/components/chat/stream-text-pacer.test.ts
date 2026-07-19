import { describe, expect, it, vi } from "vitest";

describe("stream text pacing", () => {
  it("reveals one Unicode character per scheduled tick", async () => {
    const module = await import("./stream-text-pacer").catch(() => null);
    expect(module).not.toBeNull();

    const scheduled: Array<() => void> = [];
    const write = vi.fn();
    const pacer = module!.createStreamTextPacer({
      write,
      schedule: (callback) => {
        scheduled.push(callback);
        return scheduled.length;
      },
      cancel: vi.fn(),
    });

    pacer.enqueue("你🙂好");
    expect(write).not.toHaveBeenCalled();

    scheduled.shift()?.();
    expect(write).toHaveBeenNthCalledWith(1, "你");

    scheduled.shift()?.();
    expect(write).toHaveBeenNthCalledWith(2, "🙂");

    scheduled.shift()?.();
    expect(write).toHaveBeenNthCalledWith(3, "好");
    expect(write).toHaveBeenCalledTimes(3);
  });
});
