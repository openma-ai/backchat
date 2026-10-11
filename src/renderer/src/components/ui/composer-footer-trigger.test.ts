import { describe, expect, test } from "vitest";
import {
  composerFooterTriggerClass,
  composerFooterTriggerProps,
} from "./composer-footer-trigger";

describe("composer footer trigger", () => {
  test("uses the shared footer chip class", () => {
    expect(composerFooterTriggerClass("max-w-[180px]")).toContain(
      "composer-footer-trigger",
    );
    expect(composerFooterTriggerClass("max-w-[180px]")).toContain(
      "max-w-[180px]",
    );
  });

  test("supports the no-open-surface variant", () => {
    expect(composerFooterTriggerProps()).toEqual({
      "data-open-surface": undefined,
    });
    expect(composerFooterTriggerProps("filled")).toEqual({
      "data-open-surface": undefined,
    });
    expect(composerFooterTriggerProps("none")).toEqual({
      "data-open-surface": "none",
    });
  });
});
