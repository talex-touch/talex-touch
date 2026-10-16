/**
 * Renders TeX written between dollar signs with KaTeX while a page is parsed.
 *
 * The concepts handbook and the foundations page write formulas as `$G^2$` and `$$…$$`; until
 * 2026-10-15 they reached the page as raw TeX. The syntax comes from `micromark-extension-math`,
 * so a formula is tokenized before markdown reads it: the `\{` and `\,` in it stay TeX instead of
 * becoming character escapes, and the underscores of `R_{\text{outer}}` never turn into emphasis.
 *
 * Each formula becomes a raw `html` node holding KaTeX's output (HTML, plus MathML for screen
 * readers), the way `remark-mermaid` hands over diagrams, so a page ships no KaTeX JavaScript;
 * the docs page loads `katex.min.css` for the fonts and layout. KaTeX itself is imported only
 * when a page has a formula: MDC's runtime parser bundles every plugin given a `src`.
 *
 * Dollar signs also appear in prose (`$event`, prices). A single-dollar span therefore follows
 * Pandoc's rules: no whitespace just inside either dollar, and no ASCII letter, digit or
 * underscore right after the closing one. A span that breaks them, or that KaTeX cannot parse,
 * goes back to the page as the text it was written as, with the backslash escapes markdown would
 * have applied: the avatar props table's `\`${number}\` \| \`${number}px\`` reads as before.
 * `$$…$$` renders in display mode, on its own lines or inside a paragraph, and `\$` keeps a
 * dollar sign literal.
 */

import { math } from 'micromark-extension-math'

interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
}

interface MathNode extends MdNode {
  type: 'math' | 'inlineMath'
  value: string
  /** The span as written, dollars included: what the page shows when it is not math. */
  raw: string
  display: boolean
}

type Token = object

/** The part of mdast-util-from-markdown's compile context the handlers below use. */
interface CompileContext {
  stack: MdNode[]
  data: Record<string, unknown>
  config: {
    enter: { data: (this: CompileContext, token: Token) => void }
    exit: { data: (this: CompileContext, token: Token) => void }
  }
  enter: (node: MdNode, token: Token) => void
  exit: (token: Token) => void
  buffer: () => void
  resume: () => string
  sliceSerialize: (token: Token) => string
}

interface Processor {
  data: () => Record<string, unknown[] | undefined>
}

function exitMathData(this: CompileContext, token: Token) {
  this.config.enter.data.call(this, token)
  this.config.exit.data.call(this, token)
}

function closeMathNode(context: CompileContext, token: Token, value: string) {
  const node = context.stack[context.stack.length - 1] as MathNode
  context.exit(token)
  node.value = value
  node.raw = context.sliceSerialize(token)
  return node
}

/** Turns the extension's tokens into `math` / `inlineMath` nodes (after mdast-util-math). */
const mathFromMarkdown = {
  enter: {
    mathFlow(this: CompileContext, token: Token) {
      this.enter({ type: 'math', value: '', raw: '', display: true } as MathNode, token)
    },
    mathFlowFenceMeta(this: CompileContext) {
      this.buffer()
    },
    mathText(this: CompileContext, token: Token) {
      this.enter({ type: 'inlineMath', value: '', raw: '', display: false } as MathNode, token)
      this.buffer()
    },
  },
  exit: {
    mathFlow(this: CompileContext, token: Token) {
      closeMathNode(this, token, this.resume().replace(/^\r?\n|\r?\n$/g, ''))
      this.data.mathFlowInside = undefined
    },
    // The opening fence starts collecting the formula; the closing one has nothing to add.
    mathFlowFence(this: CompileContext) {
      if (this.data.mathFlowInside)
        return
      this.buffer()
      this.data.mathFlowInside = true
    },
    mathFlowFenceMeta(this: CompileContext) {
      this.resume()
    },
    mathFlowValue: exitMathData,
    mathText(this: CompileContext, token: Token) {
      const node = closeMathNode(this, token, this.resume())
      node.display = node.raw.startsWith('$$')
    },
    mathTextData: exitMathData,
  },
}

function isMathNode(node: MdNode): node is MathNode {
  return node.type === 'math' || node.type === 'inlineMath'
}

function isFormula(node: MathNode, next: MdNode | undefined) {
  if (!node.value.trim())
    return false
  if (node.display)
    return true
  if (/^\$\s|\s\$$/.test(node.raw))
    return false
  return !(next?.type === 'text' && /^\w/.test(next.value ?? ''))
}

/** CommonMark backslash escapes: what the span would have shown had it never been math. */
function writtenText(node: MathNode): MdNode {
  const text: MdNode = { type: 'text', value: node.raw.replace(/\\([!-/:-@[-`{-~])/g, '$1') }
  return node.type === 'math' ? { type: 'paragraph', children: [text] } : text
}

function collectMathNodes(parent: MdNode, found: Array<{ parent: MdNode, index: number }>) {
  parent.children?.forEach((child, index) => {
    if (isMathNode(child))
      found.push({ parent, index })
    else
      collectMathNodes(child, found)
  })
}

export function remarkMath(this: Processor, _options?: { revision?: string }) {
  const data = this.data()
  ;(data.micromarkExtensions ??= []).push(math())
  ;(data.fromMarkdownExtensions ??= []).push(mathFromMarkdown)

  return async (tree: MdNode) => {
    const found: Array<{ parent: MdNode, index: number }> = []
    collectMathNodes(tree, found)
    if (!found.length)
      return

    const { default: katex } = await import('katex')
    const render = (node: MathNode): MdNode => {
      try {
        return {
          type: 'html',
          value: katex.renderToString(node.value, { displayMode: node.display, strict: 'ignore' }),
        }
      }
      catch {
        return writtenText(node)
      }
    }

    for (const { parent, index } of found) {
      const siblings = parent.children!
      const node = siblings[index] as MathNode
      siblings[index] = isFormula(node, siblings[index + 1]) ? render(node) : writtenText(node)
    }
  }
}

export default remarkMath
