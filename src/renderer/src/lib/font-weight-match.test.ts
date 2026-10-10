import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { declaredWeightFaces, matchFontWeight, type FontWeightFace } from "./font-weight-match";

const face = (weight: number): FontWeightFace => ({ min: weight, max: weight });

describe("matchFontWeight", () => {
  it("returns null when the family has no faces", () => {
    expect(matchFontWeight(430, [])).toBeNull();
  });

  it("uses a face whose range already contains the request", () => {
    const variable = [{ min: 100, max: 900 }];
    expect(matchFontWeight(430, variable)).toBe(variable[0]);
    expect(matchFontWeight(600, variable)).toBe(variable[0]);
  });

  it("picks PingFang Medium for 430 when 500 exists, and Regular when it does not", () => {
    expect(matchFontWeight(430, [face(400), face(500), face(600)])?.min).toBe(500);
    expect(matchFontWeight(430, [face(400), face(600)])?.min).toBe(400);
    expect(matchFontWeight(600, [face(400), face(600)])?.min).toBe(600);
  });

  it("orders several faces inside one search bucket", () => {
    expect(matchFontWeight(430, [face(480), face(450), face(200), face(410), face(700), face(900)])?.min).toBe(450);
    expect(matchFontWeight(250, [face(100), face(200), face(800), face(900)])?.min).toBe(200);
    expect(matchFontWeight(800, [face(100), face(200), face(700), face(900), face(950)])?.min).toBe(900);
  });

  it("checks lighter faces before heavier ones below 400, and heavier ones first above 500", () => {
    expect(matchFontWeight(300, [face(200), face(400), face(700)])?.min).toBe(200);
    expect(matchFontWeight(300, [face(400), face(700)])?.min).toBe(400);
    expect(matchFontWeight(650, [face(400), face(600), face(700)])?.min).toBe(700);
    expect(matchFontWeight(500, [face(400), face(600)])?.min).toBe(400);
  });
});

describe("declared Backchat faces", () => {
  const css = readFileSync(fileURLToPath(new URL("../styles/index.css", import.meta.url)), "utf8");

  it("hides PingFang Medium so resting 430 stays on Regular", () => {
    const faces = declaredWeightFaces(css, "Backchat PingFang");
    expect(faces.map((item) => item.min)).toEqual([400, 600]);
    expect(matchFontWeight(430, faces)?.min).toBe(400);
    expect(matchFontWeight(600, faces)?.min).toBe(600);
  });

  it("keeps Noto Sans SC at 400 and 600 so 430 does not jump to the heavier file", () => {
    const faces = declaredWeightFaces(css, "Backchat Sans SC");
    expect(faces).toEqual([
      { min: 400, max: 400 },
      { min: 600, max: 600 },
    ]);
    expect(matchFontWeight(430, faces)?.min).toBe(400);
    expect(matchFontWeight(600, faces)?.min).toBe(600);
  });

  it("lets the variable Latin face draw 430 and 600", () => {
    const faces = declaredWeightFaces(css, "Backchat Sans");
    expect(faces.every((item) => item.min === 100 && item.max === 900)).toBe(true);
    expect(matchFontWeight(430, faces)?.max).toBe(900);
  });

  it("ignores other families and a block without a weight", () => {
    const cssWithGap = `${css}\n@font-face { font-family: "Backchat PingFang"; font-style: normal; }`;
    expect(declaredWeightFaces(cssWithGap, "Backchat PingFang").map((item) => item.min)).toEqual([400, 600]);
    expect(declaredWeightFaces(css, "Missing Family")).toEqual([]);
  });
});
