export const CHAT_COMPOSER_FRAME_CLASS =
  "mx-auto w-full max-w-3xl min-w-0 px-4";

// The composer card sits inside CHAT_COMPOSER_FRAME_CLASS and uses
// rounded-2xl, which is a 16px corner radius. Turns need to stay inside
// the card's straight-edge safe line (card edge + radius), not merely
// inside the card's outer border box.
export const CHAT_TURN_FRAME_CLASS =
  "mx-auto w-full max-w-3xl min-w-0 px-8";

export const CHAT_GENERATED_IMAGE_CLASS =
  "block max-h-[400px] max-w-full h-auto rounded border border-border/40";
