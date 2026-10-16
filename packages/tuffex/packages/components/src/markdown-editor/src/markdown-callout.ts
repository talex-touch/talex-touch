import type { Token, Tokens } from 'marked'
import type { MarkdownEditorCalloutType, MarkdownEditorLabels } from './types'
import { MARKDOWN_EDITOR_CALLOUT_TYPES } from './types'

/**
 * GitHub's alerts. A quote at the top level of the document whose first line
 * is `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]` — in
 * any case, alone on the line — renders as a callout of that type.
 *
 * The marker becomes the callout's title: an atom holding the marker in
 * `data-md-src`, left where marked read it, first in the quote's first
 * paragraph and before the line break, so serializing and mapping the block
 * need nothing new. The rich surface reveals the title like formatting: with
 * the caret beside it the marker shows, and editing it edits the source.
 */

export const CALLOUT_MARKER = /^[ \t]*\[!(note|tip|important|warning|caution)\][ \t]*$/i

export const CALLOUT_CLASS = 'tx-markdown-editor__callout'

export const CALLOUT_TITLE_CLASS = 'tx-markdown-editor__callout-title'

export type MarkdownCalloutTitles = Record<MarkdownEditorCalloutType, string>

const LABELS: Record<MarkdownEditorCalloutType, keyof MarkdownEditorLabels> = {
  note: 'calloutNote',
  tip: 'calloutTip',
  important: 'calloutImportant',
  warning: 'calloutWarning',
  caution: 'calloutCaution',
}

export function calloutTitles(labels: MarkdownEditorLabels): MarkdownCalloutTitles {
  return Object.fromEntries(MARKDOWN_EDITOR_CALLOUT_TYPES.map(type => [type, labels[LABELS[type]]])) as MarkdownCalloutTitles
}

export function calloutTypeOf(marker: string): MarkdownEditorCalloutType | null {
  const match = CALLOUT_MARKER.exec(marker)
  return match ? match[1]!.toLowerCase() as MarkdownEditorCalloutType : null
}

export interface CalloutToken extends Tokens.Blockquote {
  callout?: MarkdownEditorCalloutType
}

/** Marks a quote that opens with a marker. Only top-level blocks are passed in: a nested quote is never a callout. */
export function markCallout(token: Token): void {
  if (token.type !== 'blockquote')
    return
  const first = (token as Tokens.Blockquote).tokens[0]
  const [marker, next] = first?.type === 'paragraph' ? (first as Tokens.Paragraph).tokens : []
  const type = marker?.type === 'text' && (!next || next.type === 'br') ? calloutTypeOf(marker.raw) : null
  if (type)
    (token as CalloutToken).callout = type
}
