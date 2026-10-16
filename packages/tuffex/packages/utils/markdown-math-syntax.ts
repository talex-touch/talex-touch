import type { MarkedExtension, TokenizerAndRendererExtension } from 'marked'

/**
 * `$…$` math syntax for `marked`, without a renderer.
 *
 * The whole difficulty is the delimiter. `$` is ordinary prose — prices,
 * shell variables, regex anchors — so a naive rule turns "it costs $5 to $9"
 * into a formula and eats the text between. The guards below exist to make
 * false positives rare, accepting that some real math written sloppily will
 * render as plain text. That trade is deliberate: unrendered math is a small
 * disappointment, swallowed prose is data loss on screen.
 *
 * Shared by `stream-markdown/src/math-extension.ts` and TxMarkdownEditor, which
 * loads KaTeX lazily and so cannot take the extension with its static `katex`
 * import. It lives here rather than in `stream-markdown` because a component
 * importing another component's module inherits that component's stylesheet
 * as a style dependency.
 */

/** KaTeX is happy to grow without bound; a runaway `$` should not hang the render. */
export const MAX_TEX_LENGTH = 2000

export interface MathToken {
  type: 'mathInline' | 'mathBlock'
  raw: string
  text: string
}

/**
 * Whether `$…$` spanning `text` reads as math rather than as two currency
 * amounts. Exported for tests: it is the entire risk surface of this feature.
 */
export function looksLikeInlineMath(tex: string): boolean {
  if (!tex || tex.length > MAX_TEX_LENGTH) return false
  // `$ x $` is prose spacing, not math delimiters — CommonMark-adjacent
  // implementations all require the delimiters to hug their content.
  if (/^\s/.test(tex) || /\s$/.test(tex)) return false
  // Inline math is inline: a newline means the opening `$` was never closed on
  // this line and something further down happened to match.
  if (tex.includes('\n')) return false
  // "$5 to 9$" — a bare number on each side is overwhelmingly currency.
  if (/^\d+(?:[.,]\d+)?$/.test(tex)) return false
  return true
}

const blockRule = /^ {0,3}\$\$([\s\S]+?)\$\$(?:\n|$)/
const blockStart = /\n {0,3}\$\$/
const inlineRule = /^\$((?:\\.|[^$\\])+?)\$/

/**
 * Block first: `$$` would otherwise be consumed as an empty inline span before
 * the block tokenizer ever sees it.
 */
export function createMathExtension(render: (token: MathToken, displayMode: boolean) => string): MarkedExtension {
  const mathBlock: TokenizerAndRendererExtension = {
    name: 'mathBlock',
    level: 'block',
    // marked cuts the paragraph before the index returned here and, when the
    // block tokenizer then declines, glues the two halves back together with a
    // newline. So the index must be a line start: a mid-line `$$` would come
    // back with a line break inserted before it.
    start(src: string) {
      const match = blockStart.exec(src)
      return match ? match.index + 1 : undefined
    },
    tokenizer(src: string) {
      const match = blockRule.exec(src)
      if (!match) return undefined
      const tex = match[1]!.trim()
      if (!tex || tex.length > MAX_TEX_LENGTH) return undefined
      return { type: 'mathBlock', raw: match[0], text: tex }
    },
    renderer(token) {
      return render(token as MathToken, true)
    }
  }

  const mathInline: TokenizerAndRendererExtension = {
    name: 'mathInline',
    level: 'inline',
    start(src: string) {
      return src.indexOf('$')
    },
    tokenizer(src: string) {
      const match = inlineRule.exec(src)
      if (!match) return undefined
      const tex = match[1]!
      if (!looksLikeInlineMath(tex)) return undefined
      return { type: 'mathInline', raw: match[0], text: tex }
    },
    renderer(token) {
      return render(token as MathToken, false)
    }
  }

  return { extensions: [mathBlock, mathInline] }
}
