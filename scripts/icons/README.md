# Backchat icon geometry

Run `python3 scripts/icons/build.py` from the repository. The script generates
the React components and the standalone SVG gallery from the same definitions.

- 24 × 24 viewBox; all interface icons use 1.75-unit centerline strokes; rounded caps and joins.
- Sidebar primary glyphs render at 16px. Expand controls retain their smaller size.
- Full silhouettes normally use centerlines within 3–21. Optical exceptions
  are permitted; all strokes must remain inside the canvas.
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
Compose preserves its open frame and a 45-degree pencil; agent orchestration retains the original symmetric tree with three equal
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
