// Vendored from thinking-orbs v0.2.0 (MIT © Jakub Antalik) — https://github.com/Jakubantalik/thinking-orbs
// Trimmed to the framework-free surface: the upstream React prop bag is
// replaced by TxThinkingOrb's own Vue props.

export type OrbState
  = | 'working'
    | 'searching'
    | 'solving'
    | 'listening'
    | 'connecting'
    | 'weaving'
    | 'composing'
    | 'breathing'
    | 'shaping'

/** The two sizes the presets were hand-tuned for; CSS may scale further. */
export type OrbSize = 20 | 64

export type OrbTheme = 'auto' | 'dark' | 'light'

// TuffEx additions below — upstream inks in grey only.

/** `mono` is upstream's grey ink; `gradient` colours the dots with a palette. */
export type OrbVariant = 'mono' | 'gradient'

export type OrbPaletteName
  = | 'amber'
    | 'glacier'
    | 'violet'
    | 'rose'
    | 'magenta'
    | 'teal'
    | 'indigo'
    | 'lagoon'
    | 'forest'

/** A named palette, or CSS colours laid left → right across the orb. */
export type OrbPalette = OrbPaletteName | readonly string[]

export const ORB_STATES: readonly OrbState[] = [
  'working',
  'searching',
  'solving',
  'listening',
  'connecting',
  'weaving',
  'composing',
  'breathing',
  'shaping',
]
