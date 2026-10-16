import type { MarkdownEmojiCategory } from './emoji-data'

export interface MarkdownEmoji {
  char: string
  name: string
  keywords: string[]
}

export interface MarkdownEmojiIndex {
  categories: Array<{ key: MarkdownEmojiCategory, items: MarkdownEmoji[] }>
  all: MarkdownEmoji[]
  /** Shortcode to character. */
  byName: Map<string, string>
}

let loaded: MarkdownEmojiIndex | null = null
let loading: Promise<MarkdownEmojiIndex> | null = null

/** The ~1.5k built-in emoji, fetched on first use and shared by every editor. */
export function loadMarkdownEmoji(): Promise<MarkdownEmojiIndex> {
  loading ??= import('./emoji-data').then(({ MARKDOWN_EMOJI_CATEGORIES, MARKDOWN_EMOJI_DATA }) => {
    const all: MarkdownEmoji[] = []
    const byName = new Map<string, string>()
    const categories = MARKDOWN_EMOJI_CATEGORIES.map((key) => {
      const items = MARKDOWN_EMOJI_DATA[key].split('|').map((entry) => {
        const [char = '', name = '', ...keywords] = entry.split(' ')
        return { char, name, keywords }
      })
      for (const item of items) {
        all.push(item)
        byName.set(item.name, item.char)
      }
      return { key, items }
    })
    loaded = { categories, all, byName }
    return loaded
  })
  return loading
}

export function peekMarkdownEmoji(): MarkdownEmojiIndex | null {
  return loaded
}

/** Shortcode matches before keyword matches, prefixes before substrings. */
export function searchMarkdownEmoji(index: MarkdownEmojiIndex, query: string, limit = 64): MarkdownEmoji[] {
  const needle = query.trim().toLowerCase().replace(/^:|:$/g, '')
  if (!needle)
    return []
  const ranked: Array<[number, number, MarkdownEmoji]> = []
  index.all.forEach((item, order) => {
    let rank = -1
    if (item.name === needle)
      rank = 0
    else if (item.name.startsWith(needle))
      rank = 1
    else if (item.name.includes(needle))
      rank = 2
    else if (item.keywords.some(word => word.startsWith(needle)))
      rank = 3
    else if (item.keywords.some(word => word.includes(needle)))
      rank = 4
    if (rank >= 0)
      ranked.push([rank, order, item])
  })
  return ranked
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .slice(0, limit)
    .map(entry => entry[2])
}

const RECENT_LIMIT = 24
const recent: string[] = []

export function rememberMarkdownEmoji(char: string): void {
  const index = recent.indexOf(char)
  if (index >= 0)
    recent.splice(index, 1)
  recent.unshift(char)
  recent.length = Math.min(recent.length, RECENT_LIMIT)
}

export function recentMarkdownEmoji(index: MarkdownEmojiIndex): MarkdownEmoji[] {
  const byChar = new Map(index.all.map(item => [item.char, item]))
  return recent.map(char => byChar.get(char)).filter((item): item is MarkdownEmoji => !!item)
}
