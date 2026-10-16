<script setup lang="ts">
import type { MarkdownEditorHighlightColor, MarkdownEditorLabels, MarkdownEditorToolbarActionKey } from './types'
import type { MarkdownBubble } from './use-markdown-bubble'
import { computed, ref, watch } from 'vue'
import { TxBaseAnchor } from '../../base-anchor'
import { TxIcon } from '../../icon'
import { MARKDOWN_EDITOR_ACTION_ICONS, MARKDOWN_EDITOR_AI_ICONS, MARKDOWN_EDITOR_UI_ICONS } from './toolbar-icons'

// Internal: the bar over text selected on the rich surface, and the AI panel
// it opens. The editor runs the formats and holds the AI session; the panel
// itself is loaded on first use, and its styles live here so they ship with
// the editor's.
defineOptions({ name: 'TxMarkdownEditorBubble' })

const props = defineProps<{
  controller: MarkdownBubble
  labels: MarkdownEditorLabels
  theme: 'light' | 'dark'
  actions: readonly MarkdownEditorToolbarActionKey[]
  pressed: ReadonlySet<string>
  /** Comments are on, and this user may add one. */
  comments: boolean
  /** The host handles AI rewrites. */
  ai: boolean
  highlightColor: MarkdownEditorHighlightColor
}>()

const emit = defineEmits<{
  action: [action: MarkdownEditorToolbarActionKey]
  comment: []
}>()

const FORMATS: MarkdownEditorToolbarActionKey[] = ['bold', 'italic', 'strike', 'code', 'highlight', 'link']

const formats = computed(() => FORMATS.filter(action => props.actions.includes(action)))
const barOpen = computed(() => !!props.controller.box.value && (props.ai || props.comments || formats.value.length > 0))
const session = computed(() => props.controller.ai.session.value)
const panelOpen = computed(() => !!session.value && !!props.controller.aiBox.value && !!props.controller.panel.value)
const panelWidth = computed(() => Math.round(Math.min(520, Math.max(280, props.controller.aiBox.value?.width ?? 0))))
const layerClass = computed(() => ['tx-markdown-editor-layer', `tx-markdown-editor-layer--${props.theme}`])

const bar = ref<InstanceType<typeof TxBaseAnchor> | null>(null)
const panel = ref<InstanceType<typeof TxBaseAnchor> | null>(null)

watch(() => props.controller.box.value, () => bar.value?.updatePosition?.())
watch(() => props.controller.aiBox.value, () => panel.value?.updatePosition?.())

defineExpose({
  containsFloating: (target: Node) => !!bar.value?.containsFloating(target) || !!panel.value?.containsFloating(target),
})
</script>

<template>
  <TxBaseAnchor
    ref="bar"
    :model-value="barOpen"
    :class="layerClass"
    :data-theme="theme"
    :virtual-reference="controller.reference"
    placement="top"
    :offset="8"
    :panel-padding="4"
    :max-width="480"
    :close-on-click-outside="false"
    :close-on-esc="false"
  >
    <div
      class="tx-markdown-editor-bubble"
      role="toolbar"
      :aria-label="labels.selectionToolbar"
      :style="{ '--tx-markdown-editor-pen': `var(--tx-markdown-editor-highlight-${highlightColor})` }"
      @mousedown.prevent
    >
      <button
        v-if="ai"
        type="button"
        class="tx-markdown-editor__button tx-markdown-editor-bubble__ai"
        :title="labels.ai"
        @click="controller.ask()"
      >
        <TxIcon :name="MARKDOWN_EDITOR_AI_ICONS.ai" :size="15" />
        <span>{{ labels.ai }}</span>
      </button>
      <span v-if="ai && (formats.length || comments)" class="tx-markdown-editor__separator" aria-hidden="true" />
      <button
        v-for="action in formats"
        :key="action"
        type="button"
        class="tx-markdown-editor__button"
        :class="{ 'is-active': pressed.has(action) }"
        :aria-label="labels[action]"
        :aria-pressed="pressed.has(action)"
        :title="labels[action]"
        @click="emit('action', action)"
      >
        <TxIcon :name="MARKDOWN_EDITOR_ACTION_ICONS[action]" :size="16" />
        <span v-if="action === 'highlight'" class="tx-markdown-editor__pen" aria-hidden="true" />
      </button>
      <template v-if="comments">
        <span v-if="formats.length" class="tx-markdown-editor__separator" aria-hidden="true" />
        <button
          type="button"
          class="tx-markdown-editor__button"
          :aria-label="labels.comment"
          :title="labels.comment"
          @click="emit('comment')"
        >
          <TxIcon :name="MARKDOWN_EDITOR_UI_ICONS.comment" :size="16" />
        </button>
      </template>
    </div>
  </TxBaseAnchor>

  <TxBaseAnchor
    ref="panel"
    :model-value="panelOpen"
    :class="layerClass"
    :data-theme="theme"
    :virtual-reference="controller.aiReference"
    placement="bottom-start"
    disable-flip
    :offset="8"
    :width="panelWidth"
    :max-height="440"
    :panel-padding="0"
    :close-on-esc="false"
    @update:model-value="(open: boolean) => !open && controller.ai.close()"
  >
    <component
      :is="controller.panel.value"
      v-if="session && controller.panel.value"
      :session="session"
      :labels="labels"
      @run="controller.ai.run"
      @stop="controller.ai.stop"
      @retry="controller.ai.retry"
      @accept="controller.ai.accept"
      @discard="controller.ai.discard"
    />
  </TxBaseAnchor>
</template>

<style lang="scss">
.tx-markdown-editor-bubble {
  display: flex;
  align-items: center;
  gap: 2px;
  color: var(--tx-markdown-editor-text);
  white-space: nowrap;
}

.tx-markdown-editor-bubble__ai {
  gap: 5px;
  padding: 0 8px 0 6px;
  font-size: 13px;

  > span {
    background: linear-gradient(90deg, var(--tx-markdown-editor-ai-1), var(--tx-markdown-editor-ai-2) 55%, var(--tx-markdown-editor-ai-3));
    background-clip: text;
    color: transparent;
  }

  > .tx-icon {
    color: var(--tx-markdown-editor-ai-2);
  }
}

// The AI panel (MarkdownEditorAi.vue, loaded on first use).
.tx-markdown-editor-ai {
  display: flex;
  flex-direction: column;
  max-height: var(--tx-ba-max-height, 440px);
  color: var(--tx-markdown-editor-text);
  font-size: 14px;
  outline: 0;
}

.tx-markdown-editor-ai__spark {
  flex: none;
  color: var(--tx-markdown-editor-ai-2);
}

.tx-markdown-editor-ai__ask {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 8px 8px 8px 12px;
}

.tx-markdown-editor-ai__field {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: inherit;
  font: inherit;

  &::placeholder {
    color: var(--tx-markdown-editor-placeholder);
  }
}

.tx-markdown-editor-ai__menu {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 0;
  padding: 4px;
  border-top: 1px solid var(--tx-markdown-editor-border);
  list-style: none;
  font-size: 13px;
}

.tx-markdown-editor-ai__item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 32px;
  padding: 0 8px;
  border-radius: 8px;
  color: var(--tx-markdown-editor-muted);
  cursor: pointer;

  &.is-active {
    background: color-mix(in srgb, var(--tx-markdown-editor-accent) 12%, transparent);
    color: var(--tx-markdown-editor-text);
  }
}

.tx-markdown-editor-ai__head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 4px 6px 4px 12px;
}

.tx-markdown-editor-ai__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--tx-markdown-editor-muted);
  font-size: 13px;
  font-weight: var(--tx-font-weight-semibold, 600);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tx-markdown-editor-ai__body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 0 14px 12px;
  overflow-y: auto;
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: break-word;
}

.tx-markdown-editor-ai__error {
  margin: 0;
  color: var(--tx-markdown-editor-danger);
  font-size: 13px;
  white-space: normal;
}

// While nothing has arrived yet: lines the length of a short answer.
.tx-markdown-editor-ai__skeleton {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 6px 0 4px;

  > span {
    height: 10px;
    border-radius: 5px;
    background: color-mix(in srgb, var(--tx-markdown-editor-text) 8%, transparent);
  }

  > span:last-child {
    width: 62%;
  }
}

.tx-markdown-editor-ai__diff {
  // Struck through with a drawn line rather than a text decoration, which cannot be animated.
  .is-removed {
    background: linear-gradient(currentColor, currentColor) 0 58% / 100% 1.5px no-repeat;
    color: var(--tx-markdown-editor-danger);
    box-decoration-break: clone;
  }

  .is-added {
    border-radius: 3px;
    background: color-mix(in srgb, var(--tx-markdown-editor-callout-tip) 16%, transparent);
    color: var(--tx-markdown-editor-callout-tip);
    box-decoration-break: clone;
  }
}

.tx-markdown-editor-ai__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 8px;
  border-top: 1px solid var(--tx-markdown-editor-border);

  .tx-markdown-editor__button {
    padding: 0 9px;
  }

  .is-primary {
    background: var(--tx-markdown-editor-accent);
    color: var(--tx-color-on-primary, #ffffff);

    &:hover:not(:disabled) {
      background: color-mix(in srgb, var(--tx-markdown-editor-accent) 88%, var(--tx-color-black, #000000));
      color: var(--tx-color-on-primary, #ffffff);
    }
  }
}

.tx-markdown-editor-ai__spacer {
  flex: 1;
}

@media (prefers-reduced-motion: no-preference) {
  // The status of a working panel: the palette sweeping through the words.
  .tx-markdown-editor-ai__title.is-working {
    background: linear-gradient(90deg, var(--tx-markdown-editor-muted) 30%, var(--tx-markdown-editor-ai-1) 42%, var(--tx-markdown-editor-ai-2) 50%, var(--tx-markdown-editor-ai-3) 58%, var(--tx-markdown-editor-muted) 70%) 100% 0 / 300% 100%;
    background-clip: text;
    color: transparent;
    animation: tx-markdown-editor-ai-sweep 1.8s linear infinite;
  }

  .tx-markdown-editor-ai__spark.is-working {
    animation: tx-markdown-editor-ai-twinkle 1.2s ease-in-out infinite alternate;
  }

  .tx-markdown-editor-ai__skeleton > span {
    background: linear-gradient(90deg, transparent 35%, color-mix(in srgb, var(--tx-markdown-editor-ai-2) 22%, transparent) 50%, transparent 65%) 100% 0 / 300% 100%,
      color-mix(in srgb, var(--tx-markdown-editor-text) 8%, transparent);
    animation: tx-markdown-editor-ai-sweep 1.5s linear infinite;
  }

  // The words the answer takes out are struck through one after another, the
  // ones it puts in fade up after them.
  .tx-markdown-editor-ai__diff {
    .is-removed {
      animation: tx-markdown-editor-ai-strike 0.5s cubic-bezier(0.22, 0.61, 0.36, 1) both;
      animation-delay: calc(var(--tx-markdown-editor-ai-order, 0) * 45ms);
    }

    .is-added {
      animation: tx-markdown-editor-ai-rise 0.5s cubic-bezier(0.22, 0.61, 0.36, 1) both;
      animation-delay: calc(var(--tx-markdown-editor-ai-order, 0) * 45ms + 0.18s);
    }
  }
}

@keyframes tx-markdown-editor-ai-sweep {
  to {
    background-position-x: 0;
  }
}

@keyframes tx-markdown-editor-ai-twinkle {
  from {
    opacity: 0.55;
    scale: 0.88;
  }
}

@keyframes tx-markdown-editor-ai-strike {
  from {
    background-size: 0 1.5px;
  }
}

@keyframes tx-markdown-editor-ai-rise {
  from {
    opacity: 0;
    filter: blur(3px);
  }
}
</style>
