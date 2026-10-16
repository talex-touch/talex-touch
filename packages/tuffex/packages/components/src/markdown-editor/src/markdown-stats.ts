/**
 * Word and character counts of the text a reader sees, for the status bar.
 *
 * Markers are removed first (heading hashes, list bullets, emphasis, link
 * destinations, table pipes, fences), so `**bold**` counts one word. Han,
 * kana and Hangul count one word per character, as Chinese and Japanese
 * counters do; everything else counts runs of letters and digits.
 */

export interface MarkdownStats {
  words: number
  /** Characters other than whitespace. */
  characters: number
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu
const WORD = /[\p{L}\p{N}]+(?:['\u2019-][\p{L}\p{N}]+)*/gu

export function readableMarkdownText(doc: string): string {
  return doc
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^ {0,3}(?:`{3,}|~{3,}).*$/gm, ' ')
    .replace(/^ {0,3}\$\$\s*$/gm, ' ')
    .replace(/^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$/gm, ' ')
    .replace(/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, ' ')
    .replace(/^ {0,3}\[(?:\\.|[^\]\\])+\]:.*$/gm, ' ')
    .replace(/!\[((?:\\.|[^\]\\])*)\]\([^)]*\)/g, '$1')
    .replace(/\[((?:\\.|[^\]\\])*)\](?:\([^)]*\)|\[[^\]]*\])/g, '$1')
    .replace(/<\/?[a-z][^<>]*>/gi, ' ')
    .replace(/^[ \t]*(?:>[ \t]?)+/gm, '')
    .replace(/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, '')
    .replace(/^ {0,3}#{1,6}[ \t]+/gm, '')
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')
    .replace(/[*_~`|$]+/g, ' ')
}

export function markdownStats(doc: string): MarkdownStats {
  if (!doc.trim())
    return { words: 0, characters: 0 }
  const text = readableMarkdownText(doc)
  const cjk = text.match(CJK)?.length ?? 0
  const latin = text.replace(CJK, ' ').match(WORD)?.length ?? 0
  let characters = 0
  // Code points, so an emoji or a rare Han character counts once.
  for (const _ of text.replace(/\s+/g, ''))
    characters++
  return { words: cjk + latin, characters }
}
