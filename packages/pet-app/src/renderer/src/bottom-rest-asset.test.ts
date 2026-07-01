import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { BOTTOM_REST_SIZE } from "../../shared/pet-size-model";

describe("bottom rest asset", () => {
  it("keeps every animation frame the same size and bottom aligned", () => {
    const png = readRgbaPng(join(__dirname, "assets/mote-bottom-peek-strip.png"));
    const frameCount = 4;
    expect(png.width).toBe(BOTTOM_REST_SIZE.width * frameCount);
    expect(png.height).toBe(BOTTOM_REST_SIZE.height);

    const bboxes = Array.from({ length: frameCount }, (_value, frame) =>
      alphaBBox(png, frame * BOTTOM_REST_SIZE.width, BOTTOM_REST_SIZE.width),
    );
    expect(bboxes.every((bbox) => bbox?.bottom === BOTTOM_REST_SIZE.height)).toBe(true);
    expect(new Set(bboxes.map((bbox) => JSON.stringify(bbox)))).toEqual(
      new Set([JSON.stringify({ left: 10, right: 101, bottom: 72 })]),
    );
  });
});

function alphaBBox(png: DecodedPng, offsetX: number, width: number): { left: number; right: number; bottom: number } | null {
  let left = width;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = png.data[((y * png.width + offsetX + x) * 4) + 3];
      if (alpha === 0) continue;
      left = Math.min(left, x);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
    }
  }
  return right === 0 ? null : { left, right, bottom };
}

type DecodedPng = {
  width: number;
  height: number;
  data: Buffer;
};

function readRgbaPng(path: string): DecodedPng {
  const bytes = readFileSync(path);
  let offset = 8;
  let width = 0;
  let height = 0;
  const chunks: Buffer[] = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect(data[8]).toBe(8);
      expect(data[9]).toBe(6);
    }
    if (type === "IDAT") chunks.push(data);
    offset += 12 + length;
  }
  const inflated = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const rgba = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const src = y * (stride + 1);
    const filter = inflated[src] ?? 0;
    const row = Buffer.from(inflated.subarray(src + 1, src + 1 + stride));
    const previous = y === 0 ? null : rgba.subarray((y - 1) * stride, y * stride);
    unfilterRow(row, previous, filter, 4);
    row.copy(rgba, y * stride);
  }
  return { width, height, data: rgba };
}

function unfilterRow(row: Buffer, previous: Buffer | null, filter: number, bytesPerPixel: number): void {
  for (let i = 0; i < row.length; i += 1) {
    const value = row[i] ?? 0;
    const left = i >= bytesPerPixel ? row[i - bytesPerPixel] ?? 0 : 0;
    const up = previous ? previous[i] ?? 0 : 0;
    const upperLeft = previous && i >= bytesPerPixel ? previous[i - bytesPerPixel] ?? 0 : 0;
    if (filter === 1) row[i] = (value + left) & 0xff;
    else if (filter === 2) row[i] = (value + up) & 0xff;
    else if (filter === 3) row[i] = (value + Math.floor((left + up) / 2)) & 0xff;
    else if (filter === 4) row[i] = (value + paeth(left, up, upperLeft)) & 0xff;
    else expect(filter).toBe(0);
  }
}

function paeth(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
}
