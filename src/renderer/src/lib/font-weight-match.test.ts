import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { declaredWeightFaces, matchFontWeight, type FontWeightFace } from "./font-weight-match";

const face = (weight: number): FontWeightFace => ({ min: weight, max: weight });

function faceSrc(css: string, family: string, weight: number): string | null {
  for (const block of css.split("@font-face").slice(1)) {
    const body = block.slice(0, block.indexOf("}"));
    if (!body.includes(`font-family: "${family}"`)) continue;
    const declared = /font-weight:\s*(\d+)/.exec(body);
    if (Number(declared?.[1]) !== weight) continue;
    return /src:\s*([^;]+);/.exec(body)?.[1] ?? "";
  }
  return null;
}

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

  it("pins resting 430 to Regular and keeps Medium for a 500 request", () => {
    const faces = declaredWeightFaces(css, "Backchat PingFang");
    expect(faces.map((item) => item.min)).toEqual([400, 430, 500, 600]);
    expect(matchFontWeight(430, faces)?.min).toBe(430);
    expect(matchFontWeight(500, faces)?.min).toBe(500);
    expect(matchFontWeight(600, faces)?.min).toBe(600);
  });

  it("gives Noto Sans SC a real 500 face and keeps 430 on the regular file", () => {
    const faces = declaredWeightFaces(css, "Backchat Sans SC");
    expect(faces).toEqual([
      { min: 400, max: 400 },
      { min: 430, max: 430 },
      { min: 500, max: 500 },
      { min: 600, max: 600 },
    ]);
    expect(matchFontWeight(430, faces)?.min).toBe(430);
    expect(matchFontWeight(500, faces)?.min).toBe(500);
    expect(matchFontWeight(600, faces)?.min).toBe(600);
  });

  it("keeps YaHei 500 on Regular and maps only 600 to Bold", () => {
    const faces = declaredWeightFaces(css, "Backchat YaHei");
    expect(faces.map((item) => item.min)).toEqual([400, 430, 600]);
    expect(matchFontWeight(430, faces)?.min).toBe(430);
    expect(matchFontWeight(500, faces)?.min).toBe(430);
    expect(matchFontWeight(600, faces)?.min).toBe(600);
    expect(faceSrc(css, "Backchat YaHei", 400)).toContain('local("Microsoft YaHei Regular")');
    expect(faceSrc(css, "Backchat YaHei", 430)).toContain('local("Microsoft YaHei Regular")');
    expect(faceSrc(css, "Backchat YaHei", 430)).not.toContain("Bold");
    expect(faceSrc(css, "Backchat YaHei", 500)).toBeNull();
    expect(faceSrc(css, "Backchat YaHei", 600)).toContain('local("Microsoft YaHei Bold")');
  });

  it("requests 400 on macOS so a missed PingFang local() stays Regular", () => {
    const mapped = declaredWeightFaces(css, "Backchat PingFang");
    expect(mapped.map((item) => item.min)).toEqual([400, 430, 500, 600]);
    expect(matchFontWeight(430, mapped)?.min).toBe(430);
    const unmapped = [100, 200, 300, 400, 500, 600].map(face);
    expect(matchFontWeight(400, unmapped)?.min).toBe(400);
    expect(matchFontWeight(430, unmapped)?.min).toBe(500);
    const mac = css.slice(css.indexOf('html[data-os="mac"] {'), css.indexOf("/* Chat prose"));
    expect(mac).toContain("--font-ui-weight: 400;");
    expect(mac).not.toContain("font-variation-settings");
    expect(css).not.toContain("font-variation-settings");
  });

  it("lets the variable Latin face draw 430 and 600", () => {
    const faces = declaredWeightFaces(css, "Backchat Sans");
    expect(faces.every((item) => item.min === 100 && item.max === 900)).toBe(true);
    expect(matchFontWeight(430, faces)?.max).toBe(900);
  });

  it("ignores other families and a block without a weight", () => {
    const cssWithGap = `${css}\n@font-face { font-family: "Backchat PingFang"; font-style: normal; }`;
    expect(declaredWeightFaces(cssWithGap, "Backchat PingFang").map((item) => item.min)).toEqual([400, 430, 500, 600]);
    expect(declaredWeightFaces(css, "Missing Family")).toEqual([]);
  });
});
