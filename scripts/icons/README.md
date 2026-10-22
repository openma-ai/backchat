# Backchat icon geometry

Run `python3 scripts/icons/build.py` from the repository. The script generates
the React components and the standalone SVG gallery from the same definitions.

## Design pattern (the rules every icon follows)

Calibrated against Linear's sidebar (measured 2026-10): its 14px glyphs use a
~1.05px stroke, equal to the 13px text stem, with soft ~2.25px outer corners.
Our text (SF Pro / PingFang 13px @430) has a ~1.1px stem, so the same ratio holds.

| Rule | Value | Why |
|---|---|---|
| Canvas | 24 × 24 viewBox | One grid for every glyph |
| Stroke | 1.75 centerline (= 1.02px at 14px) | Matches the text stem; never vary per icon |
| Caps / joins | round / round | Same terminal feel as the text |
| Open ends | the cap's outer edge lands on the guide, so the centerline stops half a stroke (0.875) short | A centerline on the guide overshoots it |
| Container corners | centerline radius **3** for parts ≥ 12 units, **2** for 6–11, **1** below (`corner()` in build.py) | Soft corners; Phosphor-style tight corners read harsher |
| Keylines | square 3–21, circle r 9, landscape 3–21 × 4–20, portrait 4–20 × 3–21 (centerlines) | Optical balance; exceptions allowed, strokes stay inside the canvas |
| Angles | 45° / 30° multiples | Consistent diagonals |
| Small dots | filled discs r 1.25 (never stroked rings) | Avoid subpixel counters |
| Filled exceptions | only dots and tapered nibs (compose) | A taper cannot be expressed with one stroke width |
| Counters | ≥ 3 units of open space | Must survive 14px |
| Weight | one weight only; state is shown by color, never by fill | "Color earns its place" |
| Sizes | sidebar / menus 14px; toolbars 16px | Driven by CSS tokens, never by per-call `size-*` classes |

## Adopting an icon from another library (Phosphor, Lucide)

Libraries are metaphor references, not runtime dependencies. To adopt one:

1. Take the Phosphor **regular** outline. Its strokes are 16 units on a 256
   grid, so each centerline is the midpoint of the outer and inner contours
   (e.g. outer radius 32 + inner radius 16 -> centerline radius 24).
2. Divide by 10.667 to land on the 24 grid, then snap to the keylines above.
3. Re-apply our corner rule and dot rule; drop details that merge at 14px.
4. Add it to build.py with `P` / `C` / `R` / `dot`, regenerate, and review it
   at 14 / 16 / 24px next to 13px text before wiring it into `Icons.tsx`.
5. Phosphor and Lucide are MIT: keep their copyright notice in the
   third-party licenses when a glyph is derived from their geometry.

Mechanical conversion (thickening or rounding the published outlines) does not
work: rounding by erode/dilate erases strokes thinner than the corner radius.
Always re-trace centerlines.

## Geometry notes

- Search joins the circle on the exact 45° radius.
- Project cube uses a regular hexagon, with three equal isometric faces.
- Settings uses two sliders with equal circular knobs; never mix gear and slider variants for the same action.
- Schedule uses one open circular return arrow with a 4-unit radius and a 3-unit head, preserving negative space at 16px.
- Database tiers use identical ellipse radii.
- Small dots are filled discs, avoiding subpixel counters.
- Folder states share the backplate and baseline.
- Inspect the generated gallery at 16/20/24/40px. Geometry consistency does
  not itself prove optical balance. The remaining legacy shapes still need
  individual optical review; never normalize every shape to identical bounds.

The gallery is written to artifacts/icons/preview.html.

Primary navigation geometry review: `artifacts/icons/rebuilt.html`.
Compose follows Linear: a frame open at the top-right whose round caps (outer edge, not centerline) stop on the x12 / y12 guides plus a filled 45° pencil: the midpoint of its taper sits on the icon center (12,12), where the two gap lines (x12 / y12) cross, round end at the frame's outer top-right corner, uniform body 2.0 wide (slightly heavier than the 1.75 frame) and a 2.0-unit curved (ogive) taper — no visible shoulder — ending in a rounded r0.3 tip — thinner reads as a needle, a shorter taper as a chisel, a sharp tip as a spike; agent orchestration retains the original symmetric tree with three equal
2-unit nodes. No traced
Recraft outlines are used.

## Application integration

`src/renderer/src/components/Icons.tsx` is the UI icon entry point. Approved
custom geometry takes priority; secondary Lucide glyphs are retained with the
same 1.75-unit stroke. These secondary glyphs are library assets, not generated
originals. Keep agent/provider brand marks separate. Do not import icon libraries
from individual controls. Reuse compose for every New Chat action.

`ProjectIcon` owns project imagery (manual choice, transparent repository image,
then deterministic glyph). Sidebar, project picker and settings share this
component and `project:<id>` preference identity. Saved project lists use
`useProjects`; historical working directories are explicitly Recent folders.

## Runtime and resource family

Server, review-open/merged/closed, shield/ask/check/restricted, file/text,
browser, panel-left/right/top and globe complete the runtime/resource group.
Review states use distinct geometry as well as the existing text labels; permission
icons share one shield contour. Arrow/check/close utility glyphs retain the library
implementation. Concept generation used built-in imagegen; final SVGs are analytic
centerlines, transparent by construction, never raster images embedded in SVG.
