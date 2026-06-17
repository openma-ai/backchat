import {
  ATLAS_CELL_SIZE,
  BOTTOM_REST_RENDER_FRAME,
  BOTTOM_REST_SCREEN_EDGE_OVERHANG,
  BOTTOM_REST_SIZE,
  NORMAL_WINDOW_SIZE,
  SIDE_PEEK_SIZE,
  TOP_PEEK_SIZE,
  atlasOffsetForWindow,
} from "../../shared/pet-size-model";

export function cssSizeVars(): Record<string, string> {
  return {
    "--pet-window-width": px(NORMAL_WINDOW_SIZE.width),
    "--pet-window-height": px(NORMAL_WINDOW_SIZE.height),
    "--pet-atlas-cell-width": px(ATLAS_CELL_SIZE.width),
    "--pet-atlas-cell-height": px(ATLAS_CELL_SIZE.height),
    "--pet-side-peek-width": px(SIDE_PEEK_SIZE.width),
    "--pet-side-peek-height": px(SIDE_PEEK_SIZE.height),
    "--pet-top-peek-width": px(TOP_PEEK_SIZE.width),
    "--pet-top-peek-height": px(TOP_PEEK_SIZE.height),
    "--pet-bottom-rest-width": px(BOTTOM_REST_SIZE.width),
    "--pet-bottom-rest-height": px(BOTTOM_REST_SIZE.height),
    "--pet-bottom-rest-frame-width": px(BOTTOM_REST_RENDER_FRAME.width),
    "--pet-bottom-rest-frame-height": px(BOTTOM_REST_RENDER_FRAME.height),
    "--pet-bottom-rest-screen-overhang": px(BOTTOM_REST_SCREEN_EDGE_OVERHANG),
    "--pet-top-atlas-offset-x": px(atlasOffsetForWindow(TOP_PEEK_SIZE).x),
    "--pet-top-atlas-offset-y": px(atlasOffsetForWindow(TOP_PEEK_SIZE).y),
    "--pet-bottom-atlas-offset-x": px(atlasOffsetForWindow(BOTTOM_REST_SIZE).x),
    "--pet-bottom-atlas-offset-y": px(atlasOffsetForWindow(BOTTOM_REST_SIZE).y),
  };
}

function px(value: number): string {
  return `${value}px`;
}
