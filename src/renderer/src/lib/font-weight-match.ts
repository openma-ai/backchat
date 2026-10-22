/** A face's declared weight. A single stop has min === max. A variable
 *  axis uses the inclusive range from the `font-weight` descriptor. */
export interface FontWeightFace {
  min: number;
  max: number;
}

/** CSS Fonts 4 §5.2 weight matching for one family.
 *  https://www.w3.org/TR/css-fonts-4/#font-style-matching-algorithm
 *
 *  A request between 400 and 500 checks 500 before any lighter face, so
 *  PingFang Medium (500) steals a 430 request from Regular (400). */
export function matchFontWeight(
  requested: number,
  faces: readonly FontWeightFace[],
): FontWeightFace | null {
  if (faces.length === 0) return null;
  const containing = faces.find((face) => requested >= face.min && requested <= face.max);
  if (containing) return containing;

  const order = candidateWeights(requested, faces.map((face) => face.min));
  return faces.find((face) => face.min === order[0]) as FontWeightFace;
}

function candidateWeights(requested: number, weights: readonly number[]): number[] {
  const unique = [...new Set(weights)];
  if (requested >= 400 && requested <= 500) {
    return [
      ...unique.filter((weight) => weight >= requested && weight <= 500).sort((a, b) => a - b),
      ...unique.filter((weight) => weight < requested).sort((a, b) => b - a),
      ...unique.filter((weight) => weight > 500).sort((a, b) => a - b),
    ];
  }
  if (requested < 400) {
    return [
      ...unique.filter((weight) => weight <= requested).sort((a, b) => b - a),
      ...unique.filter((weight) => weight > requested).sort((a, b) => a - b),
    ];
  }
  return [
    ...unique.filter((weight) => weight >= requested).sort((a, b) => a - b),
    ...unique.filter((weight) => weight < requested).sort((a, b) => b - a),
  ];
}

/** Read `font-weight` descriptors for one family out of the renderer CSS. */
export function declaredWeightFaces(css: string, family: string): FontWeightFace[] {
  const faces: FontWeightFace[] = [];
  const blocks = css.split("@font-face");
  for (const block of blocks.slice(1)) {
    const body = block.slice(0, block.indexOf("}"));
    const marker = ["font", "family"].join("-");
    const declared = new RegExp(`${marker}:\\s*"([^"]+)"`).exec(body);
    if (declared?.[1] !== family) continue;
    const weightMarker = ["font", "weight"].join("-");
    const weight = new RegExp(`${weightMarker}:\\s*([\\d.]+)(?:\\s+([\\d.]+))?`).exec(body);
    if (!weight?.[1]) continue;
    const min = Number(weight[1]);
    const max = weight[2] ? Number(weight[2]) : min;
    faces.push({ min, max });
  }
  return faces;
}
