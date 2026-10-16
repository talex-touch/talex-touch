<script setup lang="ts">
import type { StreamPart } from '../../stream-element/src/types'
import type { StreamInline } from '../../stream-text/src/types'
import type { MarkdownEditorAiAction, MarkdownEditorLabels } from './types'
import type { MarkdownAiSession } from './use-markdown-ai'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { TxIcon } from '../../icon'
import { parseStreamMarkdown } from '../../stream-element/src/parse'
import TxStreamText from '../../stream-text/src/TxStreamText.vue'
import { focusWhenShown } from './focus-when-shown'
import { MARKDOWN_EDITOR_AI_ICONS } from './toolbar-icons'
import { MARKDOWN_EDITOR_AI_ACTIONS } from './types'
import { diffWords } from './word-diff'

// Internal, loaded the first time the AI is asked: the panel under the text
// it rewrites. The editor holds the session; this asks, shows the answer as it
// streams in, the changes it makes, and reports what the user does with it.
// Its styles are in MarkdownEditorBubble.vue, which ships with the editor.
defineOptions({ name: 'TxMarkdownEditorAi' })

const props = defineProps<{
  session: MarkdownAiSession
  labels: MarkdownEditorLabels
}>()

const emit = defineEmits<{
  run: [action: MarkdownEditorAiAction, instruction: string]
  stop: []
  retry: []
  accept: [below: boolean]
  discard: []
}>()

const LABELS = {
  improve: 'aiImprove',
  shorten: 'aiShorten',
  expand: 'aiExpand',
  fix: 'aiFix',
  translate: 'aiTranslate',
} as const

const root = ref<HTMLElement | null>(null)
const field = ref<HTMLInputElement | null>(null)
const instruction = ref('')
const active = ref(0)
const changes = ref(false)

const status = computed(() => props.session.status)
const working = computed(() => status.value === 'waiting' || status.value === 'streaming')

/** The actions whose names hold what is typed; with none, what is typed is the instruction. */
const menu = computed(() => {
  const query = instruction.value.trim().toLowerCase()
  return MARKDOWN_EDITOR_AI_ACTIONS
    .map(action => ({ action, label: props.labels[LABELS[action]], icon: MARKDOWN_EDITOR_AI_ICONS[action] }))
    .filter(item => item.label.toLowerCase().includes(query))
})

const title = computed(() => {
  const { action, instruction } = props.session
  if (action === 'custom')
    return instruction
  return action ? props.labels[LABELS[action]] : props.labels.ai
})

/** The answer's Markdown as runs of text: blocks become lines, headings bold. */
function flatten(parts: readonly StreamPart[], out: StreamInline[], gap: string): StreamInline[] {
  parts.forEach((part, index) => {
    if (index)
      out.push({ type: 'text', text: gap })
    if (part.type === 'heading') {
      out.push(...part.inlines.map(inline => (inline.type === 'text' ? { ...inline, marks: [...inline.marks ?? [], 'strong' as const] } : inline)))
    }
    else if (part.type === 'paragraph') {
      out.push(...part.inlines)
    }
    else if (part.type === 'list') {
      part.items.forEach((item, position) => {
        out.push({ type: 'text', text: `${position ? '\n' : ''}${part.ordered ? `${(part.start ?? 1) + position}.` : '•'} ` })
        flatten(item.parts, out, '\n')
      })
    }
    else if (part.type === 'quote') {
      flatten(part.parts, out, gap)
    }
    else if (part.type === 'code') {
      out.push({ type: 'text', text: part.code, marks: ['code'] })
    }
    else if (part.type === 'markdown') {
      out.push({ type: 'text', text: part.raw.trim() })
    }
  })
  return out
}

/** Highlights and inline HTML by their text, which the stream has no runs for; a tag still arriving is left out. */
function readable(markdown: string, streaming: boolean): string {
  const text = markdown.replace(/==(?=\S)|(?<=\S)==/g, '').replace(/<\/?[a-z][^<>]*>/gi, '')
  return streaming ? text.replace(/<\/?[a-z][^<>]*$/i, '') : text
}

function runs(markdown: string, streaming: boolean): StreamInline[] {
  return flatten(parseStreamMarkdown(readable(markdown, streaming), { streaming }), [], '\n\n')
}

const answer = computed(() => runs(props.session.answer, working.value))

/** A text as it reads, its Markdown gone: the changes are in wording, and a format alone is none. */
function plain(markdown: string): string {
  return runs(markdown, false).map(run => (run.type === 'text' ? run.text : '')).join('')
}

/** The changes, word by word, numbered for the order they animate in; a translation changes everything. */
const diff = computed(() => {
  if (status.value !== 'done' || props.session.action === 'translate')
    return null
  const parts = diffWords(plain(props.session.original), plain(props.session.answer))
  if (!parts?.some(part => part.kind !== 'same'))
    return null
  let order = 0
  return parts.map(part => ({ ...part, order: part.kind === 'same' ? 0 : order++ }))
})

function submit(): void {
  const text = instruction.value.trim()
  const item = menu.value[active.value]
  if (item)
    emit('run', item.action, '')
  else if (text)
    emit('run', 'custom', text)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing)
    return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('discard')
    return
  }
  if (status.value !== 'compose')
    return
  const count = menu.value.length
  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && count) {
    event.preventDefault()
    active.value = (active.value + (event.key === 'ArrowDown' ? 1 : -1) + count) % count
  }
  else if (event.key === 'Enter' && event.target === field.value) {
    event.preventDefault()
    submit()
  }
}

watch(menu, () => {
  active.value = 0
})

// What has focus may be about to go with the state it belongs to: the panel
// keeps it, or the editor would read the move as a blur and close it.
watch(status, async (next) => {
  if (next === 'done')
    changes.value = props.session.action === 'fix' && !!diff.value
  const focused = root.value?.ownerDocument.activeElement
  if (focused && focused !== root.value && root.value?.contains(focused))
    root.value.focus({ preventScroll: true })
  await nextTick()
  // Asking: the field; with an answer, or none, the first action (Replace, or Try again).
  const target = next === 'compose'
    ? field.value
    : next === 'done' || next === 'failed' ? root.value?.querySelector<HTMLElement>('.tx-markdown-editor-ai__actions button') : null
  target?.focus({ preventScroll: true })
}, { flush: 'pre' })

onMounted(() => focusWhenShown(() => field.value ?? root.value))
</script>

<template>
  <div
    ref="root"
    class="tx-markdown-editor-ai"
    :class="`is-${status}`"
    role="dialog"
    :aria-label="labels.ai"
    tabindex="-1"
    @keydown="onKeydown"
  >
    <template v-if="status === 'compose'">
      <form class="tx-markdown-editor-ai__ask" @submit.prevent="submit">
        <TxIcon class="tx-markdown-editor-ai__spark" :name="MARKDOWN_EDITOR_AI_ICONS.ai" :size="16" />
        <input
          ref="field"
          v-model="instruction"
          class="tx-markdown-editor-ai__field"
          type="text"
          autocomplete="off"
          :placeholder="labels.aiPlaceholder"
          :aria-label="labels.aiPlaceholder"
        >
        <button
          type="button"
          class="tx-markdown-editor__button"
          :aria-label="labels.aiSend"
          :title="labels.aiSend"
          :disabled="!instruction.trim()"
          @click="emit('run', 'custom', instruction.trim())"
        >
          <TxIcon :name="MARKDOWN_EDITOR_AI_ICONS.send" :size="16" />
        </button>
      </form>
      <ul v-if="menu.length" class="tx-markdown-editor-ai__menu" role="listbox" :aria-label="labels.ai">
        <li
          v-for="(item, position) in menu"
          :key="item.action"
          class="tx-markdown-editor-ai__item"
          :class="{ 'is-active': position === active }"
          role="option"
          :aria-selected="position === active"
          @mousedown.prevent
          @mousemove="active = position"
          @click="emit('run', item.action, '')"
        >
          <TxIcon :name="item.icon" :size="15" />
          {{ item.label }}
        </li>
      </ul>
    </template>

    <template v-else>
      <div class="tx-markdown-editor-ai__head">
        <TxIcon class="tx-markdown-editor-ai__spark" :class="{ 'is-working': working }" :name="MARKDOWN_EDITOR_AI_ICONS.ai" :size="16" />
        <span class="tx-markdown-editor-ai__title" :class="{ 'is-working': working }">{{ working ? labels.aiWorking : title }}</span>
        <button
          v-if="working"
          type="button"
          class="tx-markdown-editor__button"
          :aria-label="labels.aiStop"
          :title="labels.aiStop"
          @click="emit('stop')"
        >
          <TxIcon :name="MARKDOWN_EDITOR_AI_ICONS.stop" :size="15" />
        </button>
        <button
          v-else-if="diff"
          type="button"
          class="tx-markdown-editor__button"
          :class="{ 'is-active': changes }"
          :aria-label="labels.aiChanges"
          :aria-pressed="changes"
          :title="labels.aiChanges"
          @click="changes = !changes"
        >
          <TxIcon :name="MARKDOWN_EDITOR_AI_ICONS.changes" :size="16" />
        </button>
      </div>

      <div class="tx-markdown-editor-ai__body" aria-live="polite">
        <p v-if="status === 'failed'" class="tx-markdown-editor-ai__error">
          {{ labels.aiFailed }}
        </p>
        <div v-else-if="status === 'waiting'" class="tx-markdown-editor-ai__skeleton" aria-hidden="true">
          <span /><span />
        </div>
        <div v-else-if="changes && diff" class="tx-markdown-editor-ai__diff">
          <span
            v-for="(part, index) in diff"
            :key="index"
            :class="`is-${part.kind}`"
            :style="part.kind === 'same' ? undefined : { '--tx-markdown-editor-ai-order': part.order }"
          >{{ part.text }}</span>
        </div>
        <TxStreamText v-else tag="div" :content="answer" :streaming="working" />
      </div>

      <div v-if="!working" class="tx-markdown-editor-ai__actions">
        <template v-if="status === 'done'">
          <button type="button" class="tx-markdown-editor__button is-primary" @click="emit('accept', false)">
            <TxIcon :name="MARKDOWN_EDITOR_AI_ICONS.replace" :size="15" />
            {{ labels.aiReplace }}
          </button>
          <button type="button" class="tx-markdown-editor__button" @click="emit('accept', true)">
            <TxIcon :name="MARKDOWN_EDITOR_AI_ICONS.insertBelow" :size="15" />
            {{ labels.aiInsertBelow }}
          </button>
        </template>
        <button type="button" class="tx-markdown-editor__button" @click="emit('retry')">
          <TxIcon :name="MARKDOWN_EDITOR_AI_ICONS.retry" :size="15" />
          {{ labels.aiRetry }}
        </button>
        <span class="tx-markdown-editor-ai__spacer" />
        <button type="button" class="tx-markdown-editor__button" @click="emit('discard')">
          <TxIcon :name="MARKDOWN_EDITOR_AI_ICONS.discard" :size="15" />
          {{ labels.aiDiscard }}
        </button>
      </div>
    </template>
  </div>
</template>
