<script setup lang="ts">
import type { MarkdownEditorHighlightColor, MarkdownEditorLabels } from './types'
import { onMounted, ref } from 'vue'
import { TxIcon } from '../../icon'
import { focusWhenShown } from './focus-when-shown'
import { MARKDOWN_EDITOR_UI_ICONS } from './toolbar-icons'
import { MARKDOWN_EDITOR_HIGHLIGHT_COLORS } from './types'

// Internal: the colours behind the toolbar's highlight button.
defineOptions({ name: 'TxMarkdownEditorHighlightPicker' })

const props = defineProps<{
  labels: MarkdownEditorLabels
  color: MarkdownEditorHighlightColor
  /** Opened from the keyboard: focus moves into the menu. */
  autofocus: boolean
}>()

const emit = defineEmits<{
  pick: [color: MarkdownEditorHighlightColor | null]
}>()

const COLOR_LABELS: Record<MarkdownEditorHighlightColor, keyof MarkdownEditorLabels> = {
  yellow: 'highlightYellow',
  green: 'highlightGreen',
  blue: 'highlightBlue',
  pink: 'highlightPink',
  purple: 'highlightPurple',
}

const root = ref<HTMLElement | null>(null)

function items(): HTMLButtonElement[] {
  return Array.from(root.value?.querySelectorAll<HTMLButtonElement>('button') ?? [])
}

onMounted(() => {
  if (props.autofocus)
    focusWhenShown(() => root.value?.querySelector<HTMLButtonElement>('[aria-checked="true"]'))
})

function onKeydown(event: KeyboardEvent): void {
  const list = items()
  const at = list.indexOf(event.target as HTMLButtonElement)
  if (at < 0)
    return
  const steps: Record<string, number> = {
    ArrowLeft: at - 1,
    ArrowUp: at - 1,
    ArrowRight: at + 1,
    ArrowDown: at + 1,
    Home: 0,
    End: list.length - 1,
  }
  const next = steps[event.key]
  if (next === undefined)
    return
  event.preventDefault()
  list[(next + list.length) % list.length]!.focus()
}
</script>

<template>
  <div
    ref="root"
    class="tx-markdown-editor-highlight"
    role="menu"
    :aria-label="labels.highlightColors"
    @mousedown.prevent
    @keydown="onKeydown"
  >
    <div class="tx-markdown-editor-highlight__swatches" role="none">
      <button
        v-for="item in MARKDOWN_EDITOR_HIGHLIGHT_COLORS"
        :key="item"
        type="button"
        role="menuitemradio"
        class="tx-markdown-editor-highlight__swatch"
        :style="{ '--tx-markdown-editor-pen': `var(--tx-markdown-editor-highlight-${item})` }"
        :aria-checked="item === color"
        :aria-label="labels[COLOR_LABELS[item]]"
        :title="labels[COLOR_LABELS[item]]"
        tabindex="-1"
        @click="emit('pick', item)"
      />
    </div>
    <button
      type="button"
      role="menuitem"
      class="tx-markdown-editor-highlight__remove"
      tabindex="-1"
      @click="emit('pick', null)"
    >
      <TxIcon :name="MARKDOWN_EDITOR_UI_ICONS.removeHighlight" :size="14" />
      <span>{{ labels.removeHighlight }}</span>
    </button>
  </div>
</template>

<style lang="scss">
.tx-markdown-editor-highlight {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  color: var(--tx-markdown-editor-text);
  font-size: 13px;
}

.tx-markdown-editor-highlight__swatches {
  display: flex;
  justify-content: space-between;
  padding: 4px;
}

.tx-markdown-editor-highlight__swatch {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: color-mix(in srgb, var(--tx-markdown-editor-pen) var(--tx-markdown-editor-highlight-alpha), transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tx-markdown-editor-pen) 55%, transparent);
  cursor: pointer;

  &:hover {
    background: color-mix(in srgb, var(--tx-markdown-editor-pen) 60%, transparent);
  }

  &[aria-checked='true'] {
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--tx-markdown-editor-pen) 55%, transparent),
      0 0 0 2px var(--tx-markdown-editor-bg-raised),
      0 0 0 4px var(--tx-markdown-editor-pen);
  }

  &:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--tx-markdown-editor-accent) 55%, transparent);
    outline-offset: 4px;
  }
}

.tx-markdown-editor-highlight__remove {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 8px;
  border: 0;
  border-top: 1px solid var(--tx-markdown-editor-border);
  border-radius: 0 0 6px 6px;
  background: transparent;
  color: var(--tx-markdown-editor-muted);
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    outline: 0;
    background: color-mix(in srgb, var(--tx-markdown-editor-text) 7%, transparent);
    color: var(--tx-markdown-editor-text);
  }
}
</style>
