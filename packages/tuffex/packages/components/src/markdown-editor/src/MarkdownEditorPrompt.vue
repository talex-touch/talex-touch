<script setup lang="ts">
import type { MarkdownEditorLabels } from './types'
import { computed, onMounted, ref } from 'vue'
import { TxIcon } from '../../icon'
import { focusWhenShown } from './focus-when-shown'
import { MARKDOWN_EDITOR_UI_ICONS } from './toolbar-icons'

// Internal: the small form TxMarkdownEditor opens at the selection for a link,
// an image address, a formula or a new comment.
defineOptions({ name: 'TxMarkdownEditorPrompt' })

const props = defineProps<{
  kind: 'link' | 'image' | 'math' | 'comment'
  labels: MarkdownEditorLabels
  value: string
  /** The selection is in a link: offer to remove it. */
  removable?: boolean
  /** KaTeX markup for the formula preview; null while KaTeX loads. */
  renderMath?: (tex: string) => string | null
  /** Bumped when KaTeX arrives, so the preview typesets. */
  assetsVersion?: number
}>()

const emit = defineEmits<{
  submit: [value: string]
  remove: []
  cancel: []
}>()

const draft = ref(props.value)
const field = ref<HTMLInputElement | HTMLTextAreaElement | null>(null)

const multiline = computed(() => props.kind === 'math' || props.kind === 'comment')

const placeholder = computed(() => {
  if (props.kind === 'comment')
    return props.labels.commentPlaceholder
  if (props.kind === 'math')
    return props.labels.mathPlaceholder
  return props.labels.linkPlaceholder
})

const title = computed(() => {
  if (props.kind === 'comment')
    return props.labels.comment
  return props.labels[props.kind]
})

const preview = computed(() => {
  void props.assetsVersion
  const tex = draft.value.trim()
  return props.kind === 'math' && tex ? props.renderMath?.(tex) ?? null : null
})

const canSubmit = computed(() => !!draft.value.trim())

function submit(): void {
  if (canSubmit.value)
    emit('submit', draft.value.trim())
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing)
    return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('cancel')
    return
  }
  if (event.key !== 'Enter')
    return
  const mod = event.metaKey || event.ctrlKey
  // A comment is prose: Enter breaks the line. A formula is mostly one line.
  if ((props.kind === 'comment' && !mod) || (props.kind === 'math' && event.shiftKey && !mod))
    return
  event.preventDefault()
  submit()
}

onMounted(() => {
  focusWhenShown(() => field.value, () => field.value?.select())
})
</script>

<template>
  <form
    class="tx-markdown-editor-prompt"
    :class="`is-${kind}`"
    novalidate
    @submit.prevent="submit"
  >
    <span class="tx-markdown-editor-prompt__title">{{ title }}</span>
    <textarea
      v-if="multiline"
      ref="field"
      v-model="draft"
      class="tx-markdown-editor-prompt__field is-multiline"
      :class="{ 'is-code': kind === 'math' }"
      :rows="kind === 'comment' ? 3 : 2"
      :placeholder="placeholder"
      :aria-label="placeholder"
      :spellcheck="kind === 'comment'"
      @keydown="onKeydown"
    />
    <input
      v-else
      ref="field"
      v-model="draft"
      class="tx-markdown-editor-prompt__field"
      type="text"
      inputmode="url"
      autocomplete="url"
      spellcheck="false"
      :placeholder="placeholder"
      :aria-label="placeholder"
      @keydown="onKeydown"
    >
    <div v-if="kind === 'math'" class="tx-markdown-editor-prompt__math" aria-live="polite">
      <!-- eslint-disable-next-line vue/no-v-html -- KaTeX output of the user's own formula -->
      <span v-if="preview" v-html="preview" />
      <span v-else class="is-muted">{{ draft.trim() || labels.mathPlaceholder }}</span>
    </div>
    <div class="tx-markdown-editor-prompt__actions">
      <button
        v-if="removable"
        type="button"
        class="tx-markdown-editor-prompt__button is-quiet"
        @click="emit('remove')"
      >
        <TxIcon :name="MARKDOWN_EDITOR_UI_ICONS.removeLink" :size="14" />
        {{ labels.removeLink }}
      </button>
      <span class="tx-markdown-editor-prompt__spacer" />
      <button type="button" class="tx-markdown-editor-prompt__button is-quiet" @click="emit('cancel')">
        {{ labels.cancel }}
      </button>
      <button type="submit" class="tx-markdown-editor-prompt__button is-primary" :disabled="!canSubmit">
        {{ kind === 'comment' ? labels.commentSubmit : labels.apply }}
      </button>
    </div>
  </form>
</template>

<style lang="scss">
.tx-markdown-editor-prompt {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  margin: 0;
  color: var(--tx-markdown-editor-text);
  font-size: 13px;
}

.tx-markdown-editor-prompt__title {
  padding: 0 2px;
  color: var(--tx-markdown-editor-muted);
  font-size: 12px;
  font-weight: var(--tx-font-weight-semibold, 600);
}

.tx-markdown-editor-prompt__field {
  width: 100%;
  min-height: 32px;
  padding: 6px 10px;
  border: 0;
  border-radius: 8px;
  outline: 0;
  background: var(--tx-markdown-editor-field-bg);
  box-shadow: inset 0 0 0 1px var(--tx-markdown-editor-border);
  color: inherit;
  font: inherit;
  line-height: 20px;

  &.is-multiline {
    resize: vertical;
  }

  &.is-code {
    font-family: var(--tx-font-family-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
    font-size: 12.5px;
  }

  &::placeholder {
    color: var(--tx-markdown-editor-placeholder);
  }

  &:focus-visible {
    box-shadow: inset 0 0 0 1px var(--tx-markdown-editor-accent), 0 0 0 3px color-mix(in srgb, var(--tx-markdown-editor-accent) 18%, transparent);
  }
}

.tx-markdown-editor-prompt__math {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 8px;
  overflow-x: auto;
  border-radius: 8px;
  background: color-mix(in srgb, var(--tx-markdown-editor-text) 4%, transparent);
  color: var(--tx-markdown-editor-math);

  .is-muted {
    color: var(--tx-markdown-editor-placeholder);
    font-family: var(--tx-font-family-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
    font-size: 12px;
  }
}

.tx-markdown-editor-prompt__actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.tx-markdown-editor-prompt__spacer {
  flex: 1;
}

.tx-markdown-editor-prompt__button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--tx-markdown-editor-muted);
  font: inherit;
  font-size: 13px;
  font-weight: var(--tx-font-weight-medium, 500);
  white-space: nowrap;
  cursor: pointer;

  &.is-quiet:hover {
    background: color-mix(in srgb, var(--tx-markdown-editor-text) 7%, transparent);
    color: var(--tx-markdown-editor-text);
  }

  &.is-primary {
    background: var(--tx-markdown-editor-accent);
    color: var(--tx-color-on-primary, #fff);
    font-weight: var(--tx-font-weight-semibold, 600);
  }

  &.is-primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--tx-markdown-editor-accent) 88%, var(--tx-color-black, #000));
  }

  &:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--tx-markdown-editor-accent) 55%, transparent);
    outline-offset: 1px;
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}
</style>
