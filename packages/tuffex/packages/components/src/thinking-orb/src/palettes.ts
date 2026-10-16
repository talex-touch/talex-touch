// TuffEx addition — upstream thinking-orbs inks in grey only. The nine
// palettes pair one-to-one with the nine states, so a gradient orb with no
// `palette` still tells its states apart by colour as well as by shape.

import type { OrbPalette, OrbPaletteName, OrbState } from './types'

/** Three stops each, laid left → right across the orb. */
export const ORB_PALETTES: Readonly<Record<OrbPaletteName, readonly [string, string, string]>> = {
  amber: ['#e9a13b', '#ea7b34', '#e14f62'],
  glacier: ['#419286', '#50b3cf', '#3762e4'],
  violet: ['#3662e4', '#753ee4', '#b136cc'],
  rose: ['#dd524c', '#da5497', '#b687f5'],
  magenta: ['#845eef', '#c951e7', '#e14f62'],
  teal: ['#73a132', '#54b685', '#408fae'],
  indigo: ['#3b82c2', '#3762e4', '#652cd1'],
  lagoon: ['#43936c', '#408fae', '#3762e4'],
  forest: ['#94ca41', '#5ec26a', '#429287'],
}

/** The palette each state wears under `variant="gradient"` when `palette` is unset. */
export const ORB_STATE_PALETTES: Readonly<Record<OrbState, OrbPaletteName>> = {
  working: 'amber',
  searching: 'glacier',
  solving: 'violet',
  listening: 'rose',
  connecting: 'magenta',
  weaving: 'teal',
  composing: 'indigo',
  breathing: 'lagoon',
  shaping: 'forest',
}

/** The CSS stops a gradient orb paints with; an unknown name falls back to the state's own. */
export function resolvePalette(palette: OrbPalette | undefined, state: OrbState): readonly string[] {
  if (Array.isArray(palette))
    return palette
  if (typeof palette === 'string' && Object.prototype.hasOwnProperty.call(ORB_PALETTES, palette))
    return ORB_PALETTES[palette]
  return ORB_PALETTES[ORB_STATE_PALETTES[state]]
}
