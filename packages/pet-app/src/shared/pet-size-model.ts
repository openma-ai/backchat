export type PetSize = {
  width: number;
  height: number;
};

export const ATLAS_CELL_SIZE = { width: 96, height: 104 } as const satisfies PetSize;
export const NORMAL_WINDOW_SIZE = { width: 112, height: 128 } as const satisfies PetSize;
export const SIDE_PEEK_SIZE = { width: 48, height: 112 } as const satisfies PetSize;
export const TOP_PEEK_SIZE = { width: 112, height: 72 } as const satisfies PetSize;
export const BOTTOM_REST_SIZE = { width: 112, height: 72 } as const satisfies PetSize;
export const BOTTOM_SCREEN_WINDOW_SIZE = NORMAL_WINDOW_SIZE;
export const BOTTOM_REST_SCREEN_EDGE_OVERHANG = 8;

export const BOTTOM_REST_SOURCE_FRAME = BOTTOM_REST_SIZE;
export const EDGE_PEEK_SOURCE_FRAME = { width: 96, height: 128 } as const satisfies PetSize;
export const BOTTOM_REST_RENDER_FRAME = BOTTOM_REST_SIZE;

export function centeredInset(container: PetSize, content: PetSize): { x: number; y: number } {
  return {
    x: (container.width - content.width) / 2,
    y: (container.height - content.height) / 2,
  };
}

export function atlasOffsetForWindow(windowSize: PetSize): { x: number; y: number } {
  const normalInset = centeredInset(NORMAL_WINDOW_SIZE, ATLAS_CELL_SIZE);
  const localInset = centeredInset(windowSize, ATLAS_CELL_SIZE);
  return {
    x: normalInset.x - localInset.x,
    y: normalInset.y - localInset.y,
  };
}
