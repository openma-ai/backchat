import { describe, expect, it } from "vitest";
import { cssSizeVars } from "./pet-size-model";

describe("renderer pet size model", () => {
  it("exports size variables from the same first-principles model", () => {
    expect(cssSizeVars()).toEqual({
      "--pet-window-width": "112px",
      "--pet-window-height": "128px",
      "--pet-atlas-cell-width": "96px",
      "--pet-atlas-cell-height": "104px",
      "--pet-side-peek-width": "48px",
      "--pet-side-peek-height": "128px",
      "--pet-top-peek-width": "112px",
      "--pet-top-peek-height": "72px",
      "--pet-bottom-rest-width": "112px",
      "--pet-bottom-rest-height": "72px",
      "--pet-bottom-rest-frame-width": "112px",
      "--pet-bottom-rest-frame-height": "72px",
      "--pet-bottom-rest-screen-overhang": "8px",
      "--pet-top-atlas-offset-x": "0px",
      "--pet-top-atlas-offset-y": "28px",
      "--pet-bottom-atlas-offset-x": "0px",
      "--pet-bottom-atlas-offset-y": "28px",
    });
  });
});
