/** World System Teletext 8-color palette (plan §5.7). Indices match WST alpha/mosaic codes. */
export const TELETEXT_COLOR_NAMES = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
] as const;

export type TeletextColorName = (typeof TELETEXT_COLOR_NAMES)[number];

export const TeletextColor = {
  black: 0,
  red: 1,
  green: 2,
  yellow: 3,
  blue: 4,
  magenta: 5,
  cyan: 6,
  white: 7,
} as const;

export type TeletextColor = (typeof TeletextColor)[keyof typeof TeletextColor];

/** Fully saturated RGB, 0..255. The raster CRT pass supplies the analog look. */
export const TELETEXT_RGB: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [255, 0, 0],
  [0, 255, 0],
  [255, 255, 0],
  [0, 0, 255],
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 255],
];

export function isTeletextColor(n: number): n is TeletextColor {
  return n >= 0 && n <= 7 && Number.isInteger(n);
}
