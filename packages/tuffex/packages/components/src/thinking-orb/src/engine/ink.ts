// TuffEx addition — not part of upstream thinking-orbs. Upstream inks every
// mark in grey and mirrors it on dark substrates; this module keeps that
// path byte-for-byte and adds a colour ramp for `variant="gradient"`.
//
// The ramp runs left → right across the frame, so a dot's hue follows its
// projected position and shifts as the orb turns. Depth stays where upstream
// put it — in the ink value — so a far dot still recedes and a near one still
// comes forward; only the hue is new.
//
// On dark substrates a mark keeps upstream's grey lightness and takes the hue
// at that lightness: the nearest marks stay close to white, the farther ones
// carry the colour. On paper the nearest marks carry the deepened hue and the
// far ones fade toward the paper.

export type Rgb = readonly [number, number, number];

export interface Ink {
  /** Dark substrate: the ink is mirrored so near marks read bright. */
  dark: boolean;
  /** Gradient stops, left → right. Empty = upstream's grey ink. */
  ramp: readonly Rgb[];
  /** CSS-px frame width the ramp is laid across. */
  size: number;
}

/** Share of the frame the ramp covers, centred — the orb never reaches the edges. */
const RAMP_SPAN = 0.8;
/** Dark substrates: hue strength on the nearest marks… */
const TINT_NEAR = 0.15;
/** …and on the farthest. */
const TINT_FAR = 0.85;
/** Light substrates: hues are deepened so the nearest marks hold contrast on paper. */
const DEEPEN = 0.86;

export function monoInk(dark: boolean): Ink {
  return { dark, ramp: [], size: 0 };
}

function sampleRamp(ramp: readonly Rgb[], f: number): Rgb {
  const last = ramp.length - 1;
  const pos = Math.min(1, Math.max(0, f)) * last;
  const i = Math.min(last, Math.floor(pos));
  const a = ramp[i]!;
  const b = ramp[Math.min(last, i + 1)]!;
  const k = pos - i;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/**
 * Fill or stroke style for one mark. `white` is upstream's ink value
 * (0 = darkest ink on paper); `x` is the mark's projected CSS-px position.
 */
export function inkStyle(ink: Ink, white: number, x: number, alpha: number): string {
  const w = Math.min(1, Math.max(0, white));
  if (ink.ramp.length === 0) {
    const g = Math.round((ink.dark ? 1 - w : w) * 255);
    return `rgba(${g},${g},${g},${alpha})`;
  }

  const [r, g, b] = sampleRamp(ink.ramp, (x / ink.size - 0.5) / RAMP_SPAN + 0.5);
  // How strongly the mark stands off its substrate — the same on both themes.
  const k = 1 - w;
  if (ink.dark) {
    // The hue scaled to the grey's luma, mixed in by depth.
    const grey = 255 * k;
    const luma = Math.max(1, 0.2126 * r + 0.7152 * g + 0.0722 * b);
    const tint = TINT_NEAR + (TINT_FAR - TINT_NEAR) * w;
    const tone = (v: number): number => Math.round(Math.min(255, grey + ((v * grey) / luma - grey) * tint));
    return `rgba(${tone(r)},${tone(g)},${tone(b)},${alpha})`;
  }
  return `rgba(${Math.round(255 - (255 - r * DEEPEN) * k)},${Math.round(255 - (255 - g * DEEPEN) * k)},${Math.round(255 - (255 - b * DEEPEN) * k)},${alpha})`;
}

let probe: CanvasRenderingContext2D | null = null;

/**
 * Resolve a CSS colour to sRGB by painting one pixel — the canvas accepts
 * hex, rgb(), hsl(), names and the CSS Color 4 spaces alike. Returns null
 * for anything the canvas rejects (including `var(...)`).
 */
export function parseColor(css: string): Rgb | null {
  if (!probe) {
    const el = document.createElement('canvas');
    el.width = 1;
    el.height = 1;
    probe = el.getContext('2d', { willReadFrequently: true });
    if (!probe) return null;
  }
  const ctx = probe;
  // An unparsable assignment is ignored, so two different sentinels survive it.
  ctx.fillStyle = '#000';
  ctx.fillStyle = css;
  const first = ctx.fillStyle;
  ctx.fillStyle = '#fff';
  ctx.fillStyle = css;
  if (ctx.fillStyle !== first) return null;

  ctx.clearRect(0, 0, 1, 1);
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r ?? 0, g ?? 0, b ?? 0];
}

/** Gradient ink from CSS stops; falls back to grey when none of them parse. */
export function gradientInk(dark: boolean, size: number, stops: readonly string[]): Ink {
  const ramp: Rgb[] = [];
  for (const stop of stops) {
    const rgb = parseColor(stop);
    if (rgb) ramp.push(rgb);
  }
  return { dark, ramp, size };
}
