import type { MarkdownEditorCalloutType, MarkdownEditorMode, MarkdownEditorToolbarActionKey } from './types'

// Carbon, which every host of this editor installs. The toolbar used to draw
// Remix icons, and Nexus — which keeps `ri` out of its dependencies on
// purpose — rendered all fourteen as grey squares on the docs page.
//
// A plain module rather than the SFC, so a host that has to safelist these
// classes can import the list instead of copying it.
export const MARKDOWN_EDITOR_ACTION_ICONS: Record<MarkdownEditorToolbarActionKey, string> = {
  heading: 'i-carbon-heading',
  bold: 'i-carbon-text-bold',
  italic: 'i-carbon-text-italic',
  strike: 'i-carbon-text-strikethrough',
  code: 'i-carbon-code',
  highlight: 'i-carbon-text-highlight',
  quote: 'i-carbon-quotes',
  bulletList: 'i-carbon-list-bulleted',
  orderedList: 'i-carbon-list-numbered',
  taskList: 'i-carbon-list-checked',
  link: 'i-carbon-link',
  image: 'i-carbon-image',
  table: 'i-carbon-table-split',
  codeBlock: 'i-carbon-code-block',
  math: 'i-carbon-function-math',
  divider: 'i-carbon-subtract',
  emoji: 'i-carbon-face-add',
  undo: 'i-carbon-undo',
  redo: 'i-carbon-redo',
}

export const MARKDOWN_EDITOR_MODE_ICONS: Record<MarkdownEditorMode, string> = {
  wysiwyg: 'i-carbon-text-font',
  source: 'i-carbon-hashtag',
  preview: 'i-carbon-view',
}

/** Icons outside the action row: comments, prompts, the emoji and highlight pickers. */
export const MARKDOWN_EDITOR_UI_ICONS = {
  comment: 'i-carbon-add-comment',
  comments: 'i-carbon-chat',
  close: 'i-carbon-close',
  resolve: 'i-carbon-checkmark',
  reopen: 'i-carbon-renew',
  delete: 'i-carbon-trash-can',
  removeLink: 'i-carbon-unlink',
  recent: 'i-carbon-time',
  disclosure: 'i-carbon-chevron-right',
  highlightMenu: 'i-carbon-chevron-down',
  removeHighlight: 'i-carbon-erase',
} as const

/** The selection bar's AI button, the AI menu's actions and its answer panel. */
export const MARKDOWN_EDITOR_AI_ICONS = {
  ai: 'i-carbon-magic-wand-filled',
  improve: 'i-carbon-pen',
  shorten: 'i-carbon-text-short-paragraph',
  expand: 'i-carbon-text-long-paragraph',
  fix: 'i-carbon-spell-check',
  translate: 'i-carbon-translate',
  send: 'i-carbon-send-alt',
  stop: 'i-carbon-stop-filled-alt',
  changes: 'i-carbon-compare',
  replace: 'i-carbon-checkmark',
  insertBelow: 'i-carbon-row-insert',
  retry: 'i-carbon-renew',
  discard: 'i-carbon-close',
} as const

/** The callouts' titles, which are rendered Markdown rather than components. */
export const MARKDOWN_EDITOR_CALLOUT_ICONS: Record<MarkdownEditorCalloutType, string> = {
  note: 'i-carbon-information',
  tip: 'i-carbon-idea',
  important: 'i-carbon-warning-square',
  warning: 'i-carbon-warning-alt',
  caution: 'i-carbon-warning-hex',
}

/** Every icon class the editor can draw. */
export const MARKDOWN_EDITOR_ICON_CLASSES: string[] = [
  ...Object.values(MARKDOWN_EDITOR_ACTION_ICONS),
  ...Object.values(MARKDOWN_EDITOR_MODE_ICONS),
  ...Object.values(MARKDOWN_EDITOR_UI_ICONS),
  ...Object.values(MARKDOWN_EDITOR_AI_ICONS),
  ...Object.values(MARKDOWN_EDITOR_CALLOUT_ICONS),
]
