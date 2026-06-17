#!/usr/bin/env python3
"""Build a fixed-size bottom-rest strip from source art.

This mirrors hatch-pet's deterministic stable-slot extraction idea: split a row
strip into slots, remove a chroma-key background, compute a shared scale, paste
each frame into an identical viewport, and keep the opaque bottom pixel on the
frame bottom so bottom rests can actually touch the edge.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def parse_offsets(value: str) -> list[int]:
    return [int(part.strip()) for part in value.split(",") if part.strip()]


def build_strip(source: Path, output: Path, frame_width: int, frame_height: int, offsets: list[int], chroma: tuple[int, int, int]) -> None:
    image = Image.open(source).convert("RGBA")
    frames = extract_keyed_frames(image, len(offsets), chroma)
    bboxes = [frame.getchannel("A").getbbox() for frame in frames]
    if any(bbox is None for bbox in bboxes):
        raise SystemExit(f"{source} has an empty bottom-rest frame")
    max_width = max(bbox[2] - bbox[0] for bbox in bboxes if bbox)
    max_height = max(bbox[3] - bbox[1] for bbox in bboxes if bbox)
    scale = min(frame_width / max_width, frame_height / max_height)

    strip = Image.new("RGBA", (frame_width * len(offsets), frame_height), (0, 0, 0, 0))
    for index, (frame_source, bbox, dx) in enumerate(zip(frames, bboxes, offsets)):
        assert bbox is not None
        sprite = frame_source.crop(bbox)
        sprite = sprite.resize(
            (max(1, round(sprite.width * scale)), max(1, round(sprite.height * scale))),
            Image.Resampling.LANCZOS,
        )
        frame = Image.new("RGBA", (frame_width, frame_height), (0, 0, 0, 0))
        x = (frame_width - sprite.width) // 2 + dx
        y = frame_height - sprite.height
        frame.alpha_composite(sprite, (x, y))
        strip.alpha_composite(frame, (index * frame_width, 0))

    output.parent.mkdir(parents=True, exist_ok=True)
    strip.save(output)


def extract_keyed_frames(image: Image.Image, frame_count: int, chroma: tuple[int, int, int]) -> list[Image.Image]:
    if image.width / image.height < frame_count * 0.75:
        keyed = remove_chroma(image, chroma)
        return [keyed.copy() for _ in range(frame_count)]

    slot_width = image.width / frame_count
    frames = []
    for index in range(frame_count):
        left = round(index * slot_width)
        right = round((index + 1) * slot_width)
        frame = image.crop((left, 0, right, image.height))
        frames.append(remove_chroma(frame, chroma))
    return frames


def remove_chroma(image: Image.Image, chroma: tuple[int, int, int]) -> Image.Image:
    image = image.convert("RGBA")
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha and color_distance((red, green, blue), chroma) <= 72:
                pixels[x, y] = (0, 0, 0, 0)
    return image


def color_distance(color: tuple[int, int, int], target: tuple[int, int, int]) -> float:
    return sum((channel - target_channel) ** 2 for channel, target_channel in zip(color, target)) ** 0.5


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--frame-width", type=int, default=112)
    parser.add_argument("--frame-height", type=int, default=72)
    parser.add_argument("--offsets", default="0,1,-1,0")
    parser.add_argument("--chroma", default="255,0,255")
    args = parser.parse_args()

    build_strip(
        Path(args.source).expanduser().resolve(),
        Path(args.output).expanduser().resolve(),
        args.frame_width,
        args.frame_height,
        parse_offsets(args.offsets),
        tuple(parse_offsets(args.chroma)),
    )


if __name__ == "__main__":
    main()
