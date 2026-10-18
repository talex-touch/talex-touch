import type { IconPickerEntry } from './types'

/**
 * Row builders shared by the section catalogs.
 *
 * Apart from the sections so each of them stays a flat list of data, and free
 * of runtime imports for the reason the catalog itself is: a host's
 * utility-CSS config evaluates these modules to build its safelist (core-app's
 * `uno.config.ts` does), and a config loader cannot evaluate Vue.
 */

/** Rows rendered from a class, named in full (`i-ri-rocket-line`) so a grep for the class finds its row. */
export function classRows(
  category: string,
  rows: ReadonlyArray<readonly [value: string, keywords: string]>,
): IconPickerEntry[] {
  return rows.map(([value, keywords]) => ({
    id: `class:${value}`,
    icon: { type: 'class', value },
    keywords,
    category,
  }))
}

/** Rows rendered as text. */
export function emojiRows(
  category: string,
  rows: ReadonlyArray<readonly [value: string, keywords: string]>,
): IconPickerEntry[] {
  return rows.map(([value, keywords]) => ({
    id: `emoji:${value}`,
    icon: { type: 'emoji', value },
    keywords,
    category,
  }))
}
